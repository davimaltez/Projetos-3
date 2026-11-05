import type { Pool } from "pg";
import type { Atendente } from "../nucleo/entidades/Atendente.js";

/** Cadastra as identidades configuradas sem alterar disponibilidade ou especialidade existentes. */
export class AtendenteRepositorio {
  constructor(private readonly pool: Pool) {}

  async cadastrar(atendentes: readonly Atendente[]): Promise<void> {
    const db = await this.pool.connect();
    let descartar = false;
    try {
      await db.query("BEGIN");
      for (const atendente of [...atendentes].sort((a, b) => a.getId().localeCompare(b.getId()))) {
        await db.query(`INSERT INTO atendentes (id, nome, email) VALUES ($1, $2, $3)
          ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, email = EXCLUDED.email`,
          [atendente.getId(), atendente.getNome(), atendente.getEmail()]);
      }
      await db.query("COMMIT");
    } catch (erro) {
      try { await db.query("ROLLBACK"); } catch { descartar = true; }
      throw erro;
    } finally {
      db.release(descartar);
    }
  }
}
