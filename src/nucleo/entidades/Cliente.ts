import type { Chatbot } from "./Chatbot.js";
import { Conversa } from "./Conversa.js";
import { TipoAtendimento, TipoRemetente } from "./Enums.js";
import type { Remetente } from "./Remetente.js";
import { Usuario } from "./Usuario.js";

/** Telefone em dígitos (como o canal grava: DDI + DDD + número). Um LID do WhatsApp não passa. */
const TELEFONE_VALIDO = /^\d{10,15}$/;

/**
 * Cliente da WXN que conversa pelo WhatsApp (diagrama: Cliente 1 —inicia— 0..* Conversa).
 *
 * Nome e e-mail aceitam null porque clientes históricos podem não ter esses dados.
 * empresa aceita null porque a tabela clientes ainda não tem essa coluna.
 */
export class Cliente extends Usuario<string | null> implements Remetente {
  readonly #telefone: string;
  readonly #empresa: string | null;
  #tipoAtendimento: TipoAtendimento;
  #autenticado: boolean;

  constructor(
    id: number | string,
    nome: string | null,
    email: string | null,
    telefone: string,
    empresa: string | null = null,
    tipoAtendimento: TipoAtendimento = TipoAtendimento.SIMPLIFICADO
  ) {
    super(id, nome, email);
    this.#telefone = telefone;
    this.#empresa = empresa;
    this.#tipoAtendimento = tipoAtendimento;
    this.#autenticado = false;
  }

  getTelefone(): string {
    return this.#telefone;
  }

  getEmpresa(): string | null {
    return this.#empresa;
  }

  getTipoAtendimento(): TipoAtendimento {
    return this.#tipoAtendimento;
  }

  setTipoAtendimento(t: TipoAtendimento): void {
    this.#tipoAtendimento = t;
  }

  isAutenticado(): boolean {
    return this.#autenticado;
  }

  /**
   * História 1.3: o cliente é identificado pelo número do WhatsApp.
   * Autentica quando o telefone é um número válido; um identificador anônimo (LID)
   * não autentica. Não existe setter: o estado só muda por esta regra.
   */
  autenticar(): boolean {
    this.#autenticado = TELEFONE_VALIDO.test(this.#telefone);
    return this.#autenticado;
  }

  /**
   * Abre uma nova conversa com o bot. Só um cliente autenticado pode iniciar.
   * Recebe id, canal e chatbot porque o construtor da Conversa exige esses dados
   * (o diagrama mostra a operação sem parâmetros).
   */
  iniciarConversa(id: number, canal: string, chatbot: Chatbot): Conversa {
    if (!this.#autenticado) {
      throw new Error("O cliente precisa estar autenticado para iniciar uma conversa.");
    }
    return new Conversa(id, canal, this, chatbot);
  }

  getTipo(): TipoRemetente {
    return TipoRemetente.CLIENTE;
  }

  getIdentificacao(): string {
    return `cliente:${this.getId()}`;
  }
}
