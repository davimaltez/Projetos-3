import type { IdTopico, Topico } from "./Topicos.js";

export interface Classificacao {
  topico: IdTopico | null; // null = indefinido
  confianca: number; // 0 a 1
}

/** Uma opção que a IA pode escolher dentro de um nível do menu. */
export interface OpcaoClassificavel {
  readonly id: string;
  readonly descricao: string;
}

/** Resultado de escolher entre as opções de um nível. */
export interface EscolhaDeOpcao {
  id: string | null; // null = indefinido
  confianca: number; // 0 a 1
}

/** O que o núcleo precisa de uma IA: escolher uma opção de uma lista fechada. */
export interface ClassificadorDeIntencao {
  readonly nome: string;
  /** Escolhe entre os tópicos principais (menu raiz). */
  classificar(texto: string, topicos: readonly Topico[]): Promise<Classificacao>;
  /** Escolhe entre as opções de um nível do menu (sub-menus). */
  escolherOpcao(texto: string, opcoes: readonly OpcaoClassificavel[]): Promise<EscolhaDeOpcao>;
}