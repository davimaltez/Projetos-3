import type { SubTopico, Topico } from "./Topicos.js";

const CABECALHO_PRINCIPAL = "Olá! Como posso ajudar?\nDigite o número da opção:";
const CABECALHO_SUBMENU = "Escolha uma opção:";
const TEXTO_OPCAO_INVALIDA = "Não encontrei essa opção.";
const TEXTO_SEM_RESPOSTA = "Essa resposta ainda não está disponível.";
const TEXTO_PEDIR_PERGUNTA = "Pode escrever a sua dúvida. Para voltar ao menu, digite 0.";

/** Palavras que, escritas sozinhas, saem do modo "escreva sua pergunta" (além do 0). */
const PALAVRAS_DE_VOLTAR = ["menu", "voltar", "sair"];

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
  | { tipo: "livre" } // não é número: segue para o casamento por texto e para a IA
  | { tipo: "opcao"; topico: Topico; texto: string } // folha: resposta final
  | NavegacaoDeMenu
  // Opção com acao "perguntar": liga o modo "escreva sua pergunta". O nível continua o do menu pai.
  | { tipo: "perguntar"; topico: Topico; texto: string; novoCaminho: string[] }
  | { tipo: "invalida"; texto: string; novoCaminho: string[] }; // número que não é opção

/** Uma opção foi escolhida (por número, texto ou IA). */
export type Selecao = Extract<Leitura, { tipo: "opcao" | "navegacao" | "perguntar" }>;

/** Opção do nível atual, no formato que a IA recebe. */
export interface OpcaoDoNivel {
  readonly id: string;
  readonly descricao: string;
}

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
    if (!nivel.ehRaiz) linhas.push('Para falar com um atendente, envie "atendente".');
    const cabecalho = nivel.titulo ? `*${nivel.titulo}*\n${CABECALHO_SUBMENU}` : CABECALHO_PRINCIPAL;
    return [cabecalho, ...linhas].join("\n");
  }

  /** "Não encontrei essa opção." seguido do menu do nível em que o cliente está. */
  textoOpcaoInvalida(caminho: readonly string[] = []): string {
    return `${TEXTO_OPCAO_INVALIDA}\n\n${this.texto(caminho)}`;
  }

  /** "1", "2)", " 3 " viram número. Qualquer outra coisa vira null. */
  lerNumero(texto: string): number | null {
    const m = /^\s*(\d{1,2})\s*[).\-]?\s*$/.exec(texto);
    return m ? Number(m[1]) : null;
  }

  /** "menu", "voltar" ou "sair" escritos sozinhos (qualquer capitalização ou pontuação). */
  ehPedidoDeVoltar(texto: string): boolean {
    return PALAVRAS_DE_VOLTAR.includes(normalizar(texto));
  }

  /** Caminho que ainda existe no menu; se o menu mudou e ele sumiu, volta para o principal ([]). */
  normalizarCaminho(caminho: readonly string[]): string[] {
    return this.resolver(caminho) ? [...caminho] : [];
  }

  /** Tópico de primeiro nível ao qual o caminho pertence (null no menu principal). */
  topicoDoCaminho(caminho: readonly string[]): Topico | null {
    return this.raizPorId(caminho[0]);
  }

  /** Interpreta um número digitado no nível indicado pelo caminho. Texto vira { tipo: "livre" }. */
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

    const selecao = this.selecionar(base, atual.opcoes[numero - 1]);
    return selecao ?? { tipo: "invalida", texto: this.textoOpcaoInvalida(base), novoCaminho: base };
  }

  /**
   * O cliente escreveu em vez de digitar: vê se o texto corresponde a UMA opção do nível atual
   * (ignora acento, maiúscula e pontuação). Devolve null se não bater ou se bater com mais de
   * uma: aí quem decide é a IA.
   *
   * Regras: texto igual ao rótulo (ou a um sinônimo) ganha; senão vale texto que esteja dentro
   * do rótulo ("senha" em "esqueci minha senha") ou rótulo que esteja dentro do texto
   * ("quero entrar" contém "entrar"). Sempre palavras inteiras.
   */
  buscarPorTexto(texto: string, caminho: readonly string[] = []): Selecao | null {
    const entrada = normalizar(texto);
    if (entrada.length < 3) return null;

    const nivel = this.resolver(caminho);
    const base = nivel ? [...caminho] : [];
    const atual = nivel ?? this.nivelRaiz();

    const exatas = atual.opcoes.filter((o) => termosDe(o).includes(entrada));
    if (exatas.length === 1) return this.selecionar(base, exatas[0]);
    if (exatas.length > 1) return null;

    const parciais = atual.opcoes.filter((o) =>
      termosDe(o).some((termo) => (termo.length >= 4 && contem(entrada, termo)) || contem(termo, entrada))
    );
    return parciais.length === 1 ? this.selecionar(base, parciais[0]) : null;
  }

  /** As opções do nível atual, no formato que a IA recebe para escolher. */
  opcoesDoNivel(caminho: readonly string[] = []): readonly OpcaoDoNivel[] {
    const nivel = this.resolver(caminho) ?? this.nivelRaiz();
    return nivel.opcoes.map((o) => ({
      id: o.id,
      descricao: o.descricao ? `${o.rotulo}: ${o.descricao}` : o.rotulo,
    }));
  }

  /** Aplica a escolha da IA (id de uma opção do nível atual). Null se o id não existir ali. */
  escolher(caminho: readonly string[], idOpcao: string): Selecao | null {
    const nivel = this.resolver(caminho);
    const base = nivel ? [...caminho] : [];
    const atual = nivel ?? this.nivelRaiz();
    return this.selecionar(
      base,
      atual.opcoes.find((o) => o.id === idOpcao)
    );
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

  /** Transforma uma opção escolhida em resposta final, novo sub-menu ou modo "escreva sua pergunta". */
  private selecionar(base: readonly string[], escolhido: No | undefined): Selecao | null {
    if (!escolhido) return null;
    const raiz = this.raizPorId(base[0] ?? escolhido.id);
    if (!raiz) return null;

    if (ehPergunta(escolhido)) {
      return {
        tipo: "perguntar",
        topico: raiz,
        texto: respostaDe(escolhido) ?? TEXTO_PEDIR_PERGUNTA,
        novoCaminho: [...base], // o cliente continua no nível do menu pai
      };
    }

    const novoCaminho = [...base, escolhido.id];
    if (escolhido.filhos?.length) {
      return { tipo: "navegacao", topico: raiz, texto: this.texto(novoCaminho), novoCaminho };
    }
    return { tipo: "opcao", topico: raiz, texto: respostaDe(escolhido) ?? TEXTO_SEM_RESPOSTA };
  }

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


function ehPergunta(no: No): boolean {
  return "acao" in no && no.acao === "perguntar";
}

/** Minúsculas, sem acento e sem pontuação, com espaços únicos: "Esqueci minha SENHA!" → "esqueci minha senha". */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rótulo e sinônimos de uma opção, já normalizados. */
function termosDe(no: No): string[] {
  return [no.rotulo, ...(no.sinonimos ?? [])].map(normalizar).filter((t) => t.length > 0);
}

/** `curto` aparece dentro de `longo` como palavras inteiras? ("senha" em "esqueci minha senha": sim; "sen": não) */
function contem(longo: string, curto: string): boolean {
  return ` ${longo} `.includes(` ${curto} `);
}
