import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";

/** Atualiza bancos novos, legados e a fila já instalada, sem recriar ou apagar dados. */
export class MigradorDoBanco {
  constructor(private readonly pool: Pool) {}

  async executar(): Promise<void> {
    const db = await this.pool.connect();
    let descartar = false;
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout = '5s'");
      await db.query("SELECT pg_advisory_xact_lock(7418301)");
      if (!(await this.colunas(db, "clientes")).size) {
        await this.aplicar(db, "schema.sql");
      } else {
        let tickets = await this.colunas(db, "tickets");
        if (!tickets.size) {
          await this.aplicar(db, "migrations/001_fila_atendimento_humano.sql");
          tickets = await this.colunas(db, "tickets");
        }
        if (tickets.has("protocolo")) {
          await this.aplicar(db, tickets.has("aberto_em")
            ? "migrations/003_compatibilidade_integracao.sql"
            : "migrations/002_fila_conforme_plano.sql");
        }
      }
      // História 2.1: motivo da transferência e dados do ticket.
      await this.aplicar(db, "migrations/004_motivo_e_dados_do_ticket.sql");
      // Não aceita silenciosamente uma estrutura desconhecida/incompleta.
      await db.query(`SELECT t.id, t.conversa_id, t.data_abertura, t.data_fechamento,
        a.status, a.especialidade, c.criado_em FROM tickets t
        LEFT JOIN atendentes a ON a.id = t.atendente_id JOIN conversas c ON c.id = t.conversa_id LIMIT 0`);
      await db.query("COMMIT");
    } catch (erro) {
      try { await db.query("ROLLBACK"); } catch { descartar = true; }
      throw erro;
    } finally { db.release(descartar); }
  }

  private async colunas(db: PoolClient, tabela: string): Promise<Set<string>> {
    const { rows } = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1`, [tabela]);
    return new Set(rows.map((row) => row.column_name));
  }

  private async aplicar(db: PoolClient, arquivo: string): Promise<void> {
    const original = await readFile(new URL(`../../db/${arquivo}`, import.meta.url), "utf8");
    // Os arquivos seguem funcionando diretamente no psql em public. O executor usa
    // uma única transação e respeita o schema da conexão (isolado nos testes).
    const sql = original.replace(/^(?:BEGIN;|COMMIT;|SET LOCAL search_path = public, pg_catalog;)\r?$/gm, "")
      .replaceAll("n.nspname = 'public'", "n.nspname = current_schema()")
      .replaceAll("table_schema = 'public'", "table_schema = current_schema()");
    await db.query(sql);
  }
}
