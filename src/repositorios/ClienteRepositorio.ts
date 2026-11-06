import type pg from "pg";
import type { RepositorioDeClientes } from "../nucleo/Repositorios.js";

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
}
