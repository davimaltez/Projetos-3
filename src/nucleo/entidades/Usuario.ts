/**
 * Identidade comum a clientes e atendentes, conforme o diagrama de classes («abstract»).
 *
 * Não implementa Remetente: no diagrama, quem realiza a interface são Cliente e Atendente,
 * cada um com a própria identificação (ids de tabelas diferentes não podem colidir).
 *
 * O parâmetro de tipo existe por causa de dados históricos: um cliente pode estar no banco
 * sem nome e sem e-mail (string | null). Atendentes usam o padrão (string).
 */
export abstract class Usuario<Informacao extends string | null = string> {
  readonly #id: string;
  #nome: Informacao;
  #email: Informacao;

  /** Aceita o id numérico do banco (SERIAL) e guarda como texto, como pede o plano. */
  constructor(id: number | string, nome: Informacao, email: Informacao) {
    this.#id = String(id);
    this.#nome = nome;
    this.#email = email;
  }

  getId(): string {
    return this.#id;
  }

  getNome(): Informacao {
    return this.#nome;
  }

  getEmail(): Informacao {
    return this.#email;
  }

  /** Nome pode mudar livremente, mas não pode virar texto vazio. */
  setNome(nome: Informacao): void {
    if (nome !== null && nome.trim() === "") {
      throw new Error("O nome não pode ser vazio.");
    }
    this.#nome = nome;
  }

  /** E-mail pode mudar livremente, desde que tenha formato de e-mail. */
  setEmail(email: Informacao): void {
    if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("E-mail inválido.");
    }
    this.#email = email;
  }
}
