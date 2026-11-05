import { Cliente } from "./Cliente.js";
import type { Conversa } from "./Conversa.js";
import { StatusConversa, TipoRemetente } from "./Enums.js";
import { Mensagem } from "./Mensagem.js";
import type { Remetente } from "./Remetente.js";
import { topicosDoMenu } from "../Topicos.js";

/** Intenção devolvida quando a mensagem não tem um tópico reconhecido. */
export const INTENCAO_INDEFINIDA = "indefinido";

/** Linguagem simples (história 1.6) e sempre com uma saída (história 1.5). */
export const RESPOSTA_SEM_TOPICO =
  "Não entendi sua mensagem. Responda com o número de uma das opções do menu ou peça para falar com um atendente.";

/**
 * O bot como participante da conversa (diagrama: Chatbot 1 —conduz— 0..* Conversa).
 *
 * Não chama a IA: a classificação real é assíncrona e fica no Atendimento, através da
 * interface ClassificadorDeIntencao. Aqui o bot LÊ a intenção já gravada na mensagem.
 * Todos os atributos são de configuração: só getters, nenhum setter.
 */
export class Chatbot implements Remetente {
  readonly #id: string;
  readonly #nome: string;
  readonly #tomDeVoz: string;
  readonly #limiteTentativas: number;
  readonly #disponivel24h: boolean;

  constructor(id: number | string, nome: string, tomDeVoz: string, limiteTentativas: number, disponivel24h: boolean) {
    if (!Number.isInteger(limiteTentativas) || limiteTentativas < 1) {
      throw new Error("limiteTentativas deve ser um inteiro maior ou igual a 1.");
    }
    this.#id = String(id);
    this.#nome = nome;
    this.#tomDeVoz = tomDeVoz;
    this.#limiteTentativas = limiteTentativas;
    this.#disponivel24h = disponivel24h;
  }

  getId(): string {
    return this.#id;
  }

  getNome(): string {
    return this.#nome;
  }

  getTomDeVoz(): string {
    return this.#tomDeVoz;
  }

  getLimiteTentativas(): number {
    return this.#limiteTentativas;
  }

  isDisponivel24h(): boolean {
    return this.#disponivel24h;
  }

  getTipo(): TipoRemetente {
    return TipoRemetente.CHATBOT;
  }

  /** A intenção registrada na mensagem; vazia ou ausente vira "indefinido". */
  detectarIntencao(m: Mensagem): string {
    const intencao = m.getIntencaoDetectada();
    return intencao === null || intencao.trim() === "" ? INTENCAO_INDEFINIDA : intencao;
  }

  /**
   * Resposta do bot à mensagem: o texto do tópico do menu do cliente, ou o aviso de
   * "não entendi" com as saídas possíveis. A mensagem criada tem o próprio bot como remetente.
   */
  responder(m: Mensagem): Mensagem {
    const intencao = this.detectarIntencao(m);
    const topico = topicosDoMenu().find((t) => t.id === intencao);
    const texto = topico?.respostaProvisoria ?? RESPOSTA_SEM_TOPICO;
    return new Mensagem(texto, new Date(), this, intencao);
  }

  /**
   * Regra de transbordo: transfere quando as últimas `limiteTentativas` mensagens do
   * cliente ficaram sem tópico reconhecido. Só vale enquanto a conversa está com o bot.
   */
  deveTransferir(c: Conversa): boolean {
    if (c.getStatus() !== StatusConversa.COM_BOT) return false;

    const doCliente = c.getHistorico().filter((m) => m.getRemetente() instanceof Cliente);
    let falhasSeguidas = 0;
    for (let i = doCliente.length - 1; i >= 0; i--) {
      if (this.detectarIntencao(doCliente[i]) !== INTENCAO_INDEFINIDA) break;
      falhasSeguidas++;
    }
    return falhasSeguidas >= this.#limiteTentativas;
  }

  getIdentificacao(): string {
    return `chatbot:${this.#id}`;
  }
}
