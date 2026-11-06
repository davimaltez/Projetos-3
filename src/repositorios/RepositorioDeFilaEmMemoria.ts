import { AtendenteNaoCadastradoError, TicketIndisponivelError, TicketNaoEncontradoError } from "../nucleo/ErrosDaFila.js";
import { compararNaFila } from "../nucleo/OrdemDaFila.js";
import type { RepositorioDeFila } from "../nucleo/RepositorioDeFila.js";
import type { Atendente } from "../nucleo/entidades/Atendente.js";
import { StatusTicket } from "../nucleo/entidades/Enums.js";
import type { Ticket } from "../nucleo/entidades/Ticket.js";
import type { Conversa } from "../nucleo/entidades/Conversa.js";
import { PEDIDO_PADRAO, type PedidoDeAtendimento } from "../nucleo/PedidoDeAtendimento.js";

/**
 * Simulação para testes. Mantém tickets e atendentes cadastrados em arrays por instância e
 * devolve cópias das listas; as entidades preservam identidade e suas próprias regras.
 * Os dados são descartados ao encerrar o processo.
 */
export class RepositorioDeFilaEmMemoria implements RepositorioDeFila {
  readonly #tickets: Ticket[];
  readonly #atendentes: Atendente[];
  readonly #conversas: Map<string, Conversa>;

  constructor(tickets: readonly Ticket[] = [], atendentes: readonly Atendente[] = [], conversas: readonly Conversa[] = []) {
    const ids = tickets.map((ticket) => ticket.getId());
    if (new Set(ids).size !== ids.length) {
      throw new Error("A fila não pode conter tickets com protocolos duplicados.");
    }
    this.#tickets = [...tickets];
    this.#atendentes = [...atendentes];
    this.#conversas = new Map([...tickets.map((ticket) => ticket.getConversa()), ...conversas]
      .map((conversa) => [conversa.getId(), conversa]));
  }

  async enfileirar(conversaId: number, pedido: PedidoDeAtendimento = PEDIDO_PADRAO): Promise<Ticket> {
    const existente = this.#tickets.find((t) => t.getConversa().getId() === String(conversaId));
    if (existente) {
      if (existente.getStatus() === StatusTicket.ENCERRADO) throw new Error("Atendimento desta conversa já encerrado.");
      return existente;
    }
    const conversa = this.#conversas.get(String(conversaId));
    if (!conversa) throw new Error("Conversa não encontrada.");
    // Sem await: leitura e inclusão são indivisíveis nesta instância.
    const ticket = conversa.transferirParaHumano(pedido);
    this.#tickets.push(ticket);
    return ticket;
  }

  async buscarPorConversa(conversaId: number): Promise<Ticket | null> {
    return this.#tickets.find((t) => t.getConversa().getId() === String(conversaId)) ?? null;
  }

  async listarAguardando(): Promise<Ticket[]> {
    return this.#tickets
      .filter((ticket) => ticket.getStatus() === StatusTicket.AGUARDANDO)
      .sort(compararNaFila);
  }

  async buscarPorId(id: string): Promise<Ticket | null> {
    return this.#tickets.find((ticket) => ticket.getId() === id) ?? null;
  }

  async atribuirAtendente(ticketId: string, atendenteId: string): Promise<void> {
    const ticket = this.#tickets.find((item) => item.getId() === ticketId);
    if (!ticket) throw new TicketNaoEncontradoError(ticketId);
    if (ticket.getStatus() !== StatusTicket.AGUARDANDO) throw new TicketIndisponivelError(ticketId);
    const atendente = this.#atendentes.find((item) => item.getId() === atendenteId);
    if (!atendente) throw new AtendenteNaoCadastradoError(atendenteId);

    // Não há await entre a verificação e a alteração: nenhuma outra solicitação
    // executa nesse intervalo no mesmo processo e instância deste repositório.
    ticket.atribuirAtendente(atendente);
  }
}
