import type { IdTopico, Topico } from "./Topicos.js";

/**
 * O que o núcleo precisa de uma IA: dado um texto, dizer a qual tópico ele pertence.
 *
 * A interface mora no NÚCLEO (quem precisa define o contrato), e a implementação
 * com Gemini mora fora, em ia/. Trocar Gemini por outro modelo, ou usar um
 * classificador falso nos testes, não toca no Atendimento.
 */
export interface Classificacao {
  /** null = a IA não conseguiu encaixar a mensagem em nenhum tópico (saudação, assunto fora do escopo...). */
  readonly topico: IdTopico | null;
  /** 0 a 1, informado pelo próprio modelo. É uma estimativa, não uma probabilidade calibrada. */
  readonly confianca: number;
}

export interface ClassificadorDeIntencao {
  readonly nome: string;
  classificar(texto: string, topicos: readonly Topico[]): Promise<Classificacao>;
}
