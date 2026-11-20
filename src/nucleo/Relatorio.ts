import { MotivoDaTransferencia } from "./entidades/Enums.js";
import { ROTULO_DO_MOTIVO } from "./FluxoDoOperador.js";
import { TOPICOS } from "./Topicos.js";

/**
 * Métricas fixas do relatório do gestor (história 3.3). Sem filtros: é sempre o mesmo
 * compilado, calculado sobre todo o histórico gravado no banco.
 */
export interface MetricasDeAtendimento {
  /** Conversas em que o bot respondeu ou que foram transferidas para a equipe. */
  readonly totalDeAtendimentos: number;
  /** Média das notas de 1 a 5; null quando ainda não há nenhuma avaliação. */
  readonly notaMedia: number | null;
  readonly totalDeAvaliacoes: number;
  /** Dias da semana com mais mensagens recebidas (0 = domingo), do maior para o menor. */
  readonly diasDeMaiorMovimento: readonly { readonly diaDaSemana: number; readonly mensagens: number }[];
  /** Horas do dia (0 a 23) com mais mensagens recebidas, do maior para o menor. */
  readonly horariosDeMaiorMovimento: readonly { readonly hora: number; readonly mensagens: number }[];
  /** Tópicos (id de Topicos.ts) e em quantas conversas apareceram, do maior para o menor. */
  readonly assuntosMaisPerguntados: readonly { readonly topico: string; readonly conversas: number }[];
  readonly transferenciasParaAtendente: number;
  readonly transferenciasPorMotivo: readonly { readonly motivo: string; readonly quantidade: number }[];
}

/** Quem calcula as métricas (no app, o Postgres). O núcleo não sabe de SQL. */
export interface FonteDeMetricas {
  obterMetricas(): Promise<MetricasDeAtendimento>;
}

const DIAS_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function numero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

function rotuloDoTopico(id: string): string {
  return TOPICOS.find((t) => t.id === id)?.rotulo ?? id;
}

function rotuloDoMotivo(motivo: string): string {
  return ROTULO_DO_MOTIVO[motivo as MotivoDaTransferencia] ?? motivo;
}

function faixaDeHorario(hora: number): string {
  const doisDigitos = (h: number) => String(h).padStart(2, "0");
  return `${doisDigitos(hora)}h–${doisDigitos((hora + 1) % 24)}h`;
}

function percentual(parte: number, total: number): string {
  if (total === 0) return "";
  return ` (${Math.round((parte / total) * 100)}% dos atendimentos)`;
}

/** Texto enviado ao gestor pelo WhatsApp. Lista vazia vira "sem dados ainda", nunca uma linha em branco. */
export function formatarRelatorio(metricas: MetricasDeAtendimento, geradoEm: Date, fusoHorario: string): string {
  const semDados = "   sem dados ainda";
  const linhas: string[] = [
    "📊 Relatório geral de atendimentos",
    `Gerado em ${geradoEm.toLocaleString("pt-BR", { timeZone: fusoHorario })}`,
    "",
    `• Total de atendimentos: ${numero(metricas.totalDeAtendimentos)}`,
    metricas.notaMedia === null
      ? "• Nota média de satisfação: sem avaliações ainda"
      : `• Nota média de satisfação: ${metricas.notaMedia.toFixed(1).replace(".", ",")} de 5 ` +
        `(${numero(metricas.totalDeAvaliacoes)} ${metricas.totalDeAvaliacoes === 1 ? "avaliação" : "avaliações"})`,
    `• Conversas passadas para um atendente: ${numero(metricas.transferenciasParaAtendente)}` +
      percentual(metricas.transferenciasParaAtendente, metricas.totalDeAtendimentos),
  ];
  for (const { motivo, quantidade } of metricas.transferenciasPorMotivo) {
    linhas.push(`   - ${rotuloDoMotivo(motivo)}: ${numero(quantidade)}`);
  }

  linhas.push("", "• Dias de maior movimento:");
  if (metricas.diasDeMaiorMovimento.length === 0) linhas.push(semDados);
  metricas.diasDeMaiorMovimento.forEach(({ diaDaSemana, mensagens }, i) =>
    linhas.push(`   ${i + 1}. ${DIAS_DA_SEMANA[diaDaSemana] ?? diaDaSemana}: ${numero(mensagens)} mensagens`));

  linhas.push("", "• Horários de maior movimento:");
  if (metricas.horariosDeMaiorMovimento.length === 0) linhas.push(semDados);
  metricas.horariosDeMaiorMovimento.forEach(({ hora, mensagens }, i) =>
    linhas.push(`   ${i + 1}. ${faixaDeHorario(hora)}: ${numero(mensagens)} mensagens`));

  linhas.push("", "• Assuntos mais perguntados:");
  if (metricas.assuntosMaisPerguntados.length === 0) linhas.push(semDados);
  metricas.assuntosMaisPerguntados.forEach(({ topico, conversas }, i) =>
    linhas.push(`   ${i + 1}. ${rotuloDoTopico(topico)}: ${numero(conversas)} ${conversas === 1 ? "conversa" : "conversas"}`));

  return linhas.join("\n");
}
