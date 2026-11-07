/** Uma pergunta do cliente e a resposta que ele recebeu, para o gerador entender os seguimentos. */
export interface TrocaDeConversa {
  readonly cliente: string;
  readonly resposta: string;
}

export interface RespostaGerada {
  /** O manual cobre a pergunta? Se false, o texto é ignorado e o cliente recebe uma frase fixa. */
  encontrou: boolean;
  texto: string;
}

/**
 * O que o núcleo precisa de uma IA que ESCREVE respostas. É uma peça separada do classificador:
 * classificar (escolher de uma lista) e redigir têm riscos diferentes.
 */
export interface GeradorDeResposta {
  readonly nome: string;
  gerar(pergunta: string, historico: readonly TrocaDeConversa[]): Promise<RespostaGerada>;
}