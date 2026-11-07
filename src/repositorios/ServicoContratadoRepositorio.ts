import type pg from "pg";
import type { RepositorioDeServicos, ServicoContratado, StatusServico } from "../nucleo/RepositorioDeServicos.js";

export class ServicoContratadoRepositorio implements RepositorioDeServicos {
  constructor(private readonly pool: pg.Pool) {}

  /** O cliente sai da própria conversa: o núcleo só conhece o conversaId neste ponto. */
  async listarAtivosDaConversa(conversaId: number): Promise<ServicoContratado[]> {
    // data_inicio vem como texto ('2025-03-10'): o Date de um DATE depende do driver (meia-noite
    // local ou UTC) e, em UTC, o Brasil veria o dia anterior. Ver dataLocal().
    const { rows } = await this.pool.query<{ nome: string; descricao: string | null; status: StatusServico; data_inicio: string }>(
      `SELECT s.nome, s.descricao, s.status, to_char(s.data_inicio, 'YYYY-MM-DD') AS data_inicio
         FROM conversas c
         JOIN servicos_contratados s ON s.cliente_id = c.cliente_id
        WHERE c.id = $1 AND s.ativo
        ORDER BY s.data_inicio, s.id`,
      [conversaId]
    );
    return rows.map((r) => ({ nome: r.nome, descricao: r.descricao, status: r.status, dataInicio: dataLocal(r.data_inicio) }));
  }
}

/** 'AAAA-MM-DD' → meia-noite no fuso local, o que RespostaDeServicoContratado espera. */
function dataLocal(texto: string): Date {
  const [ano, mes, dia] = texto.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}
