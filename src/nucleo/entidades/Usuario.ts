import type { Remetente } from "./Remetente.js";

/** Identidade comum a clientes e atendentes, conforme o diagrama de classes. */
export abstract class Usuario implements Remetente {
  readonly #id: number;
  readonly #nome: string;
  readonly #email: string;

  constructor(id: number, nome: string, email: string) {
    this.#id = id;
    this.#nome = nome;
    this.#email = email;
  }

  getId(): number {
    return this.#id;
  }

  getNome(): string {
    return this.#nome;
  }

  getEmail(): string {
    return this.#email;
  }

  getIdentificacao(): string {
    return `usuario:${this.#id}`;
  }
}
