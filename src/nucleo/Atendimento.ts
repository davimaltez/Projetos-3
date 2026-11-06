import type { CanalMensagens, MensagemRecebida } from "./CanalMensagens.js";
import type { ClassificadorDeIntencao } from "./ClassificadorDeIntencao.js";
import type { GeradorDeResposta, TrocaDeConversa } from "./GeradorDeResposta.js";
import type { LimitadorDeTaxa } from "./LimitadorDeTaxa.js";
import type { Menu, Selecao } from "./Menu.js";
import type { ServicoDeFila } from "./ServicoDeFila.js";
import { MotivoDaTransferencia, PrioridadeTicket, StatusTicket } from "./entidades/Enums.js";
import { ASSUNTO_PADRAO, type PedidoDeAtendimento } from "./PedidoDeAtendimento.js";
import { mascararRemetente, resumirTextoParaLog } from "./PrivacidadeDeLog.js";
import type {
  DadosDoCliente,
  EstadoDoMenu,
  RepositorioDeClientes,
  RepositorioDeContextoDoMenu,
  RepositorioDeConversas,
  RepositorioDeEventos,
  RepositorioDeMensagens,
  TransferenciaPendente,
} from "./Repositorios.js";
import { TOPICOS, topicosAtivos, type Topico } from "./Topicos.js";

/** Como a decisão foi tomada. Vai para eventos.origem e explica cada resposta no relatório. */
type OrigemDecisao =
  | "menu" // usuário digitou o número de uma opção
  | "menu_texto" // usuário escreveu algo que corresponde a uma opção do nível (sem IA)
  | "menu_invalido" // digitou um número que não é opção → menu de novo, sem IA
  | "ia" // IA classificou com confiança suficiente
  | "ia_incerta" // IA respondeu, mas indefinido ou confiança baixa → menu
  | "ia_falhou" // erro, timeout ou resposta inválida → menu
  | "ia_gerada" // modo pergunta: a IA escreveu a resposta com base no manual
  | "ia_sem_resposta" // modo pergunta: o manual não cobre → frase fixa
  | "ia_gerada_falhou" // modo pergunta: erro ou timeout do gerador → frase fixa
  | "sem_ia"; // nenhuma chave configurada → sempre menu

interface Decisao {
  topico: Topico | null; // null = mostrar o menu
  origem: OrigemDecisao;
  confianca: number | null;
  latenciaIaMs: number | null;
  /** Texto a enviar quando difere do padrão (sub-menu, folha, menu de um nível). null = padrão. */
  texto: string | null;
  /** Nível do menu depois desta resposta (ids do topo até o nível atual). [] = menu principal. */
  caminhoMenu: string[];
  /** true = o cliente está no modo "escreva sua pergunta": o próximo texto vai para o gerador. */
  perguntando: boolean;
  /** Últimas perguntas e respostas do modo pergunta (vazio fora dele). */
  historico: readonly TrocaDeConversa[];
  /** Contagem de mensagens consecutivas não reconhecidas após esta decisão. */
  falhasSeguidas: number;
  /** Proposta de transferência aguardando confirmação (sim/não) do cliente. */
  transferenciaPendente: TransferenciaPendente | null;
  /** Pedido pronto para criação do ticket (quando confirmado ou pedido explícito). */
  solicitarPedido: PedidoDeAtendimento | null;
}

/** Valores das decisões sem IA e fora do modo pergunta. */
const PADRAO = {
  confianca: null,
  latenciaIaMs: null,
  perguntando: false,
  historico: [],
  falhasSeguidas: 0,
  transferenciaPendente: null,
  solicitarPedido: null,
} as const;

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

// Modo "escreva sua pergunta" (história 1.5). Frases fixas: o que a IA não cobre, o grupo escreve.
const TEXTO_NAO_ENCONTRADO = "Não encontrei essa informação no nosso manual. Tente escrever de outro jeito.";
const TEXTO_FALHA_GERADOR = "Não consegui responder agora. Tente de novo em instantes.";
const TEXTO_SEM_GERADOR = "No momento não consigo responder perguntas escritas. Escolha uma das opções do menu.";
const RODAPE_PERGUNTA = "Pode escrever outra dúvida ou digitar 0 para voltar ao menu.";
/** Quantas trocas o gerador enxerga, para entender "e se der erro de novo?". */
const MAX_TROCAS = 3;

// Mensagens da confirmação de atendimento humano (história 2.1)
const TEXTO_CONFIRMAR_TRANSFERENCIA_FALHAS =
  "Não consegui entender sua solicitação. Deseja falar com um atendente humano? Digite Sim ou Não (ou 1 para Sim / 2 para Não).";
const TEXTO_CONFIRMAR_TRANSFERENCIA_PERGUNTA =
  "Não encontrei essa informação no nosso manual. Deseja falar com um atendente humano? Digite Sim ou Não (ou 1 para Sim / 2 para Não).";
const TEXTO_RESPOSTA_AMBIGUA_CONFIRMACAO =
  "Por favor, responda apenas Sim ou Não (ou 1 para Sim / 2 para Não): você deseja falar com um atendente humano?";
const TEXTO_RECUSA_TRANSFERENCIA = "Tudo bem! Vamos continuar por aqui.";

function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ehConfirmacaoSim(texto: string): boolean {
  const norm = normalizarTexto(texto);
  return /^(?:sim|s|1|quero|por favor|com certeza|claro|pode ser|positivo)$/.test(norm);
}

function ehConfirmacaoNao(texto: string): boolean {
  const norm = normalizarTexto(texto);
  return /^(?:nao|n|2|0|cancelar|voltar|sair|negativo)$/.test(norm);
}

/**
 * Regra de atendimento. Não sabe o que é Baileys, Gemini nem Postgres: conversa com
 * um CanalMensagens, com os repositórios (interfaces de Repositorios.ts) e, se houver, com
 * um ClassificadorDeIntencao e um GeradorDeResposta. Tudo chega pelo construtor, inclusive o Menu.
 *
 * Ordem de decisão (da mais barata para a mais cara):
 *   0. pedido de atendente humano ("atendente", "humano"): vale em qualquer ponto
 *   0. no modo pergunta: 0/"menu" sai; texto vai para o gerador (que consulta o manual)
 *   1. número do menu → tópico direto ou sub-menu, sem IA
 *   2. texto que corresponde a UMA opção do nível atual → opção direta, sem IA
 *   3. IA escolhe entre as opções do nível atual (na raiz, entre os tópicos principais)
 *   4. qualquer dúvida ou falha → menu do nível atual (história 1.2: "em vez de adivinhar")
 */
export class Atendimento {
  /** Mensagens sendo processadas agora (por idExterno). Ver processar(). */
  private readonly emAndamento = new Set<string>();
  private readonly porRemetente = new Map<string, Promise<void>>();

  constructor(
    private readonly canal: CanalMensagens,
    private readonly clientes: RepositorioDeClientes,
    private readonly conversas: RepositorioDeConversas,
    private readonly mensagens: RepositorioDeMensagens,
    private readonly eventos: RepositorioDeEventos,
    private readonly contextoMenu: RepositorioDeContextoDoMenu,
    private readonly classificador: ClassificadorDeIntencao | null,
    private readonly menu: Menu,
    private readonly opcoes: OpcoesDeAtendimento,
    private readonly fila: ServicoDeFila,
    private readonly gerador: GeradorDeResposta | null = null
  ) {}

  async processar(mensagem: MensagemRecebida): Promise<void> {
    // Se a mesma mensagem chegar duas vezes ao mesmo tempo, só a primeira segue: a segunda
    // veria "processado = false" no banco e responderia de novo (ver registrarEntrada).
    if (this.emAndamento.has(mensagem.idExterno)) return;
    this.emAndamento.add(mensagem.idExterno);
    // Preserva a ordem do menu e da transferência em eventos separados do canal.
    const anterior = this.porRemetente.get(mensagem.remetente) ?? Promise.resolve();
    const atual = anterior.catch(() => {}).then(async () => {
      if (this.opcoes.limiteDeMensagens && !this.opcoes.limiteDeMensagens.tentar(mensagem.remetente)) {
        await this.recusarExcesso(mensagem);
        return;
      }
      await this.atender(mensagem);
    });
    this.porRemetente.set(mensagem.remetente, atual);
    try {
      await atual;
    } finally {
      this.emAndamento.delete(mensagem.idExterno);
      if (this.porRemetente.get(mensagem.remetente) === atual) this.porRemetente.delete(mensagem.remetente);
    }
  }

  private async atender(mensagem: MensagemRecebida): Promise<void> {
    const registro = await this.gravarEntrada(mensagem);
    if (registro === null) return; // já processada (respondida e gravada): não responder de novo
    const { conversaId, entradaId, clienteId } = registro;

    // História 1.1: em que nível do menu o cliente está e se está no modo pergunta.
    const estadoAnterior = await this.estadoAtual(conversaId);
    const humano = await this.operarFila(mensagem, () => this.fila.obterAtendimentoHumano(conversaId));
    // Durante a espera/atendimento, registra novas entradas para o operador, sem menu ou IA.
    // Um pedido explícito repetido recebe o mesmo protocolo, inclusive após falha de envio.
    if (humano && !this.pedidoExplicitoDeHumano(mensagem.texto, estadoAnterior.caminho)) {
      if (estadoAnterior.transferenciaPendente && ehConfirmacaoSim(mensagem.texto)) {
        // Se por falha anterior o ticket já foi criado no banco, mas a pendência ainda constava no estado
        const resposta = humano.getStatus() === StatusTicket.EM_ATENDIMENTO
          ? `Seu atendimento já está com a equipe. Protocolo: ${humano.getProtocolo()}.\nVocê pode continuar enviando detalhes por aqui.`
          : `Seu atendimento foi encaminhado para a equipe. Protocolo: ${humano.getProtocolo()}.\nVocê pode enviar mais detalhes por aqui enquanto aguarda.`;
        await this.guardarEstado(conversaId, estadoAnterior, {
          caminho: [],
          perguntando: false,
          historico: [],
          falhasSeguidas: 0,
          transferenciaPendente: null,
        });
        const saidaId = await this.canal.enviarTexto(mensagem.enderecoResposta, resposta);
        await this.mensagens.registrarSaida(conversaId, saidaId, resposta);
        await this.mensagens.marcarProcessada(entradaId);
        return;
      }
      await this.mensagens.marcarProcessada(entradaId);
      return;
    }

    // História 1.6: "digitando..." desde o início do processamento, inclusive enquanto a IA pensa.
    await this.canal.indicarDigitando(mensagem.enderecoResposta);

    const clienteDados = this.clientes.obterPorId ? await this.clientes.obterPorId(clienteId) : null;
    const empresaContexto = this.contextoMenu.obterEmpresa ? await this.contextoMenu.obterEmpresa(conversaId) : null;
    const clienteInfo: DadosDoCliente = {
      nome: clienteDados?.nome ?? mensagem.remetente,
      empresa: clienteDados?.empresa ?? empresaContexto ?? null,
      telefone: clienteDados?.telefone ?? mensagem.remetente,
    };

    const decisao = await this.decidir(mensagem.texto, estadoAnterior, clienteInfo);
    const ticket = decisao.solicitarPedido
      ? await this.operarFila(mensagem, () => this.fila.solicitarAtendimentoHumano(conversaId, decisao.solicitarPedido!))
      : decisao.topico?.id === "atendimento_humano"
      ? await this.operarFila(mensagem, () => this.fila.solicitarAtendimentoHumano(conversaId))
      : null;
    const resposta = ticket
      ? ticket.getStatus() === StatusTicket.EM_ATENDIMENTO
        ? `Seu atendimento já está com a equipe. Protocolo: ${ticket.getProtocolo()}.\nVocê pode continuar enviando detalhes por aqui.`
        : `Seu atendimento foi encaminhado para a equipe. Protocolo: ${ticket.getProtocolo()}.\nVocê pode enviar mais detalhes por aqui enquanto aguarda.`
      : this.textoDaResposta(decisao);

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
    // O estado do menu só é gravado depois do envio: se o envio falhar, a mensagem é reprocessada
    // a partir do estado ANTERIOR, em vez de navegar duas vezes.
    await this.guardarEstado(conversaId, estadoAnterior, {
      caminho: decisao.caminhoMenu,
      perguntando: decisao.perguntando,
      historico: decisao.historico,
      falhasSeguidas: decisao.falhasSeguidas,
      transferenciaPendente: decisao.transferenciaPendente,
    });
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
        gerador: this.gerador?.nome ?? null,
        caminhoMenu: decisao.caminhoMenu, // nível do menu depois desta resposta
        perguntando: decisao.perguntando, // true = continua no modo pergunta
        falhasSeguidas: decisao.falhasSeguidas,
        transferenciaPendente: decisao.transferenciaPendente !== null,
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
  private async gravarEntrada(
    mensagem: MensagemRecebida
  ): Promise<{ conversaId: number; entradaId: number; clienteId: number } | null> {
    try {
      const clienteId = await this.clientes.obterOuCriar(mensagem.remetente, this.canal.nome);
      const conversaId = await this.conversas.obterOuCriarAtual(clienteId);
      const entradaId = await this.mensagens.registrarEntrada(conversaId, mensagem.idExterno, mensagem.texto);
      return entradaId === null ? null : { conversaId, entradaId, clienteId };
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

  /** Texto específico da decisão (sub-menu, folha, resposta gerada), senão a resposta do tópico, senão o menu. */
  private textoDaResposta(decisao: Decisao): string {
    if (decisao.texto !== null) return decisao.texto;
    if (decisao.topico) return decisao.topico.respostaProvisoria;
    return this.menu.texto();
  }

  private async decidir(texto: string, estado: EstadoDoMenu, clienteInfo: DadosDoCliente): Promise<Decisao> {
    // 0. Confirmação pendente de transferência para humano:
    // Avaliada primeiro, antes de qualquer navegação de menu ou IA.
    if (estado.transferenciaPendente) {
      if (ehConfirmacaoSim(texto)) {
        const pedido: PedidoDeAtendimento = {
          assunto: estado.transferenciaPendente.assunto,
          prioridade: estado.transferenciaPendente.prioridade,
          motivo: estado.transferenciaPendente.motivo,
          dados: estado.transferenciaPendente.dados,
        };
        const topicoHumano = TOPICOS.find((t) => t.id === "atendimento_humano") ?? null;
        return {
          ...PADRAO,
          topico: topicoHumano,
          origem: "menu",
          texto: null,
          caminhoMenu: [],
          perguntando: false,
          falhasSeguidas: 0,
          transferenciaPendente: null,
          solicitarPedido: pedido,
        };
      }

      if (ehConfirmacaoNao(texto)) {
        return {
          ...PADRAO,
          topico: null,
          origem: "menu",
          texto: `${TEXTO_RECUSA_TRANSFERENCIA}\n\n${this.menu.texto()}`,
          caminhoMenu: [],
          perguntando: false,
          falhasSeguidas: 0,
          transferenciaPendente: null,
          solicitarPedido: null,
        };
      }

      // Resposta ambígua: reforça a pergunta mantendo a pendência ativa
      return {
        ...PADRAO,
        topico: null,
        origem: "menu",
        texto: TEXTO_RESPOSTA_AMBIGUA_CONFIRMACAO,
        caminhoMenu: [...estado.caminho],
        perguntando: estado.perguntando,
        historico: estado.historico,
        falhasSeguidas: estado.falhasSeguidas ?? 0,
        transferenciaPendente: estado.transferenciaPendente,
        solicitarPedido: null,
      };
    }

    // 0a) Pedido explícito de atendente ("atendente", "humano", "falar com uma pessoa"):
    //     vale em qualquer ponto, inclusive dentro do modo pergunta. O ticket é criado no atender().
    const topicoHumano = TOPICOS.find((t) => t.id === "atendimento_humano");
    if (topicoHumano && this.comandoDeHumano(texto)) {
      const topicoAtual = this.menu.topicoDoCaminho(estado.caminho);
      const assunto = topicoAtual ? topicoAtual.rotulo : ASSUNTO_PADRAO;
      const pedido: PedidoDeAtendimento = {
        assunto,
        prioridade: PrioridadeTicket.MEDIA,
        motivo: MotivoDaTransferencia.PEDIDO_DO_CLIENTE,
        dados: {
          clienteNome: clienteInfo.nome,
          empresa: clienteInfo.empresa,
          solicitacaoDireta: true,
          caminhoMenu: estado.caminho,
        },
      };
      return {
        ...PADRAO,
        topico: topicoHumano,
        origem: "menu",
        texto: null,
        caminhoMenu: [],
        falhasSeguidas: 0,
        transferenciaPendente: null,
        solicitarPedido: pedido,
      };
    }

    // Caminho que não existe mais (o menu mudou depois do deploy) vira o menu principal.
    const caminho = this.menu.normalizarCaminho(estado.caminho);

    // 0b) Modo "escreva sua pergunta": 0 ou "menu" saem; texto vai para o gerador.
    //     Qualquer outro número sai do modo e vale como opção do menu (segue abaixo).
    if (estado.perguntando && this.gerador && caminho.length > 0) {
      const numero = this.menu.lerNumero(texto);
      if (numero === 0 || this.menu.ehPedidoDeVoltar(texto)) {
        return { ...this.mostrarNivel("menu", caminho), falhasSeguidas: 0 };
      }
      if (numero === null) {
        return this.gerarResposta(texto, caminho, estado.historico, this.gerador, clienteInfo);
      }
    }

    // 1) Número: NUNCA chama a IA. Vale para o nível do menu em que o cliente está.
    const leitura = this.menu.interpretar(texto, caminho);
    if (leitura.tipo === "invalida") {
      const falhas = (estado.falhasSeguidas ?? 0) + 1;
      if (falhas >= 2) {
        const pendente: TransferenciaPendente = {
          motivo: MotivoDaTransferencia.FALHAS_SEGUIDAS,
          assunto: "Dificuldade no autoatendimento",
          prioridade: PrioridadeTicket.ALTA,
          dados: {
            clienteNome: clienteInfo.nome,
            empresa: clienteInfo.empresa,
            falhasConsecutivas: 2,
            ultimaTentativa: texto,
            caminhoMenu: caminho,
          },
        };
        return {
          ...PADRAO,
          topico: null,
          origem: "menu_invalido",
          texto: TEXTO_CONFIRMAR_TRANSFERENCIA_FALHAS,
          caminhoMenu: leitura.novoCaminho,
          falhasSeguidas: 2,
          transferenciaPendente: pendente,
        };
      }
      return {
        ...PADRAO,
        topico: null,
        origem: "menu_invalido",
        texto: leitura.texto,
        caminhoMenu: leitura.novoCaminho,
        falhasSeguidas: falhas,
      };
    }
    if (leitura.tipo !== "livre") return this.decisaoDeSelecao(leitura, "menu", clienteInfo, estado);

    // 2) Texto que corresponde a UMA opção do nível atual: também sem IA.
    const porTexto = this.menu.buscarPorTexto(texto, caminho);
    if (porTexto) return this.decisaoDeSelecao(porTexto, "menu_texto", clienteInfo, estado);

    // 3) Sem IA configurada: mostra o menu do nível atual.
    if (!this.classificador) {
      const falhas = (estado.falhasSeguidas ?? 0) + 1;
      if (falhas >= 2) {
        const pendente: TransferenciaPendente = {
          motivo: MotivoDaTransferencia.FALHAS_SEGUIDAS,
          assunto: "Dificuldade no autoatendimento",
          prioridade: PrioridadeTicket.ALTA,
          dados: {
            clienteNome: clienteInfo.nome,
            empresa: clienteInfo.empresa,
            falhasConsecutivas: 2,
            ultimaTentativa: texto,
            caminhoMenu: caminho,
          },
        };
        return {
          ...PADRAO,
          topico: null,
          origem: "sem_ia",
          texto: TEXTO_CONFIRMAR_TRANSFERENCIA_FALHAS,
          caminhoMenu: [...caminho],
          falhasSeguidas: 2,
          transferenciaPendente: pendente,
        };
      }
      return { ...this.mostrarNivel("sem_ia", caminho), falhasSeguidas: falhas };
    }

    // 4) IA. Na raiz escolhe entre os tópicos principais; num sub-menu, só entre as opções daquele nível.
    return caminho.length === 0
      ? this.classificarTopico(texto, this.classificador, estado, clienteInfo)
      : this.classificarNoNivel(texto, caminho, this.classificador, estado, clienteInfo);
  }

  /** Opção escolhida (por número, texto ou IA): vira a decisão com o texto e o novo estado do menu. */
  private decisaoDeSelecao(
    selecao: Selecao,
    origem: OrigemDecisao,
    clienteInfo: DadosDoCliente,
    estado: EstadoDoMenu
  ): Decisao {
    if (selecao.tipo === "perguntar") {
      // Sem gerador (sem chave ou sem manual), a opção avisa em vez de prender o cliente num modo mudo.
      if (!this.gerador) {
        return {
          ...this.mostrarNivel(origem, selecao.novoCaminho),
          texto: `${TEXTO_SEM_GERADOR}\n\n${this.menu.texto(selecao.novoCaminho)}`,
          falhasSeguidas: 0,
        };
      }
      return {
        ...PADRAO,
        topico: selecao.topico,
        origem,
        texto: selecao.texto,
        caminhoMenu: selecao.novoCaminho,
        perguntando: true,
        falhasSeguidas: 0,
      };
    }
    if (selecao.topico?.id === "atendimento_humano") {
      const topicoAtual = this.menu.topicoDoCaminho(estado.caminho);
      const assunto = topicoAtual ? topicoAtual.rotulo : ASSUNTO_PADRAO;
      const pedido: PedidoDeAtendimento = {
        assunto,
        prioridade: PrioridadeTicket.MEDIA,
        motivo: MotivoDaTransferencia.PEDIDO_DO_CLIENTE,
        dados: {
          clienteNome: clienteInfo.nome,
          empresa: clienteInfo.empresa,
          solicitacaoDireta: true,
          caminhoMenu: estado.caminho,
        },
      };
      return {
        ...PADRAO,
        topico: selecao.topico,
        origem,
        texto: selecao.texto,
        caminhoMenu: [],
        falhasSeguidas: 0,
        solicitarPedido: pedido,
      };
    }
    return {
      ...PADRAO,
      topico: selecao.topico,
      origem,
      texto: selecao.texto,
      caminhoMenu: selecao.tipo === "navegacao" ? selecao.novoCaminho : [],
      falhasSeguidas: 0,
    };
  }

  /** Sem escolha: mostra o menu do nível em que o cliente está, sem tirá-lo dele. */
  private mostrarNivel(origem: OrigemDecisao, caminho: readonly string[]): Decisao {
    return { ...PADRAO, topico: null, origem, texto: this.menu.texto(caminho), caminhoMenu: [...caminho] };
  }

  /** Modo pergunta: o gerador responde com base no manual. Nunca lança: falha vira frase fixa. */
  private async gerarResposta(
    texto: string,
    caminho: readonly string[],
    historico: readonly TrocaDeConversa[],
    gerador: GeradorDeResposta,
    clienteInfo: DadosDoCliente
  ): Promise<Decisao> {
    const base = {
      ...PADRAO,
      topico: this.menu.topicoDoCaminho(caminho),
      caminhoMenu: [...caminho],
      perguntando: true, // continua no modo até o cliente digitar 0
      historico,
    };
    const inicio = Date.now();
    try {
      const { encontrou, texto: resposta } = await gerador.gerar(texto, historico);
      const latenciaIaMs = Date.now() - inicio;

      if (encontrou) {
        const troca = { cliente: texto.slice(0, 300), resposta: resposta.slice(0, 600) };
        return {
          ...base,
          origem: "ia_gerada",
          latenciaIaMs,
          texto: `${resposta}\n\n${RODAPE_PERGUNTA}`,
          historico: [...historico, troca].slice(-MAX_TROCAS),
          falhasSeguidas: 0,
        };
      }

      // Pergunta sem resposta no manual: propõe transferência com confirmação do cliente
      const topicoAtual = this.menu.topicoDoCaminho(caminho);
      const rotulo = topicoAtual ? topicoAtual.rotulo : "Dúvida sobre o sistema";
      const pendente: TransferenciaPendente = {
        motivo: MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA,
        assunto: `${rotulo} - Pergunta sem resposta`,
        prioridade: PrioridadeTicket.MEDIA,
        dados: {
          clienteNome: clienteInfo.nome,
          empresa: clienteInfo.empresa,
          topico: topicoAtual?.id ?? "operacao_sistema",
          ultimaPergunta: texto,
          historicoPerguntas: historico,
        },
      };

      return {
        ...base,
        origem: "ia_sem_resposta",
        latenciaIaMs,
        texto: TEXTO_CONFIRMAR_TRANSFERENCIA_PERGUNTA,
        falhasSeguidas: 0,
        transferenciaPendente: pendente,
      };
    } catch (erro) {
      console.error("[atendimento] gerador falhou:", erro instanceof Error ? erro.message : erro);
      return {
        ...base,
        origem: "ia_gerada_falhou",
        latenciaIaMs: Date.now() - inicio,
        texto: `${TEXTO_FALHA_GERADOR}\n\n${RODAPE_PERGUNTA}`,
        falhasSeguidas: 0,
      };
    }
  }

  /** Menu principal: a IA escolhe entre os tópicos principais. */
  private async classificarTopico(
    texto: string,
    classificador: ClassificadorDeIntencao,
    estado: EstadoDoMenu,
    clienteInfo: DadosDoCliente
  ): Promise<Decisao> {
    const inicio = Date.now();
    try {
      const { topico, confianca } = await classificador.classificar(texto, topicosAtivos());
      const latenciaIaMs = Date.now() - inicio;
      const encontrado = TOPICOS.find((t) => t.id === topico && t.ativo) ?? null;

      if (encontrado && confianca >= this.opcoes.confiancaMinima) {
        if (encontrado.id === "atendimento_humano") {
          const pedido: PedidoDeAtendimento = {
            assunto: ASSUNTO_PADRAO,
            prioridade: PrioridadeTicket.MEDIA,
            motivo: MotivoDaTransferencia.PEDIDO_DO_CLIENTE,
            dados: {
              clienteNome: clienteInfo.nome,
              empresa: clienteInfo.empresa,
              solicitacaoDireta: true,
              caminhoMenu: [],
            },
          };
          return {
            ...PADRAO,
            topico: encontrado,
            origem: "ia",
            confianca,
            latenciaIaMs,
            texto: null,
            caminhoMenu: [],
            falhasSeguidas: 0,
            solicitarPedido: pedido,
          };
        }
        // Tópico com sub-menu: abre o sub-menu em vez de mandar o texto provisório.
        const submenu = this.menu.abrirTopico(encontrado);
        return {
          ...PADRAO,
          topico: encontrado,
          origem: "ia",
          confianca,
          latenciaIaMs,
          texto: submenu?.texto ?? null,
          caminhoMenu: submenu?.novoCaminho ?? [],
          falhasSeguidas: 0,
        };
      }

      // IA incerta: não reconheceu com confiança mínima
      const falhas = (estado.falhasSeguidas ?? 0) + 1;
      if (falhas >= 2) {
        const pendente: TransferenciaPendente = {
          motivo: MotivoDaTransferencia.FALHAS_SEGUIDAS,
          assunto: "Dificuldade no autoatendimento",
          prioridade: PrioridadeTicket.ALTA,
          dados: {
            clienteNome: clienteInfo.nome,
            empresa: clienteInfo.empresa,
            falhasConsecutivas: 2,
            ultimaTentativa: texto,
            caminhoMenu: [],
          },
        };
        return {
          ...PADRAO,
          topico: null,
          origem: "ia_incerta",
          confianca,
          latenciaIaMs,
          texto: TEXTO_CONFIRMAR_TRANSFERENCIA_FALHAS,
          caminhoMenu: [],
          falhasSeguidas: 2,
          transferenciaPendente: pendente,
        };
      }
      return { ...this.mostrarNivel("ia_incerta", []), confianca, latenciaIaMs, falhasSeguidas: falhas };
    } catch (erro) {
      // Degrada para o menu em vez de deixar o cliente sem resposta (falha técnica da IA não incrementa falhas)
      console.error("[atendimento] classificador falhou, exibindo menu:", erro instanceof Error ? erro.message : erro);
      return { ...this.mostrarNivel("ia_falhou", []), latenciaIaMs: Date.now() - inicio, falhasSeguidas: estado.falhasSeguidas ?? 0 };
    }
  }

  /** Sub-menu: a IA escolhe só entre as opções do nível atual. Dúvida ou falha repete o nível. */
  private async classificarNoNivel(
    texto: string,
    caminho: readonly string[],
    classificador: ClassificadorDeIntencao,
    estado: EstadoDoMenu,
    clienteInfo: DadosDoCliente
  ): Promise<Decisao> {
    const inicio = Date.now();
    try {
      const { id, confianca } = await classificador.escolherOpcao(texto, this.menu.opcoesDoNivel(caminho));
      const latenciaIaMs = Date.now() - inicio;
      const selecao = id !== null && confianca >= this.opcoes.confiancaMinima ? this.menu.escolher(caminho, id) : null;

      // O cliente já escreveu a dúvida e a IA mandou para "Outra dúvida": responde agora, sem pedir de novo.
      if (selecao?.tipo === "perguntar" && this.gerador) {
        const resposta = await this.gerarResposta(texto, selecao.novoCaminho, [], this.gerador, clienteInfo);
        return { ...resposta, confianca, latenciaIaMs: latenciaIaMs + (resposta.latenciaIaMs ?? 0) };
      }
      if (selecao) return { ...this.decisaoDeSelecao(selecao, "ia", clienteInfo, estado), confianca, latenciaIaMs };

      // IA incerta dentro do sub-menu
      const falhas = (estado.falhasSeguidas ?? 0) + 1;
      if (falhas >= 2) {
        const pendente: TransferenciaPendente = {
          motivo: MotivoDaTransferencia.FALHAS_SEGUIDAS,
          assunto: "Dificuldade no autoatendimento",
          prioridade: PrioridadeTicket.ALTA,
          dados: {
            clienteNome: clienteInfo.nome,
            empresa: clienteInfo.empresa,
            falhasConsecutivas: 2,
            ultimaTentativa: texto,
            caminhoMenu: caminho,
          },
        };
        return {
          ...PADRAO,
          topico: null,
          origem: "ia_incerta",
          confianca,
          latenciaIaMs,
          texto: TEXTO_CONFIRMAR_TRANSFERENCIA_FALHAS,
          caminhoMenu: [...caminho],
          falhasSeguidas: 2,
          transferenciaPendente: pendente,
        };
      }
      return { ...this.mostrarNivel("ia_incerta", caminho), confianca, latenciaIaMs, falhasSeguidas: falhas };
    } catch (erro) {
      console.error("[atendimento] classificador falhou, exibindo o menu do nível:", erro instanceof Error ? erro.message : erro);
      return { ...this.mostrarNivel("ia_falhou", caminho), latenciaIaMs: Date.now() - inicio, falhasSeguidas: estado.falhasSeguidas ?? 0 };
    }
  }

  /** "atendente", "humano", "pessoa" ou "falar com um(a) atendente/humano/pessoa", escritos sozinhos. */
  private comandoDeHumano(texto: string): boolean {
    return /^(?:falar com (?:um |uma )?)?(?:atendente|humano|pessoa)[.!?]?$/.test(texto.trim().toLowerCase());
  }

  /** Operação na fila: se o banco falhar, o cliente é avisado (no máximo 1 vez por minuto) e o erro segue adiante. */
  private async operarFila<T>(mensagem: MensagemRecebida, operacao: () => Promise<T>): Promise<T> {
    try {
      return await operacao();
    } catch (erro) {
      await this.avisar(mensagem, this.opcoes.avisosDeInstabilidade, TEXTO_DE_INSTABILIDADE);
      throw erro;
    }
  }

  private pedidoExplicitoDeHumano(texto: string, caminho: readonly string[]): boolean {
    if (this.comandoDeHumano(texto)) return true;
    const leitura = this.menu.interpretar(texto, caminho);
    return leitura.tipo === "opcao" && leitura.topico.id === "atendimento_humano";
  }

  /** Estado atual do menu. Se o banco falhar aqui, o cliente cai no menu principal (nunca fica sem resposta). */
  private async estadoAtual(conversaId: number): Promise<EstadoDoMenu> {
    try {
      return await this.contextoMenu.obter(conversaId);
    } catch {
      return { caminho: [], perguntando: false, historico: [], falhasSeguidas: 0, transferenciaPendente: null };
    }
  }

  /**
   * Grava o novo estado só se mudou. No modo pergunta grava sempre: isso renova a validade
   * (10 minutos) a cada pergunta. Falha aqui não impede a resposta nem a gravação da saída.
   */
  private async guardarEstado(conversaId: number, anterior: EstadoDoMenu, novo: EstadoDoMenu): Promise<void> {
    const igual =
      anterior.perguntando === novo.perguntando &&
      anterior.falhasSeguidas === novo.falhasSeguidas &&
      anterior.transferenciaPendente === novo.transferenciaPendente &&
      anterior.historico.length === novo.historico.length &&
      anterior.caminho.length === novo.caminho.length &&
      anterior.caminho.every((id, i) => id === novo.caminho[i]);
    if (igual && !novo.perguntando && !novo.transferenciaPendente) return;

    try {
      await this.contextoMenu.salvar(conversaId, novo);
    } catch (erro) {
      console.warn("[atendimento] não consegui salvar o estado do menu:", erro instanceof Error ? erro.message : erro);
    }
  }
}