import type { RepositorioDeFila } from "../nucleo/RepositorioDeFila.js";
import type { Atendente } from "../nucleo/entidades/Atendente.js";
import { StatusTicket } from "../nucleo/entidades/Enums.js";
import type { Ticket } from "../nucleo/entidades/Ticket.js";

/**
 * Simulação para testes. Mantém as entidades em um array por instância e devolve
 * cópias da lista; as entidades preservam identidade e suas próprias regras.
 * Os dados são descartados ao encerrar o processo.
 */
export class RepositorioDeFilaEmMemoria implements RepositorioDeFila {
  readonly #tickets: Ticket[];

  constructor(tickets: readonly Ticket[] = []) {
    const protocolos = tickets.map((ticket) => ticket.getProtocolo());
    if (new Set(protocolos).size !== protocolos.length) {
      throw new Error("A fila não pode conter tickets com protocolos duplicados.");
    }
    this.#tickets = [...tickets];
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
