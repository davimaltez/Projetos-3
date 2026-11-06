import { TicketIndisponivelError, TicketNaoEncontradoError } from "./ErrosDaFila.js";
import { compararNaFila } from "./OrdemDaFila.js";
import type { RepositorioDeFila } from "./RepositorioDeFila.js";
import type { Atendente } from "./entidades/Atendente.js";
import { StatusTicket } from "./entidades/Enums.js";
import type { PedidoDeAtendimento } from "./PedidoDeAtendimento.js";
import type { Mensagem } from "./entidades/Mensagem.js";
import type { Ticket } from "./entidades/Ticket.js";

// Mantém os imports antigos (`from "./ServicoDeFila.js"`) funcionando.
export { TicketIndisponivelError, TicketNaoEncontradoError } from "./ErrosDaFila.js";

/** Regras da fila de atendimento humano; não depende de WhatsApp, IA ou PostgreSQL. */
export class ServicoDeFila {
  constructor(private readonly repositorio: RepositorioDeFila) {}

  async solicitarAtendimentoHumano(conversaId: number, pedido?: PedidoDeAtendimento): Promise<Ticket> {
    return this.repositorio.enfileirar(conversaId, pedido);
  }

  async obterAtendimentoHumano(conversaId: number): Promise<Ticket | null> {
    const ticket = await this.repositorio.buscarPorConversa(conversaId);
    return ticket?.getStatus() === StatusTicket.ENCERRADO ? null : ticket;
  }

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

  /** Recupera atendimento para permitir continuar após reinício do bot. */
  async obterTicketAtivo(atendente: Atendente): Promise<Ticket | null> {
    return this.repositorio.buscarEmAtendimentoPorAtendente(atendente.getId());
  }

  /** Envia texto ao endereço do cliente e registra o atendente no histórico. */
  async responderCliente(
      ticketId: string, atendente: Atendente, texto: string,
      enviar: (endereco: string, texto: string) => Promise<string>
  ): Promise<void> {
    if (!texto.trim()) throw new Error("A mensagem não pode ser vazia.");
    const destino = await this.repositorio.obterDestinoDoCliente(ticketId, atendente.getId());
    if (!destino) throw new Error("Endereço de resposta do cliente indisponível. Aguarde nova mensagem do cliente.");
    const resposta = `${atendente.getNome()} (equipe WXN): ${texto}`;
    const idEnviado = await enviar(destino, resposta);
    await this.repositorio.registrarRespostaDoAtendente(ticketId, atendente.getId(), idEnviado, resposta);
  }

  async encerrarAtendimento(ticketId: string, atendente: Atendente): Promise<void> {
    await this.repositorio.encerrarTicket(ticketId, atendente.getId());
  }

  private async exigirTicket(ticketId: string): Promise<Ticket> {
    const ticket = await this.repositorio.buscarPorId(ticketId);
    if (ticket === null) throw new TicketNaoEncontradoError(ticketId);
    return ticket;
  }
}
