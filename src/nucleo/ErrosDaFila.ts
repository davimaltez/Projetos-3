/** Erros da fila de atendimento humano. Ficam no núcleo: o serviço e os repositórios usam os mesmos. */

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

export class AtendenteNaoCadastradoError extends Error {
  constructor(atendenteId: string) {
    super(`Atendente ${atendenteId} não cadastrado. Cadastre a identidade antes da atribuição.`);
    this.name = "AtendenteNaoCadastradoError";
  }
}
