import { MotivoDaTransferencia, PrioridadeTicket } from "./entidades/Enums.js";

/** O que o ticket precisa saber ao nascer: vem da conversa, não é valor fixo. */
export interface PedidoDeAtendimento {
  readonly assunto: string;
  readonly prioridade: PrioridadeTicket;
  readonly motivo: MotivoDaTransferencia;
  /** O que o bot já sabe do caso (tópico, última pergunta, empresa...), para o cliente não repetir. */
  readonly dados: Readonly<Record<string, unknown>>;
}

export const ASSUNTO_PADRAO = "Atendimento humano";

/** Pedido explícito do cliente: o comportamento de antes da história 2.1. */
export const PEDIDO_PADRAO: PedidoDeAtendimento = Object.freeze({
  assunto: ASSUNTO_PADRAO,
  prioridade: PrioridadeTicket.MEDIA,
  motivo: MotivoDaTransferencia.PEDIDO_DO_CLIENTE,
  dados: Object.freeze({}),
});

const TAMANHO_MAXIMO_ASSUNTO = 120;
const TAMANHO_MAXIMO_DADOS = 4_000; // caracteres de JSON: o histórico em si vem da tabela mensagens

/** Confere o pedido e devolve uma cópia limpa (assunto sem espaços sobrando, dados como JSON puro). */
export function validarPedido(pedido: PedidoDeAtendimento): PedidoDeAtendimento {
  const assunto = pedido.assunto.trim();
  if (assunto === "") throw new Error("O assunto do atendimento não pode ser vazio.");
  if (assunto.length > TAMANHO_MAXIMO_ASSUNTO) {
    throw new Error(`O assunto do atendimento passa de ${TAMANHO_MAXIMO_ASSUNTO} caracteres.`);
  }
  if (!Object.values(PrioridadeTicket).includes(pedido.prioridade)) {
    throw new Error("Prioridade do atendimento inválida.");
  }
  if (!Object.values(MotivoDaTransferencia).includes(pedido.motivo)) {
    throw new Error("Motivo da transferência inválido.");
  }

  const dados: unknown = pedido.dados;
  if (typeof dados !== "object" || dados === null || Array.isArray(dados)) {
    throw new Error("Os dados do atendimento devem ser um objeto.");
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(dados);
  } catch {
    json = undefined;
  }
  if (json === undefined) throw new Error("Os dados do atendimento não podem ser gravados como JSON.");
  if (json.length > TAMANHO_MAXIMO_DADOS) {
    throw new Error(`Os dados do atendimento passam de ${TAMANHO_MAXIMO_DADOS} caracteres.`);
  }

  return { assunto, prioridade: pedido.prioridade, motivo: pedido.motivo, dados: JSON.parse(json) as Record<string, unknown> };
}