import type pg from "pg";
import type { RepositorioDeServicos, ServicoContratado, StatusServico } from "../nucleo/RepositorioDeServicos.js";

export class ServicoContratadoRepositorio implements RepositorioDeServicos {
  constructor(private readonly pool: pg.Pool) {}

  /** O cliente sai da própria conversa: o núcleo só conhece o conversaId neste ponto. */
  async listarAtivosDaConversa(conversaId: number): Promise<ServicoContratado[]> {
    const { rows } = await this.pool.query<{ nome: string; descricao: string | null; status: StatusServico; data_inicio: Date }>(
      `SELECT s.nome, s.descricao, s.status, s.data_inicio
         FROM conversas c
         JOIN servicos_contratados s ON s.cliente_id = c.cliente_id
        WHERE c.id = $1 AND s.ativo
        ORDER BY s.data_inicio, s.id`,
      [conversaId]
    );
    return rows.map((r) => ({ nome: r.nome, descricao: r.descricao, status: r.status, dataInicio: r.data_inicio }));
  }
}
