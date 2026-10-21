import type { SubTopico, Topico } from "./Topicos.js";

// COPIE O SEU: ajuste estes textos para ficarem iguais aos que o menu já usa hoje.
const CABECALHO_PRINCIPAL = "Olá! Como posso ajudar?\nDigite o número da opção:";
const CABECALHO_SUBMENU = "Escolha uma opção:";
const TEXTO_OPCAO_INVALIDA = "Não encontrei essa opção.";
const TEXTO_SEM_RESPOSTA = "Essa resposta ainda não está disponível.";

/** Tópico ou sub-tópico: o que as duas coisas têm em comum para navegar. */
type No = Topico | SubTopico;

/** Um nível do menu: as opções numeradas que o cliente vê. */
interface Nivel {
  readonly titulo?: string;
  readonly opcoes: readonly No[];
  readonly ehRaiz: boolean;
}

/** Cliente escolheu uma opção que abre outro nível (ou voltou um nível). */
export type NavegacaoDeMenu = {
  tipo: "navegacao";
  /** Tópico de primeiro nível em que o cliente está; null quando voltou ao menu principal. */
  topico: Topico | null;
  texto: string;
  /** Ids do topo até o nível atual. Vazio = menu principal. */
  novoCaminho: string[];
};

/** O que o Atendimento recebe ao interpretar uma mensagem. */
export type Leitura =
  | { tipo: "livre" } // não é número: segue para a IA
  | { tipo: "opcao"; topico: Topico; texto: string } // folha: resposta final
  | NavegacaoDeMenu
  | { tipo: "invalida"; texto: string; novoCaminho: string[] }; // número que não é opção

/**
 * Monta, valida e navega pelo menu. Não tem estado nem I/O: quem guarda "em que nível o
 * cliente está" é o Atendimento (por um RepositorioDeContextoDoMenu).
 *
 * O número que o cliente digita é sempre a posição entre as opções do NÍVEL atual (1, 2, 3...).
 * Dentro de um sub-menu, 0 volta um nível.
 */
export class Menu {
  /** Recebe os tópicos do menu do cliente (topicosDoMenu()): já filtrados por ativo e não-admin. */
  constructor(private readonly raizes: readonly Topico[]) {}

  /** Texto do menu no nível indicado. Caminho que não existe mais cai no menu principal. */
  texto(caminho: readonly string[] = []): string {
    const nivel = this.resolver(caminho) ?? this.nivelRaiz();
    const linhas = nivel.opcoes.map((opcao, i) => `${i + 1} - ${opcao.rotulo}`);
    if (!nivel.ehRaiz) linhas.push("0 - Voltar");
    const cabecalho = nivel.titulo ? `*${nivel.titulo}*\n${CABECALHO_SUBMENU}` : CABECALHO_PRINCIPAL;
    return [cabecalho, ...linhas].join("\n");
  }

  /** "Não encontrei essa opção." seguido do menu do nível em que o cliente está. */
  textoOpcaoInvalida(caminho: readonly string[] = []): string {
    return `${TEXTO_OPCAO_INVALIDA}\n\n${this.texto(caminho)}`;
  }

  /** "1", "2)", " 3 " viram número. Qualquer outra coisa vira null (vai para a IA). */
  lerNumero(texto: string): number | null {
    const m = /^\s*(\d{1,2})\s*[).\-]?\s*$/.exec(texto);
    return m ? Number(m[1]) : null;
  }

  /** Interpreta a mensagem do cliente no nível indicado pelo caminho. */
  interpretar(texto: string, caminho: readonly string[] = []): Leitura {
    const numero = this.lerNumero(texto);
    if (numero === null) return { tipo: "livre" };

    // Caminho que não existe mais (menu mudou depois do deploy): trata como menu principal.
    const nivel = this.resolver(caminho);
    const base = nivel ? [...caminho] : [];
    const atual = nivel ?? this.nivelRaiz();

    // 0 = voltar um nível (só existe dentro de sub-menu).
    if (numero === 0 && !atual.ehRaiz) {
      const novo = base.slice(0, -1);
      return { tipo: "navegacao", topico: this.raizPorId(novo[0]), texto: this.texto(novo), novoCaminho: novo };
    }

    const escolhido = atual.opcoes[numero - 1];
    const raiz = this.raizPorId(base[0] ?? escolhido?.id);
    if (!escolhido || !raiz) {
      return { tipo: "invalida", texto: this.textoOpcaoInvalida(base), novoCaminho: base };
    }

    const novoCaminho = [...base, escolhido.id];
    if (escolhido.filhos?.length) {
      return { tipo: "navegacao", topico: raiz, texto: this.texto(novoCaminho), novoCaminho };
    }
    return { tipo: "opcao", topico: raiz, texto: respostaDe(escolhido) ?? TEXTO_SEM_RESPOSTA };
  }

  /**
   * Quando a IA escolhe um tópico que tem sub-menu, o cliente vê o sub-menu em vez do texto
   * provisório. Devolve null se o tópico não tem filhos (segue a resposta normal).
   */
  abrirTopico(topico: Topico): NavegacaoDeMenu | null {
    const raiz = this.raizPorId(topico.id);
    if (!raiz?.filhos?.length) return null;
    return { tipo: "navegacao", topico: raiz, texto: this.texto([raiz.id]), novoCaminho: [raiz.id] };
  }

  // ---------- internos ----------

  private raizPorId(id: string | undefined): Topico | null {
    return id === undefined ? null : (this.raizes.find((t) => t.id === id) ?? null);
  }

  private nivelRaiz(): Nivel {
    return { opcoes: this.raizes, ehRaiz: true };
  }

  /** Desce a árvore seguindo os ids. Null se algum id não existir ou não tiver filhos. */
  private resolver(caminho: readonly string[]): Nivel | null {
    let opcoes: readonly No[] = this.raizes;
    let titulo: string | undefined;
    for (const id of caminho) {
      const no = opcoes.find((o) => o.id === id);
      if (!no?.filhos?.length) return null;
      opcoes = no.filhos;
      titulo = no.rotulo;
    }
    return { titulo, opcoes, ehRaiz: caminho.length === 0 };
  }
}

/** Topico guarda a resposta em respostaProvisoria; SubTopico, em resposta. */
function respostaDe(no: No): string | undefined {
  return "respostaProvisoria" in no ? no.respostaProvisoria : no.resposta;
}