import { TicketIndisponivelError, TicketNaoEncontradoError } from "./ErrosDaFila.js";
import { compararNaFila } from "./OrdemDaFila.js";
import type { RepositorioDeFila } from "./RepositorioDeFila.js";
import type { Atendente } from "./entidades/Atendente.js";
import { StatusTicket } from "./entidades/Enums.js";
import type { Mensagem } from "./entidades/Mensagem.js";
import type { Ticket } from "./entidades/Ticket.js";

// Mantém os imports antigos (`from "./ServicoDeFila.js"`) funcionando.
export { TicketIndisponivelError, TicketNaoEncontradoError } from "./ErrosDaFila.js";

/** Regras da fila de atendimento humano; não depende de WhatsApp, IA ou PostgreSQL. */
export class ServicoDeFila {
  constructor(private readonly repositorio: RepositorioDeFila) {}

  /** Tickets aguardando, por prioridade e tempo de espera. */
  async listarFila(): Promise<Ticket[]> {
    const tickets = await this.repositorio.listarAguardando();
    // O repositório já filtra e ordena; repetir aqui protege a regra contra uma implementação falha.
    return tickets
      .filter((ticket) => ticket.getStatus() === StatusTicket.AGUARDANDO)
      .sort(compararNaFila);
  }

  async assumirTicket(ticketId: string, atendente: Atendente): Promise<void> {
    const ticket = await this.exigirTicket(ticketId);
    if (ticket.getStatus() !== StatusTicket.AGUARDANDO) {
      throw new TicketIndisponivelError(ticketId);
    }

    // Outra solicitação pode assumir o ticket depois da leitura acima.
    // O repositório confirma o status no momento da atribuição e lança TicketIndisponivelError.
    await this.repositorio.atribuirAtendente(ticketId, atendente.getId());
  }

  async obterHistoricoDoTicket(ticketId: string): Promise<Mensagem[]> {
    const ticket = await this.exigirTicket(ticketId);
    return ticket.getConversa().getHistorico()
      .sort((a, b) => a.getDataEnvio().getTime() - b.getDataEnvio().getTime());
  }

  private async exigirTicket(ticketId: string): Promise<Ticket> {
    const ticket = await this.repositorio.buscarPorId(ticketId);
    if (ticket === null) throw new TicketNaoEncontradoError(ticketId);
    return ticket;
  }
}
