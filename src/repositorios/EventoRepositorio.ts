import type pg from "pg";
import type { NovoEvento, RepositorioDeEventos } from "../nucleo/Repositorios.js";

/**
 * Tabela eventos: o registro que alimenta o relatório administrativo (Épico 3).
 * Cada resposta do bot gera um evento dizendo qual caminho foi usado e como a decisão foi tomada.
 * O caminho (1 a 5) é gravado como texto em eventos.fluxo.
 */
export class EventoRepositorio implements RepositorioDeEventos {
  constructor(private readonly pool: pg.Pool) {}

  async registrar(e: NovoEvento): Promise<void> {
    await this.pool.query(
      `INSERT INTO eventos (conversa_id, tipo, origem, fluxo, intencao, usou_llm, dados)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [e.conversaId, e.tipo, e.origem, e.caminho?.toString() ?? null, e.intencao, e.usouLlm, JSON.stringify(e.dados)]
    );
  }
}
