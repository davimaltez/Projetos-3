import makeWASocket, {
  DisconnectReason,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  normalizeMessageContent,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "baileys";
import type { Boom } from "@hapi/boom";
import { pino } from "pino";
import qrcodeTerminal from "qrcode-terminal";
import type {
  CanalMensagens,
  ManipuladorDeMensagem,
  MensagemRecebida,
} from "../../nucleo/CanalMensagens.js";
import type { RitmoDeDigitacao } from "../RitmoDeDigitacao.js";
import type { PoliticaDeReconexao } from "./PoliticaDeReconexao.js";

/**
 * Quedas em que reconectar não adianta (ou piora): registra o motivo e para.
 * Tudo que não está aqui (408, 428, 503, 515...) é queda passageira: reconecta.
 */
const MOTIVOS_FATAIS = new Map<number, string>([
  [DisconnectReason.loggedOut, "sessão encerrada pelo celular. Apague a pasta da sessão e escaneie o QR de novo."],
  // Outra instância abriu a MESMA sessão (ex.: bot na VM e no notebook com a mesma pasta de
  // sessão). Reconectar aqui gera um ping-pong infinito entre as duas, e isso chama atenção do WhatsApp.
  [DisconnectReason.connectionReplaced, "sessão aberta em outro lugar. Não vou reconectar."],
  // Costuma indicar número restrito ou banido: insistir só piora a situação.
  [
    DisconnectReason.forbidden,
    "acesso negado pelo WhatsApp (403): o número pode estar restrito ou banido. Não vou reconectar; confira o número no celular antes de tentar de novo.",
  ],
  [DisconnectReason.badSession, "sessão inválida (500). Apague a pasta da sessão e escaneie o QR de novo."],
  [
    DisconnectReason.multideviceMismatch,
    "incompatibilidade de multi-aparelho (411). Apague a pasta da sessão e escaneie o QR de novo.",
  ],
]);

/** Conta oficial do próprio WhatsApp (avisos do aplicativo): não é cliente e não aceita resposta. */
const CONTA_OFICIAL_WHATSAPP = "0@s.whatsapp.net";

/**
 * Canal WhatsApp via Baileys (cliente NÃO OFICIAL do WhatsApp Web).
 * Tudo que é específico do Baileys fica dentro desta classe.
 */
export class CanalWhatsAppBaileys implements CanalMensagens {
  readonly nome = "whatsapp";

  private socket?: WASocket;
  private conectado = false;
  private encerrando = false;
  /** Falhas seguidas de conexão; volta a zero quando conecta. */
  private tentativas = 0;
  /** O aviso de "modo lento" sai uma vez por sequência de falhas, não a cada tentativa. */
  private modoLentoAnunciado = false;
  /** Reconexão agendada e ainda não disparada (no máximo uma por vez). */
  private temporizador?: NodeJS.Timeout;
  private aoReceber?: ManipuladorDeMensagem;
  private readonly logger = pino({ level: "warn" });
  /** Quando o "digitando..." começou para cada conversa. O tempo da IA conta como digitação. */
  private readonly inicioDigitacao = new Map<string, number>();

  constructor(
    private readonly pastaSessao: string,
    private readonly ritmo: RitmoDeDigitacao,
    private readonly reconexao: PoliticaDeReconexao
  ) {}

  async iniciar(aoReceber: ManipuladorDeMensagem): Promise<void> {
    this.aoReceber = aoReceber;
    await this.conectar();
  }

  estaConectado(): boolean {
    return this.conectado;
  }

  async indicarDigitando(enderecoResposta: string): Promise<void> {
    if (this.ritmo.desligado) return;
    this.inicioDigitacao.set(enderecoResposta, Date.now());
    await this.enviarPresenca("composing", enderecoResposta);
  }

  async enviarTexto(enderecoResposta: string, texto: string): Promise<string> {
    // O tempo que já passou desde indicarDigitando (ex.: esperando o Gemini)
    // é descontado: se a IA levou 3 s e o ritmo pede 2,5 s, envia na hora.
    // A marca sai do mapa antes de qualquer falha possível, para não ficar esquecida lá.
    const inicio = this.inicioDigitacao.get(enderecoResposta) ?? Date.now();
    this.inicioDigitacao.delete(enderecoResposta);
    this.exigirConexao();

    const restanteMs = this.ritmo.duracaoMs(texto) - (Date.now() - inicio);
    if (restanteMs > 0) {
      // Reenvia o "composing": cobre o caso de enviarTexto sem indicarDigitando antes
      // e renova o indicador, que o WhatsApp apaga sozinho depois de alguns segundos.
      await this.enviarPresenca("composing", enderecoResposta);
      await new Promise((resolve) => setTimeout(resolve, restanteMs));
    }

    // A conexão pode ter caído durante o atraso do "digitando...". Confere de novo e usa o
    // socket ATUAL: se o canal reconectou nesse meio tempo, this.socket já é outro.
    const enviada = await this.exigirConexao().sendMessage(enderecoResposta, { text: texto });
    await this.enviarPresenca("paused", enderecoResposta);

    const id = enviada?.key.id;
    if (!id) throw new Error("Baileys não retornou id para a mensagem enviada");
    return id;
  }

  /** Devolve o socket se o canal estiver conectado; senão lança. */
  private exigirConexao(): WASocket {
    if (!this.socket || !this.conectado) {
      throw new Error("WhatsApp desconectado: não é possível enviar agora");
    }
    return this.socket;
  }

  /** Indicador de digitação é cosmético: se falhar, só registra; nunca impede a resposta. */
  private async enviarPresenca(tipo: "composing" | "paused", endereco: string): Promise<void> {
    if (!this.socket || !this.conectado) return;
    try {
      if (tipo === "composing") await this.socket.presenceSubscribe(endereco);
      await this.socket.sendPresenceUpdate(tipo, endereco);
    } catch (erro) {
      console.warn(`[whatsapp] não consegui enviar "${tipo}":`, erro instanceof Error ? erro.message : erro);
    }
  }

  async encerrar(): Promise<void> {
    this.encerrando = true;
    this.conectado = false;
    clearTimeout(this.temporizador);
    this.temporizador = undefined;
    // end() fecha o WebSocket SEM deslogar: a sessão continua válida no disco.
    this.socket?.end(undefined);
  }

  // ---------------------------------------------------------------- conexão

  private async conectar(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.pastaSessao);
    console.log("[whatsapp] conectando...");

    const socket = makeWASocket({
      auth: state,
      logger: this.logger,
      // Não aparecer "online" o tempo todo: o celular continua recebendo
      // notificações normalmente e o número parece menos com um robô.
      markOnlineOnConnect: false,
      // Não baixar o histórico antigo: o bot só se importa com mensagens novas.
      syncFullHistory: false,
    });
    this.socket = socket;

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", (update) => {
      if (update.qr) {
        console.log("\n[whatsapp] escaneie o QR em WhatsApp > Aparelhos conectados:\n");
        qrcodeTerminal.generate(update.qr, { small: true });
      }
      if (update.connection === "open") this.aoConectar();
      if (update.connection === "close") {
        this.conectado = false;
        const codigo = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        this.aoFecharConexao(codigo);
      }
    });

    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      // "notify" = mensagem nova. "append" = ressincronização: não responder.
      if (type !== "notify") return;
      for (const bruta of messages) {
        const mensagem = CanalWhatsAppBaileys.traduzir(bruta);
        if (!mensagem || !this.aoReceber) continue;
        try {
          await this.aoReceber(mensagem);
        } catch (erro) {
          console.error("[whatsapp] falha ao processar mensagem", erro);
        }
      }
    });
  }

  /** Conectou: as falhas seguidas voltam a zero (e o modo lento, se estava ativo, termina). */
  private aoConectar(): void {
    this.conectado = true;
    this.tentativas = 0;
    this.modoLentoAnunciado = false;
    console.log("[whatsapp] conectado com sucesso");
  }

  private aoFecharConexao(codigo: number | undefined): void {
    if (this.encerrando) return;

    const motivoFatal = codigo === undefined ? undefined : MOTIVOS_FATAIS.get(codigo);
    if (motivoFatal) {
      console.error(`[whatsapp] ${motivoFatal}`);
      return;
    }

    this.agendarReconexao(codigo);
  }

  /**
   * Agenda UMA nova tentativa, sem nunca desistir: primeiro tentativas rápidas com espera
   * crescente e, esgotadas, uma a cada 10 minutos até a conexão voltar (ver PoliticaDeReconexao).
   * Também é chamada quando a própria tentativa falha (conectar() lança), senão o canal
   * ficaria mudo para sempre com o processo vivo. Só as quedas fatais (MOTIVOS_FATAIS) param de vez.
   */
  private agendarReconexao(codigo?: number): void {
    if (this.encerrando || this.temporizador) return;

    const lento = this.reconexao.emModoLento(this.tentativas);
    if (lento && !this.modoLentoAnunciado) {
      this.modoLentoAnunciado = true;
      console.error(
        `[whatsapp] ${this.tentativas} tentativas rápidas de reconexão falharam. Passando para o modo lento: ` +
          `uma tentativa a cada ${Math.round(this.reconexao.intervaloLentoMs / 60_000)} minutos, até a conexão voltar.`
      );
    }

    // 515 (restartRequired) é normal logo após escanear o QR: reconecta na hora.
    const atraso = codigo === DisconnectReason.restartRequired ? 0 : this.reconexao.atrasoMs(this.tentativas);
    this.tentativas++;
    console.warn(
      `[whatsapp] conexão fechada (código ${codigo}). Reconectando em ${CanalWhatsAppBaileys.descreverEspera(atraso)} ` +
        (lento ? "(modo lento)" : `(tentativa ${this.tentativas} de ${this.reconexao.tentativasRapidas})`)
    );

    this.temporizador = setTimeout(() => {
      this.temporizador = undefined;
      if (this.encerrando) return;
      this.conectar().catch((erro) => {
        console.error("[whatsapp] falha ao reconectar", erro);
        this.agendarReconexao();
      });
    }, atraso);
  }

  private static descreverEspera(ms: number): string {
    return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)} min`;
  }

  // --------------------------------------------------------------- tradução

  /** Converte a mensagem crua do Baileys no formato interno, ou null se deve ser ignorada. */
  private static traduzir(bruta: WAMessage): MensagemRecebida | null {
    const { key } = bruta;
    const jid = key.remoteJid;
    if (key.fromMe || !jid || !key.id) return null;

    // Fora do escopo do MVP: grupos, status (status@broadcast), listas de
    // transmissão e canais. Sem esse filtro o bot responderia "oi" a cada
    // status que um contato postasse.
    if (isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return null;
    if (jid === CONTA_OFICIAL_WHATSAPP) return null;

    // Conversas com mensagens temporárias, "ver uma vez" etc. entregam o texto
    // embrulhado em outra mensagem: desembrulha antes de procurar o texto.
    const conteudo = normalizeMessageContent(bruta.message);
    const texto = conteudo?.conversation ?? conteudo?.extendedTextMessage?.text;
    // Por ora, só texto (sem áudio, imagem, figurinha...). Só espaços não tem o que classificar.
    if (!texto || texto.trim() === "") return null;

    return {
      idExterno: key.id,
      remetente: CanalWhatsAppBaileys.identificarRemetente(jid, key.senderPn),
      // Responde ao JID EXATO de onde veio. Reconstruir o JID a partir do
      // telefone quebra com LID e com o "nono dígito" de números antigos do Brasil.
      enderecoResposta: jid,
      texto,
    };
  }

  /**
   * O WhatsApp está migrando para identificadores anônimos (@lid). Quando a
   * conversa chega por LID, o telefone real pode vir em senderPn.
   */
  private static identificarRemetente(jid: string, senderPn?: string): string {
    const origem = isLidUser(jid) ? senderPn ?? jid : jid;
    if (isLidUser(origem)) return origem; // sem telefone disponível: guarda o LID
    return origem.split("@")[0].split(":")[0];
  }
}
