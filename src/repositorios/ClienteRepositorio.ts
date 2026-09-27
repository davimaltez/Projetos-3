import type pg from "pg";
import type { RepositorioDeClientes } from "../nucleo/Repositorios.js";

export class ClienteRepositorio implements RepositorioDeClientes {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Um único comando atômico. O par SELECT + INSERT separados quebra quando
   * a mesma pessoa manda duas mensagens seguidas: as duas veem "não existe",
   * as duas tentam inserir, e a segunda estoura a UNIQUE de telefone.
   */
  async obterOuCriar(telefone: string, origem: string): Promise<number> {
    const { rows } = await this.pool.query<{ id: number }>(
      `INSERT INTO clientes (telefone, origem) VALUES ($1, $2)
       ON CONFLICT (telefone) DO UPDATE SET telefone = EXCLUDED.telefone
       RETURNING id`,
      [telefone, origem]
    );
    return rows[0].id;
  }
}
