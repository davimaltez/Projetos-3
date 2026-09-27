import type { CanalMensagens, MensagemRecebida } from "./CanalMensagens.js";
import type { ClassificadorDeIntencao } from "./ClassificadorDeIntencao.js";
import type { LimitadorDeTaxa } from "./LimitadorDeTaxa.js";
import type { Menu } from "./Menu.js";
import { mascararRemetente, resumirTextoParaLog } from "./PrivacidadeDeLog.js";
import type {
  RepositorioDeClientes,
  RepositorioDeConversas,
  RepositorioDeEventos,
  RepositorioDeMensagens,
} from "./Repositorios.js";
import { TOPICOS, topicosAtivos, type Topico } from "./Topicos.js";

/** Como a decisão foi tomada. Vai para eventos.origem e explica cada resposta no relatório. */
type OrigemDecisao =
  | "menu" // usuário digitou o número de uma opção
  | "menu_invalido" // digitou um número que não é opção → menu de novo, sem IA
  | "ia" // IA classificou com confiança suficiente
  | "ia_incerta" // IA respondeu, mas indefinido ou confiança baixa → menu
  | "ia_falhou" // erro, timeout ou resposta inválida → menu
  | "sem_ia"; // nenhuma chave configurada → sempre menu

interface Decisao {
  topico: Topico | null; // null = mostrar o menu
  origem: OrigemDecisao;
  confianca: number | null;
  latenciaIaMs: number | null;
}

/** Ajustes do atendimento, montados no app.ts. */
export interface OpcoesDeAtendimento {
  /** Abaixo dessa confiança (0 a 1), o cliente recebe o menu em vez de um palpite da IA. */
  confiancaMinima: number;
  /** Controla o aviso de instabilidade: no máximo 1 por janela (1 minuto) para cada remetente. */
  avisosDeInstabilidade: LimitadorDeTaxa;
  /**
   * Quantas mensagens por janela (1 minuto) cada remetente pode mandar; o excesso é ignorado.
   * null = sem limite. Protege a cota da IA e evita loop entre dois robôs.
   */
  limiteDeMensagens: LimitadorDeTaxa | null;
  /** Controla o aviso de excesso: no máximo 1 por janela (1 minuto) para cada remetente. */
  avisosDeExcesso: LimitadorDeTaxa;
}

/** Enviado quando o banco falha antes de a mensagem ser registrada. Linguagem simples (história 1.6). */
const TEXTO_DE_INSTABILIDADE = "Estamos com instabilidade. Tente de novo em alguns minutos.";
/** Enviado (no máximo 1 vez por minuto) a quem passou do limite de mensagens. */
const TEXTO_DE_EXCESSO = "Recebi muitas mensagens em pouco tempo. Aguarde um momento e tente de novo.";

/**
 * Regra de atendimento. Não sabe o que é Baileys, Gemini nem Postgres: conversa com
 * um CanalMensagens, com os repositórios (interfaces de Repositorios.ts) e, se houver, com
 * um ClassificadorDeIntencao. Tudo chega pelo construtor, inclusive o Menu.
 *
 * Ordem de decisão (da mais barata para a mais cara):
 *   1. número do menu → tópico direto, sem IA
 *   2. IA classifica → se confiante, segue o caminho do tópico
 *   3. qualquer dúvida ou falha → menu (história 1.2: "em vez de adivinhar")
 */
export class Atendimento {
  /** Mensagens sendo processadas agora (por idExterno). Ver processar(). */
  private readonly emAndamento = new Set<string>();

  constructor(
    private readonly canal: CanalMensagens,
    private readonly clientes: RepositorioDeClientes,
    private readonly conversas: RepositorioDeConversas,
    private readonly mensagens: RepositorioDeMensagens,
    private readonly eventos: RepositorioDeEventos,
    private readonly classificador: ClassificadorDeIntencao | null,
    private readonly menu: Menu,
    private readonly opcoes: OpcoesDeAtendimento
  ) {}

  async processar(mensagem: MensagemRecebida): Promise<void> {
    // Se a mesma mensagem chegar duas vezes ao mesmo tempo, só a primeira segue: a segunda
    // veria "processado = false" no banco e responderia de novo (ver registrarEntrada).
    if (this.emAndamento.has(mensagem.idExterno)) return;
    this.emAndamento.add(mensagem.idExterno);
    try {
      if (this.opcoes.limiteDeMensagens && !this.opcoes.limiteDeMensagens.tentar(mensagem.remetente)) {
        await this.recusarExcesso(mensagem);
        return;
      }
      await this.atender(mensagem);
    } finally {
      this.emAndamento.delete(mensagem.idExterno);
    }
  }

  private async atender(mensagem: MensagemRecebida): Promise<void> {
    const registro = await this.gravarEntrada(mensagem);
    if (registro === null) return; // já processada (respondida e gravada): não responder de novo
    const { conversaId, entradaId } = registro;

    // História 1.6: "digitando..." desde o início do processamento, inclusive enquanto a IA pensa.
    await this.canal.indicarDigitando(mensagem.enderecoResposta);

    const decisao = await this.decidir(mensagem.texto);
    const resposta = this.textoDaResposta(decisao);

    // Log sem dados pessoais: telefone mascarado e só o começo do texto (ver PrivacidadeDeLog).
    console.log(
      `[atendimento] ${mascararRemetente(mensagem.remetente)}: ${resumirTextoParaLog(mensagem.texto)} → ${decisao.topico?.id ?? "menu"} (${decisao.origem}` +
        (decisao.confianca !== null ? `, confiança ${decisao.confianca.toFixed(2)}` : "") +
        ")"
    );

    // Se o envio (ou a gravação depois dele) falhar, a entrada continua com processado = false e a
    // próxima entrega desta mesma mensagem é reprocessada (ver registrarEntrada). Custo aceito: se a
    // queda vier DEPOIS do envio, a resposta pode sair repetida; em troca, ninguém fica sem resposta.
    const saidaId = await this.canal.enviarTexto(mensagem.enderecoResposta, resposta);
    await this.mensagens.registrarSaida(conversaId, saidaId, resposta);
    await this.eventos.registrar({
      conversaId,
      tipo: "resposta",
      origem: decisao.origem,
      caminho: decisao.topico?.caminho ?? null,
      intencao: decisao.topico?.id ?? null,
      usouLlm: decisao.latenciaIaMs !== null,
      dados: {
        mensagemId: entradaId, // liga o evento ao texto em mensagens (para ajustar a IA)
        confianca: decisao.confianca,
        latenciaIaMs: decisao.latenciaIaMs,
        classificador: this.classificador?.nome ?? null,
      },
    });
    await this.mensagens.marcarProcessada(entradaId);
  }

  /**
   * Etapa de banco que vem ANTES de qualquer resposta: achar (ou criar) cliente e conversa e
   * gravar a entrada (história 1.1: grava ANTES de processar, mesmo se a IA falhar depois).
   * Devolve null se essa mensagem já foi processada.
   *
   * Se o banco falhar aqui, o cliente ainda não recebeu nada: ele é avisado e o erro segue
   * adiante (o canal registra no log). Falhas DEPOIS do envio não geram aviso: o cliente
   * já foi respondido.
   */
  private async gravarEntrada(mensagem: MensagemRecebida): Promise<{ conversaId: number; entradaId: number } | null> {
    try {
      const clienteId = await this.clientes.obterOuCriar(mensagem.remetente, this.canal.nome);
      const conversaId = await this.conversas.obterOuCriarAtual(clienteId);
      const entradaId = await this.mensagens.registrarEntrada(conversaId, mensagem.idExterno, mensagem.texto);
      return entradaId === null ? null : { conversaId, entradaId };
    } catch (erro) {
      await this.avisar(mensagem, this.opcoes.avisosDeInstabilidade, TEXTO_DE_INSTABILIDADE);
      throw erro;
    }
  }

  /**
   * Mensagem acima do limite por remetente: não é gravada, não vai para a IA e não recebe a
   * resposta normal. O remetente é avisado (e o log registra) uma única vez por minuto; o resto
   * do excesso é ignorado em silêncio, senão dois robôs conversando entrariam em loop.
   */
  private async recusarExcesso(mensagem: MensagemRecebida): Promise<void> {
    if (!this.opcoes.avisosDeExcesso.tentar(mensagem.remetente)) return;
    console.warn(`[atendimento] ${mascararRemetente(mensagem.remetente)} passou do limite de mensagens por minuto: o excesso será ignorado`);
    await this.avisar(mensagem, null, TEXTO_DE_EXCESSO);
  }

  /**
   * Envia um aviso do sistema ao remetente. Com limitador, no máximo 1 por janela (1 minuto) para cada
   * remetente. Nunca lança: se o canal também falhar, só registra.
   */
  private async avisar(mensagem: MensagemRecebida, limitador: LimitadorDeTaxa | null, texto: string): Promise<void> {
    if (limitador && !limitador.tentar(mensagem.remetente)) return;
    try {
      await this.canal.enviarTexto(mensagem.enderecoResposta, texto);
    } catch (erro) {
      console.warn("[atendimento] não consegui avisar o cliente:", erro instanceof Error ? erro.message : erro);
    }
  }

  /** Resposta do tópico; sem tópico, o menu (com aviso quando o cliente digitou um número que não é opção). */
  private textoDaResposta(decisao: Decisao): string {
    if (decisao.topico) return decisao.topico.respostaProvisoria;
    return decisao.origem === "menu_invalido" ? this.menu.textoOpcaoInvalida() : this.menu.texto();
  }

  private async decidir(texto: string): Promise<Decisao> {
    const leitura = this.menu.interpretar(texto);
    if (leitura.tipo === "opcao") return { topico: leitura.topico, origem: "menu", confianca: null, latenciaIaMs: null };
    if (leitura.tipo === "invalida") return { topico: null, origem: "menu_invalido", confianca: null, latenciaIaMs: null };

    if (!this.classificador) return { topico: null, origem: "sem_ia", confianca: null, latenciaIaMs: null };

    const inicio = Date.now();
    try {
      const { topico, confianca } = await this.classificador.classificar(texto, topicosAtivos());
      const latenciaIaMs = Date.now() - inicio;
      const encontrado = TOPICOS.find((t) => t.id === topico && t.ativo) ?? null;

      if (encontrado && confianca >= this.opcoes.confiancaMinima) {
        return { topico: encontrado, origem: "ia", confianca, latenciaIaMs };
      }
      return { topico: null, origem: "ia_incerta", confianca, latenciaIaMs };
    } catch (erro) {
      // Degrada para o menu em vez de deixar o cliente sem resposta.
      console.error("[atendimento] classificador falhou, exibindo menu:", erro instanceof Error ? erro.message : erro);
      return { topico: null, origem: "ia_falhou", confianca: null, latenciaIaMs: Date.now() - inicio };
    }
  }
}
