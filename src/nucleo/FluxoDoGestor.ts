import type { CanalMensagens, MensagemRecebida } from "./CanalMensagens.js";
import { CodigosDeUsoUnico, DIGITOS_DO_CODIGO } from "./CodigosDeUsoUnico.js";
import type { EnviadorDeEmail } from "./EnviadorDeEmail.js";
import { normalizarTelefone } from "./FluxoDoOperador.js";
import { mascararRemetente } from "./PrivacidadeDeLog.js";
import { formatarRelatorio, type FonteDeMetricas } from "./Relatorio.js";

/** Gestor da WXN: cadastro explícito (GESTORES_JSON), como os operadores. */
export interface Gestor {
  readonly nome: string;
  readonly telefone: string;
  /** E-mail cadastrado: só ele recebe o código de uso único. */
  readonly email: string;
}

export interface OpcoesDoFluxoDoGestor {
  /** Fuso usado para escrever a data de geração do relatório (ex.: America/Sao_Paulo). */
  readonly fusoHorario: string;
  readonly codigos?: CodigosDeUsoUnico;
  readonly agora?: () => Date;
}

function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "relatório", "quero o relatório geral", "Relatorios" etc. */
function ehPedidoDeRelatorio(texto: string): boolean {
  return /\brelatorios?\b/.test(normalizarTexto(texto));
}

function ehCancelar(texto: string): boolean {
  return /^(?:cancelar|cancela|sair|voltar|0)$/.test(normalizarTexto(texto));
}

/** "maria.souza@wxn.com.br" → "ma***@wxn.com.br": confirma o destino sem expor o endereço inteiro. */
export function mascararEmail(email: string): string {
  const arroba = email.lastIndexOf("@");
  if (arroba < 1) return "***";
  const usuario = email.slice(0, arroba);
  const visivel = usuario.length <= 2 ? usuario.slice(0, 1) : usuario.slice(0, 2);
  return `${visivel}***${email.slice(arroba)}`;
}

/**
 * História 3.3: o gestor pede o relatório pelo WhatsApp, recebe um código de uso único no
 * e-mail cadastrado e, ao confirmar o código na conversa, recebe o compilado de métricas fixas.
 *
 * Só intercepta o que é do gestor (pedido de relatório, código, "cancelar" com código pendente).
 * Qualquer outra mensagem devolve false e segue para o atendimento normal.
 */
export class FluxoDoGestor {
  private readonly porTelefone = new Map<string, Gestor>();
  private readonly sequencias = new Map<string, Promise<boolean>>();
  private readonly codigos: CodigosDeUsoUnico;
  private readonly agora: () => Date;

  constructor(
    private readonly canal: CanalMensagens,
    private readonly email: EnviadorDeEmail,
    private readonly metricas: FonteDeMetricas,
    gestores: readonly Gestor[],
    private readonly opcoes: OpcoesDoFluxoDoGestor,
  ) {
    this.codigos = opcoes.codigos ?? new CodigosDeUsoUnico();
    this.agora = opcoes.agora ?? (() => new Date());
    for (const gestor of gestores) {
      const telefone = normalizarTelefone(gestor.telefone);
      if (!telefone || this.porTelefone.has(telefone)) {
        throw new Error("GESTORES_JSON contém telefone duplicado ou inválido.");
      }
      this.porTelefone.set(telefone, gestor);
    }
  }

  /** Mensagens do mesmo gestor são tratadas em ordem (o código não chega antes do pedido). */
  async processarSeGestor(mensagem: MensagemRecebida): Promise<boolean> {
    const telefone = normalizarTelefone(mensagem.remetente);
    if (!telefone) return false;
    const gestor = this.porTelefone.get(telefone);
    if (!gestor) return false;

    const anterior = this.sequencias.get(telefone) ?? Promise.resolve(false);
    const atual = anterior.catch(() => false).then(() => this.tratar(mensagem, telefone, gestor));
    this.sequencias.set(telefone, atual);
    try {
      return await atual;
    } finally {
      if (this.sequencias.get(telefone) === atual) this.sequencias.delete(telefone);
    }
  }

  private async tratar(mensagem: MensagemRecebida, telefone: string, gestor: Gestor): Promise<boolean> {
    if (this.codigos.temPendente(telefone)) {
      const digitos = mensagem.texto.replace(/[\s.-]/g, "");
      if (/^\d+$/.test(digitos)) {
        await this.conferirCodigo(mensagem, telefone, digitos);
        return true;
      }
      if (ehCancelar(mensagem.texto)) {
        this.codigos.descartar(telefone);
        await this.responder(mensagem, "Pedido de relatório cancelado.");
        return true;
      }
    }
    if (ehPedidoDeRelatorio(mensagem.texto)) {
      await this.enviarCodigo(mensagem, telefone, gestor);
      return true;
    }
    return false;
  }

  private async enviarCodigo(mensagem: MensagemRecebida, telefone: string, gestor: Gestor): Promise<void> {
    const emissao = this.codigos.emitir(telefone);
    if (emissao.tipo === "aguarde") {
      await this.responder(mensagem,
        `Acabei de enviar um código para ${mascararEmail(gestor.email)}. Confira a caixa de entrada (e o spam) ` +
        `ou peça outro em ${emissao.segundos} segundos.`);
      return;
    }

    const minutos = this.codigos.validadeEmMinutos;
    try {
      await this.email.enviar(
        gestor.email,
        "Código para o relatório de atendimentos",
        `Olá, ${gestor.nome}.\n\n` +
        `Seu código para ver o relatório de atendimentos do chatbot WXN é: ${emissao.codigo}\n\n` +
        `Ele vale por ${minutos} minutos e só pode ser usado uma vez. ` +
        "Se você não pediu o relatório, ignore este e-mail.",
      );
    } catch (erro) {
      this.codigos.descartar(telefone);
      console.error(`[gestor] falha ao enviar o código para ${mascararRemetente(telefone)}:`,
        erro instanceof Error ? erro.message : erro);
      await this.responder(mensagem, "Não consegui enviar o e-mail com o código agora. Tente de novo em alguns minutos.");
      return;
    }

    console.log(`[gestor] código do relatório enviado por e-mail para ${mascararRemetente(telefone)}`);
    await this.responder(mensagem,
      `Para liberar o relatório, enviei um código de ${DIGITOS_DO_CODIGO} números para ${mascararEmail(gestor.email)}. ` +
      `Ele vale por ${minutos} minutos. Responda aqui com o código (ou "cancelar").`);
  }

  private async conferirCodigo(mensagem: MensagemRecebida, telefone: string, digitos: string): Promise<void> {
    if (digitos.length !== DIGITOS_DO_CODIGO) {
      // Não conta como tentativa: provavelmente foi um engano de digitação.
      await this.responder(mensagem,
        `O código tem ${DIGITOS_DO_CODIGO} números. Confira o e-mail e envie só os números (ou "cancelar").`);
      return;
    }

    const resultado = this.codigos.verificar(telefone, digitos);
    switch (resultado.tipo) {
      case "valido":
        await this.enviarRelatorio(mensagem, telefone);
        return;
      case "incorreto":
        await this.responder(mensagem,
          `Código incorreto. Você ainda tem ${resultado.tentativasRestantes} ` +
          `${resultado.tentativasRestantes === 1 ? "tentativa" : "tentativas"}.`);
        return;
      case "bloqueado":
        console.warn(`[gestor] código do relatório bloqueado por tentativas erradas: ${mascararRemetente(telefone)}`);
        await this.responder(mensagem,
          'Código incorreto. Por segurança, esse código foi cancelado. Envie "relatório" para receber um novo.');
        return;
      case "expirado":
      case "inexistente":
        await this.responder(mensagem, 'Esse código expirou. Envie "relatório" para receber um novo.');
        return;
    }
  }

  private async enviarRelatorio(mensagem: MensagemRecebida, telefone: string): Promise<void> {
    let texto: string;
    try {
      texto = formatarRelatorio(await this.metricas.obterMetricas(), this.agora(), this.opcoes.fusoHorario);
    } catch (erro) {
      console.error("[gestor] falha ao calcular o relatório:", erro instanceof Error ? erro.message : erro);
      await this.responder(mensagem, 'Não consegui gerar o relatório agora. Envie "relatório" de novo em alguns minutos.');
      return;
    }
    await this.responder(mensagem, texto);
    console.log(`[gestor] relatório enviado para ${mascararRemetente(telefone)}`);
  }

  private async responder(mensagem: MensagemRecebida, texto: string): Promise<void> {
    await this.canal.enviarTexto(mensagem.enderecoResposta, texto);
  }
}

/** Valida GESTORES_JSON na subida: [{"nome":"...","telefone":"5581...","email":"..."}]. */
export function lerGestores(json: string): Gestor[] {
  let valor: unknown;
  try { valor = JSON.parse(json); } catch { throw new Error("GESTORES_JSON deve ser JSON válido."); }
  if (!Array.isArray(valor)) throw new Error("GESTORES_JSON deve ser uma lista.");
  return valor.map((item: unknown) => {
    if (typeof item !== "object" || item === null) throw new Error("Gestor inválido em GESTORES_JSON.");
    const { nome, telefone, email } = item as Record<string, unknown>;
    if (typeof nome !== "string" || !nome.trim() || typeof telefone !== "string" ||
        typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw new Error("Gestor inválido em GESTORES_JSON: informe nome, telefone (texto) e e-mail válido.");
    }
    return { nome: nome.trim(), telefone, email: email.trim() };
  });
}
