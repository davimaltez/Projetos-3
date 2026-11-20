import assert from "node:assert/strict";
import { test } from "node:test";
import { formatarRelatorio, type MetricasDeAtendimento } from "../Relatorio.js";

const VAZIO: MetricasDeAtendimento = {
  totalDeAtendimentos: 0,
  notaMedia: null,
  totalDeAvaliacoes: 0,
  diasDeMaiorMovimento: [],
  horariosDeMaiorMovimento: [],
  assuntosMaisPerguntados: [],
  transferenciasParaAtendente: 0,
  transferenciasPorMotivo: [],
};

test("3.3 relatório sem dados não quebra e diz que ainda não há informação", () => {
  const texto = formatarRelatorio(VAZIO, new Date("2026-11-20T15:00:00Z"), "America/Sao_Paulo");
  assert.match(texto, /Total de atendimentos: 0/);
  assert.match(texto, /Nota média de satisfação: sem avaliações ainda/);
  assert.match(texto, /Conversas passadas para um atendente: 0$/m); // sem "(NaN% ...)"
  assert.equal(texto.match(/sem dados ainda/g)?.length, 3);
});

test("3.3 relatório escreve a data no fuso da WXN e a faixa de horário da meia-noite", () => {
  const texto = formatarRelatorio(
    { ...VAZIO, horariosDeMaiorMovimento: [{ hora: 23, mensagens: 1 }], totalDeAvaliacoes: 1, notaMedia: 5 },
    new Date("2026-11-20T15:00:00Z"),
    "America/Sao_Paulo",
  );
  assert.match(texto, /20\/11\/2026, 12:00/); // 15h UTC = 12h em Brasília
  assert.match(texto, /23h–00h: 1 mensagens/);
  assert.match(texto, /5,0 de 5 \(1 avaliação\)/);
});

test("3.3 tópico ou motivo desconhecido aparece pelo próprio id", () => {
  const texto = formatarRelatorio({
    ...VAZIO,
    totalDeAtendimentos: 3,
    assuntosMaisPerguntados: [{ topico: "topico_novo", conversas: 1 }],
    transferenciasParaAtendente: 1,
    transferenciasPorMotivo: [{ motivo: "MOTIVO_NOVO", quantidade: 1 }],
  }, new Date(), "UTC");
  assert.match(texto, /1\. topico_novo: 1 conversa$/m);
  assert.match(texto, /- MOTIVO_NOVO: 1/);
  assert.match(texto, /\(33% dos atendimentos\)/);
});
