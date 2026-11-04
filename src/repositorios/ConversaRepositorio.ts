import type pg from "pg";
import type { RepositorioDeConversas } from "../nucleo/Repositorios.js";

export class ConversaRepositorio implements RepositorioDeConversas {
  constructor(private readonly pool: pg.Pool) {}

  /** Esqueleto andante: uma conversa por cliente. Encerrar/reabrir vem na máquina de estados. */
  async obterOuCriarAtual(clienteId: number): Promise<number> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      // Impede duas primeiras mensagens concorrentes de criarem conversas distintas.
      await db.query("SELECT id FROM clientes WHERE id = $1 FOR UPDATE", [clienteId]);
      const existente = await db.query<{ id: number }>(
        "SELECT id FROM conversas WHERE cliente_id = $1 ORDER BY id DESC LIMIT 1",
        [clienteId]
      );
      if (existente.rows[0]) {
        await db.query("COMMIT");
        return existente.rows[0].id;
      }

      const criada = await db.query<{ id: number }>(
        "INSERT INTO conversas (cliente_id) VALUES ($1) RETURNING id",
        [clienteId]
      );
      await db.query("COMMIT");
      return criada.rows[0].id;
    } catch (erro) {
      await db.query("ROLLBACK");
      throw erro;
    } finally {
      db.release();
    }
  }
}
