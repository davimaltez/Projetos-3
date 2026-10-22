import type { RepositorioDeFila } from "./RepositorioDeFila.js";
import type { Atendente } from "./entidades/Atendente.js";
import { Prioridade, StatusTicket } from "./entidades/Enums.js";
import type { Mensagem } from "./entidades/Mensagem.js";
import type { Ticket } from "./entidades/Ticket.js";

const ORDEM_DE_PRIORIDADE: Record<Prioridade, number> = {
  [Prioridade.ALTA]: 0,
  [Prioridade.MEDIA]: 1,
  [Prioridade.BAIXA]: 2,
};

export class TicketNaoEncontradoError extends Error {
  constructor(ticketId: string) {
    super(`Ticket não encontrado: ${ticketId}.`);
    this.name = "TicketNaoEncontradoError";
  }
}

export class TicketIndisponivelError extends Error {
  constructor(ticketId: string) {
    super(`O ticket ${ticketId} não está mais aguardando atendimento.`);
    this.name = "TicketIndisponivelError";
  }
}

/** Regras da fila de atendimento humano; não depende de WhatsApp, IA ou PostgreSQL. */
export class ServicoDeFila {
  constructor(private readonly repositorio: RepositorioDeFila) {}

  async listarFila(): Promise<Ticket[]> {
    const tickets = await this.repositorio.listar();
    return tickets
      .filter((ticket) => ticket.getStatus() === StatusTicket.AGUARDANDO)
      .sort((a, b) =>
        ORDEM_DE_PRIORIDADE[a.getPrioridade()] - ORDEM_DE_PRIORIDADE[b.getPrioridade()] ||
        a.getDataAbertura().getTime() - b.getDataAbertura().getTime()
      );
  }

  async assumirTicket(ticketId: string, atendente: Atendente): Promise<void> {
    const ticket = await this.exigirTicket(ticketId);
    if (ticket.getStatus() !== StatusTicket.AGUARDANDO) {
      throw new TicketIndisponivelError(ticketId);
    }

    // Outra solicitação pode assumir o ticket depois da leitura acima.
    // O repositório confirma o status no momento da atribuição.
    if (!(await this.repositorio.atribuirSeAguardando(ticketId, atendente))) {
      throw new TicketIndisponivelError(ticketId);
    }
  }

  async obterHistoricoDoTicket(ticketId: string): Promise<Mensagem[]> {
    const ticket = await this.exigirTicket(ticketId);
    return ticket.getConversa().getHistorico()
      .sort((a, b) => a.getDataHora().getTime() - b.getDataHora().getTime());
  }

  private async exigirTicket(ticketId: string): Promise<Ticket> {
    const ticket = await this.repositorio.obterPorId(ticketId);
    if (ticket === null) throw new TicketNaoEncontradoError(ticketId);
    return ticket;
  }
}
