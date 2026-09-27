import type pg from "pg";
import type { RepositorioDeConversas } from "../nucleo/Repositorios.js";

export class ConversaRepositorio implements RepositorioDeConversas {
  constructor(private readonly pool: pg.Pool) {}

  /** Esqueleto andante: uma conversa por cliente. Encerrar/reabrir vem na máquina de estados. */
  async obterOuCriarAtual(clienteId: number): Promise<number> {
    const existente = await this.pool.query<{ id: number }>(
      "SELECT id FROM conversas WHERE cliente_id = $1 ORDER BY id DESC LIMIT 1",
      [clienteId]
    );
    if (existente.rows[0]) return existente.rows[0].id;

    const criada = await this.pool.query<{ id: number }>(
      "INSERT INTO conversas (cliente_id) VALUES ($1) RETURNING id",
      [clienteId]
    );
    return criada.rows[0].id;
  }
}
