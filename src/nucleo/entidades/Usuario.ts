import type { Remetente } from "./Remetente.js";

/** Identidade comum a clientes e atendentes, conforme o diagrama de classes. */
// Clientes históricos podem usar string | null; atendentes mantêm o padrão string.
export abstract class Usuario<Informacao extends string | null = string> implements Remetente {
  readonly #id: number;
  readonly #nome: Informacao;
  readonly #email: Informacao;

  constructor(id: number, nome: Informacao, email: Informacao) {
    this.#id = id;
    this.#nome = nome;
    this.#email = email;
  }

  getId(): number {
    return this.#id;
  }

  getNome(): Informacao {
    return this.#nome;
  }

  getEmail(): Informacao {
    return this.#email;
  }

  getIdentificacao(): string {
    return `usuario:${this.#id}`;
  }
}
