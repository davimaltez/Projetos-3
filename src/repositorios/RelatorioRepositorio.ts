import type pg from "pg";
import type { FonteDeMetricas, MetricasDeAtendimento } from "../nucleo/Relatorio.js";

/** Quantos itens entram em cada ranking do relatório. */
const TAMANHO_DO_RANKING = 3;
const TAMANHO_DO_RANKING_DE_ASSUNTOS = 5;

/**
 * Métricas fixas do relatório do gestor (história 3.3), calculadas direto no Postgres.
 * Eventos marcados como sintéticos (dados de demonstração) ficam de fora.
 */
export class RelatorioRepositorio implements FonteDeMetricas {
  constructor(
    private readonly pool: pg.Pool,
    /** Dias e horários de pico são contados no horário local da WXN, não em UTC. */
    private readonly fusoHorario: string,
  ) {}

  async obterMetricas(): Promise<MetricasDeAtendimento> {
    const [atendimentos, satisfacao, dias, horas, assuntos, transferencias] = await Promise.all([
      // Conversa que o bot respondeu ou que foi para a fila. A resposta a uma pesquisa de
      // satisfação (tipo 'avaliacao') não é um atendimento novo.
      this.pool.query<{ total: number }>(
        `SELECT count(DISTINCT conversa_id)::int AS total FROM eventos
         WHERE tipo IN ('resposta', 'transferencia_humana') AND NOT sintetico`),
      this.pool.query<{ media: number | null; total: number }>(
        `SELECT avg(nota)::float AS media, count(*)::int AS total
         FROM avaliacoes WHERE situacao = 'RESPONDIDA'`),
      // Movimento = mensagens recebidas dos clientes (operadores e gestores não passam por esta tabela).
      this.pool.query<{ dia: number; total: number }>(
        `SELECT EXTRACT(DOW FROM criado_em AT TIME ZONE $1)::int AS dia, count(*)::int AS total
         FROM mensagens WHERE direcao = 'entrada'
         GROUP BY dia ORDER BY total DESC, dia LIMIT $2`,
        [this.fusoHorario, TAMANHO_DO_RANKING]),
      this.pool.query<{ hora: number; total: number }>(
        `SELECT EXTRACT(HOUR FROM criado_em AT TIME ZONE $1)::int AS hora, count(*)::int AS total
         FROM mensagens WHERE direcao = 'entrada'
         GROUP BY hora ORDER BY total DESC, hora LIMIT $2`,
        [this.fusoHorario, TAMANHO_DO_RANKING]),
      // Conversas distintas: navegar por vários níveis do mesmo tópico conta uma vez só.
      this.pool.query<{ intencao: string; total: number }>(
        `SELECT intencao, count(DISTINCT conversa_id)::int AS total FROM eventos
         WHERE tipo = 'resposta' AND intencao IS NOT NULL AND intencao <> 'relatorio_admin' AND NOT sintetico
         GROUP BY intencao ORDER BY total DESC, intencao LIMIT $1`,
        [TAMANHO_DO_RANKING_DE_ASSUNTOS]),
      this.pool.query<{ motivo: string; total: number }>(
        `SELECT motivo, count(*)::int AS total FROM tickets GROUP BY motivo ORDER BY total DESC, motivo`),
    ]);

    const porMotivo = transferencias.rows.map((r) => ({ motivo: r.motivo, quantidade: r.total }));
    return {
      totalDeAtendimentos: atendimentos.rows[0]?.total ?? 0,
      notaMedia: satisfacao.rows[0]?.media ?? null,
      totalDeAvaliacoes: satisfacao.rows[0]?.total ?? 0,
      diasDeMaiorMovimento: dias.rows.map((r) => ({ diaDaSemana: r.dia, mensagens: r.total })),
      horariosDeMaiorMovimento: horas.rows.map((r) => ({ hora: r.hora, mensagens: r.total })),
      assuntosMaisPerguntados: assuntos.rows.map((r) => ({ topico: r.intencao, conversas: r.total })),
      transferenciasParaAtendente: porMotivo.reduce((soma, m) => soma + m.quantidade, 0),
      transferenciasPorMotivo: porMotivo,
    };
  }
}
