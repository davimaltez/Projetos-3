import type { Topico } from "./Topicos.js";

export type LeituraDoMenu =
  | { tipo: "opcao"; topico: Topico }
  | { tipo: "invalida" }
  | { tipo: "texto" };

/**
 * Menu de opções (história 1.3). Resolve o caso barato e determinístico
 * ANTES de gastar uma chamada à IA: se o usuário digitou só um número,
 * não há nada para interpretar.
 */
export class Menu {
  constructor(private readonly topicos: readonly Topico[]) {}

  texto(): string {
    const opcoes = this.topicos.map((t, i) => `${i + 1}. ${t.rotulo}`).join("\n");
    return `Como posso ajudar? Responda com o número da opção:\n\n${opcoes}`;
  }

  /** O menu precedido de um aviso, para quando o cliente digita um número que não é opção. */
  textoOpcaoInvalida(): string {
    return `Não encontrei essa opção.\n\n${this.texto()}`;
  }

  /**
   * "2", " 2 ", "2." ou "2)" → { tipo: "opcao", topico da opção 2 }.
   * Número fora das opções ("9") → { tipo: "invalida" }: mostra o menu de novo, sem gastar IA.
   * Qualquer outro texto → { tipo: "texto" }: segue para a IA.
   */
  interpretar(texto: string): LeituraDoMenu {
    const encontrado = /^\s*(\d{1,3})\s*[.)]?\s*$/.exec(texto);
    if (!encontrado) return { tipo: "texto" };
    const topico = this.topicos[Number(encontrado[1]) - 1];
    return topico ? { tipo: "opcao", topico } : { tipo: "invalida" };
  }
}
