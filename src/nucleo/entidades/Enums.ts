/** Plano da Dupla 1: BAIXA, MEDIA, ALTA, URGENTE. */
export enum PrioridadeTicket {
  BAIXA = "BAIXA",
  MEDIA = "MEDIA",
  ALTA = "ALTA",
  URGENTE = "URGENTE",
}

/**
 * Nome antigo (o do diagrama), mantido para o código que já usa `Prioridade`.
 * É o mesmo enum: Prioridade.ALTA === PrioridadeTicket.ALTA.
 */
export const Prioridade = PrioridadeTicket;
export type Prioridade = PrioridadeTicket;

export enum StatusTicket {
  AGUARDANDO = "AGUARDANDO",
  EM_ATENDIMENTO = "EM_ATENDIMENTO",
  ENCERRADO = "ENCERRADO",
}

export enum StatusConversa {
  COM_BOT = "COM_BOT",
  AGUARDANDO_ATENDENTE = "AGUARDANDO_ATENDENTE",
  EM_ATENDIMENTO = "EM_ATENDIMENTO",
  ENCERRADA = "ENCERRADA",
}

/** Os mesmos valores aceitos pela coluna atendentes.status (CHECK no db/schema.sql). */
export enum StatusAtendente {
  DISPONIVEL = "DISPONIVEL",
  OCUPADO = "OCUPADO",
  OFFLINE = "OFFLINE",
}

/** Quem enviou a mensagem (Remetente.getTipo()). */
export enum TipoRemetente {
  CLIENTE = "CLIENTE",
  ATENDENTE = "ATENDENTE",
  CHATBOT = "CHATBOT",
}

export enum TipoAtendimento {
  SIMPLIFICADO = "SIMPLIFICADO",
  PERSONALIZADO = "PERSONALIZADO",
}
