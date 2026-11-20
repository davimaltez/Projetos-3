import type pg from "pg";
import type { RepositorioDeAvaliacoes } from "../nucleo/Repositorios.js";

/** Depois desse prazo, um número enviado pelo cliente volta a ser só uma opção do menu. */
const PRAZO_PARA_RESPONDER = "24 hours";

/** Tabela avaliacoes (migração 008): nota de satisfação de cada ticket encerrado. */
export class AvaliacaoRepositorio implements RepositorioDeAvaliacoes {
  constructor(private readonly pool: pg.Pool) {}

  async solicitar(ticketId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO avaliacoes (ticket_id, cliente_id)
       SELECT t.id, c.cliente_id FROM tickets t JOIN conversas c ON c.id = t.conversa_id
       WHERE t.id = $1
       ON CONFLICT (ticket_id) DO NOTHING`,
      [ticketId]
    );
  }

  async pendenteDoCliente(clienteId: number): Promise<string | null> {
    const { rows } = await this.pool.query<{ ticket_id: string }>(
      `SELECT ticket_id FROM avaliacoes
       WHERE cliente_id = $1 AND situacao = 'PENDENTE'
         AND solicitada_em > now() - $2::interval
       ORDER BY solicitada_em DESC LIMIT 1`,
      [clienteId, PRAZO_PARA_RESPONDER]
    );
    return rows[0]?.ticket_id ?? null;
  }

  async registrarNota(ticketId: string, nota: number): Promise<void> {
    await this.pool.query(
      `UPDATE avaliacoes SET nota = $2, situacao = 'RESPONDIDA', respondida_em = now()
       WHERE ticket_id = $1 AND situacao = 'PENDENTE'`,
      [ticketId, nota]
    );
  }

  async descartar(ticketId: string): Promise<void> {
    await this.pool.query(
      `UPDATE avaliacoes SET situacao = 'DESCARTADA' WHERE ticket_id = $1 AND situacao = 'PENDENTE'`,
      [ticketId]
    );
  }
}
