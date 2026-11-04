import type { RepositorioDeFila } from "../nucleo/RepositorioDeFila.js";
import type { Atendente } from "../nucleo/entidades/Atendente.js";
import { StatusTicket } from "../nucleo/entidades/Enums.js";
import type { Ticket } from "../nucleo/entidades/Ticket.js";
import type { Conversa } from "../nucleo/entidades/Conversa.js";

/**
 * Simulação para testes. Mantém as entidades em um array por instância e devolve
 * cópias da lista; as entidades preservam identidade e suas próprias regras.
 * Os dados são descartados ao encerrar o processo.
 */
export class RepositorioDeFilaEmMemoria implements RepositorioDeFila {
  readonly #tickets: Ticket[];
  readonly #conversas: Map<number, Conversa>;

  constructor(tickets: readonly Ticket[] = [], conversas: readonly Conversa[] = []) {
    const protocolos = tickets.map((ticket) => ticket.getProtocolo());
    if (new Set(protocolos).size !== protocolos.length) {
      throw new Error("A fila não pode conter tickets com protocolos duplicados.");
    }
    this.#tickets = [...tickets];
    this.#conversas = new Map([...tickets.map((ticket) => ticket.getConversa()), ...conversas]
      .map((conversa) => [conversa.getId(), conversa]));
  }

  async enfileirar(conversaId: number): Promise<Ticket> {
    // Sem await: a consulta e a inclusão formam uma operação indivisível em memória.
    const existente = this.#tickets.find((ticket) => ticket.getConversa().getId() === conversaId &&
      ticket.getStatus() !== StatusTicket.ENCERRADO);
    if (existente) return existente;
    const conversa = this.#conversas.get(conversaId);
    if (!conversa) throw new Error("Conversa não encontrada.");
    const ticket = conversa.transferirParaHumano();
    this.#tickets.push(ticket);
    return ticket;
  }

  async obterAbertoPorConversa(conversaId: number): Promise<Ticket | null> {
    return this.#tickets.find((ticket) => ticket.getConversa().getId() === conversaId &&
      ticket.getStatus() !== StatusTicket.ENCERRADO) ?? null;
  }

  async listar(): Promise<Ticket[]> {
    return [...this.#tickets];
  }

  async obterPorId(ticketId: string): Promise<Ticket | null> {
    return this.#tickets.find((ticket) => ticket.getProtocolo() === ticketId) ?? null;
  }

  async atribuirSeAguardando(ticketId: string, atendente: Atendente): Promise<boolean> {
    const ticket = this.#tickets.find((item) => item.getProtocolo() === ticketId);
    if (!ticket || ticket.getStatus() !== StatusTicket.AGUARDANDO) return false;

    // Não há await entre a verificação e a alteração: nenhuma outra solicitação
    // executa nesse intervalo no mesmo processo e instância deste repositório.
    ticket.atribuir(atendente);
    return true;
  }
}
