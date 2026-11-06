import type pg from "pg";
import type { DadosDoCliente, RepositorioDeClientes } from "../nucleo/Repositorios.js";

export class ClienteRepositorio implements RepositorioDeClientes {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Um único comando atômico. O par SELECT + INSERT separados quebra quando
   * a mesma pessoa manda duas mensagens seguidas: as duas veem "não existe",
   * as duas tentam inserir, e a segunda estoura a UNIQUE de telefone.
   */
  async obterOuCriar(telefone: string, origem: string, enderecoResposta?: string): Promise<number> {
    const { rows } = await this.pool.query<{ id: number }>(
        `INSERT INTO clientes (telefone, origem, endereco_resposta) VALUES ($1, $2, $3)
          ON CONFLICT (telefone) DO UPDATE SET endereco_resposta = EXCLUDED.endereco_resposta
                                      RETURNING id`,
        [telefone, origem, enderecoResposta ?? null]
    );
    return rows[0].id;
  }

  async obterPorId(id: number): Promise<DadosDoCliente | null> {
    const { rows } = await this.pool.query<{ nome: string | null; telefone: string }>(
      "SELECT nome, telefone FROM clientes WHERE id = $1",
      [id]
    );
    if (!rows[0]) return null;
    return { nome: rows[0].nome, empresa: null, telefone: rows[0].telefone };
  }
}
