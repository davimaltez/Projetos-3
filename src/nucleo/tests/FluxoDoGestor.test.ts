import assert from "node:assert/strict";
import { test } from "node:test";
import { CodigosDeUsoUnico } from "../CodigosDeUsoUnico.js";
import type { EnviadorDeEmail } from "../EnviadorDeEmail.js";
import { FluxoDoGestor, lerGestores, mascararEmail } from "../FluxoDoGestor.js";
import type { FonteDeMetricas, MetricasDeAtendimento } from "../Relatorio.js";
import { CanalSimulado } from "./apoio/CanalSimulado.js";

const TELEFONE_GESTOR = "5581977777777";
const GESTOR = { nome: "Gestora WXN", telefone: TELEFONE_GESTOR, email: "gestora@example.com" };

const METRICAS: MetricasDeAtendimento = {
  totalDeAtendimentos: 120,
  notaMedia: 4.25,
  totalDeAvaliacoes: 8,
  diasDeMaiorMovimento: [{ diaDaSemana: 1, mensagens: 300 }, { diaDaSemana: 3, mensagens: 210 }],
  horariosDeMaiorMovimento: [{ hora: 9, mensagens: 90 }, { hora: 14, mensagens: 70 }],
  assuntosMaisPerguntados: [{ topico: "operacao_sistema", conversas: 60 }, { topico: "status_demanda", conversas: 25 }],
  transferenciasParaAtendente: 30,
  transferenciasPorMotivo: [{ motivo: "PEDIDO_DO_CLIENTE", quantidade: 20 }, { motivo: "FALHAS_SEGUIDAS", quantidade: 10 }],
};

/** E-mail falso: guarda o que seria enviado, para o teste ler o código. */
class EmailSimulado implements EnviadorDeEmail {
  readonly nome = "simulado";
  readonly enviados: { para: string; assunto: string; texto: string }[] = [];
  falhar = false;
  async enviar(para: string, assunto: string, texto: string): Promise<void> {
    if (this.falhar) throw new Error("SMTP fora do ar");
    this.enviados.push({ para, assunto, texto });
  }
  ultimoCodigo(): string {
    return /(\d{6})/.exec(this.enviados.at(-1)?.texto ?? "")?.[1] ?? "";
  }
}

function cenario(opcoes: { agora?: () => number; fonte?: FonteDeMetricas } = {}) {
  const canal = new CanalSimulado();
  const email = new EmailSimulado();
  let consultas = 0;
  const fonte: FonteDeMetricas = opcoes.fonte ?? { obterMetricas: async () => { consultas++; return METRICAS; } };
  const codigos = new CodigosDeUsoUnico(undefined, opcoes.agora);
  const fluxo = new FluxoDoGestor(canal, email, fonte, [GESTOR], {
    fusoHorario: "America/Sao_Paulo",
    codigos,
    agora: () => new Date("2026-11-20T15:00:00Z"),
  });
  let n = 0;
  const enviar = (texto: string, remetente = TELEFONE_GESTOR) =>
    fluxo.processarSeGestor({ idExterno: `g-${++n}`, remetente, enderecoResposta: `end-${remetente}`, texto });
  const ultima = () => canal.enviadas.at(-1)?.texto ?? "";
  return { canal, email, fluxo, enviar, ultima, consultas: () => consultas };
}

test("3.3 gestor pede o relatório, confirma o código do e-mail e recebe as métricas fixas", async () => {
  const c = cenario();
  assert.equal(await c.enviar("Quero o relatório geral"), true);

  // O código foi para o e-mail cadastrado, e não para a conversa.
  assert.equal(c.email.enviados.length, 1);
  assert.equal(c.email.enviados[0].para, "gestora@example.com");
  const codigo = c.email.ultimoCodigo();
  assert.match(codigo, /^\d{6}$/);
  assert.ok(!c.ultima().includes(codigo), "o código não pode aparecer no WhatsApp");
  assert.match(c.ultima(), /ge\*\*\*@example\.com/);

  assert.equal(c.consultas(), 0, "nada de métricas antes do código");
  assert.equal(await c.enviar(codigo), true);
  const relatorio = c.ultima();
  assert.match(relatorio, /Total de atendimentos: 120/);
  assert.match(relatorio, /Nota média de satisfação: 4,3 de 5 \(8 avaliações\)/);
  assert.match(relatorio, /Conversas passadas para um atendente: 30 \(25% dos atendimentos\)/);
  assert.match(relatorio, /pedido do cliente: 20/);
  assert.match(relatorio, /1\. segunda: 300 mensagens/);
  assert.match(relatorio, /1\. 09h–10h: 90 mensagens/);
  assert.match(relatorio, /1\. Dúvida sobre como usar o sistema: 60 conversas/);
  assert.equal(c.canal.enviadas.at(-1)?.endereco, `end-${TELEFONE_GESTOR}`);
});

test("3.3 o código é de uso único: repetir o mesmo código não gera outro relatório", async () => {
  const c = cenario();
  await c.enviar("relatorio");
  const codigo = c.email.ultimoCodigo();
  await c.enviar(codigo);
  assert.equal(c.consultas(), 1);
  // Sem código pendente, os números seguem para o atendimento normal.
  assert.equal(await c.enviar(codigo), false);
  assert.equal(c.consultas(), 1);
});

test("3.3 código errado informa as tentativas restantes e bloqueia na quinta", async () => {
  const c = cenario();
  await c.enviar("relatório");
  const certo = c.email.ultimoCodigo();
  const errado = certo === "000000" ? "111111" : "000000";
  await c.enviar(errado);
  assert.match(c.ultima(), /Código incorreto\. Você ainda tem 4 tentativas/);
  for (let i = 0; i < 3; i++) await c.enviar(errado);
  assert.match(c.ultima(), /ainda tem 1 tentativa\./);
  await c.enviar(errado);
  assert.match(c.ultima(), /esse código foi cancelado/);
  // Nem o código certo vale depois do bloqueio.
  assert.equal(await c.enviar(certo), false);
  assert.equal(c.consultas(), 0);
});

test("3.3 código expirado não libera o relatório", async () => {
  let agora = 1_000_000;
  const c = cenario({ agora: () => agora });
  await c.enviar("relatório");
  const codigo = c.email.ultimoCodigo();
  agora += 10 * 60_000; // 10 minutos depois
  await c.enviar(codigo);
  assert.match(c.ultima(), /expirou/);
  assert.equal(c.consultas(), 0);
});

test("3.3 novo pedido em menos de 1 minuto não dispara outro e-mail", async () => {
  let agora = 1_000_000;
  const c = cenario({ agora: () => agora });
  await c.enviar("relatório");
  agora += 20_000;
  await c.enviar("relatório");
  assert.equal(c.email.enviados.length, 1);
  assert.match(c.ultima(), /peça outro em 40 segundos/);
  agora += 40_000;
  await c.enviar("relatório");
  assert.equal(c.email.enviados.length, 2);
});

test("3.3 errar 5 vezes e pedir outro código na hora continua sujeito ao intervalo", async () => {
  let agora = 1_000_000;
  const c = cenario({ agora: () => agora });
  await c.enviar("relatório");
  const errado = c.email.ultimoCodigo() === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) await c.enviar(errado);
  agora += 5_000;
  await c.enviar("relatório");
  assert.equal(c.email.enviados.length, 1, "sem novo código antes de 1 minuto");
});

test("3.3 código com quantidade errada de números não gasta tentativa", async () => {
  const c = cenario();
  await c.enviar("relatório");
  await c.enviar("1234");
  assert.match(c.ultima(), /O código tem 6 números/);
  await c.enviar(c.email.ultimoCodigo());
  assert.equal(c.consultas(), 1);
});

test("3.3 código com espaços (como vem copiado do e-mail) é aceito", async () => {
  const c = cenario();
  await c.enviar("relatório");
  const codigo = c.email.ultimoCodigo();
  await c.enviar(`${codigo.slice(0, 3)} ${codigo.slice(3)}`);
  assert.equal(c.consultas(), 1);
});

test("3.3 falha no envio do e-mail avisa o gestor e não deixa código pendente", async () => {
  const c = cenario();
  c.email.falhar = true;
  await c.enviar("relatório");
  assert.match(c.ultima(), /Não consegui enviar o e-mail/);
  assert.equal(await c.enviar("123456"), false);
});

test("3.3 falha ao calcular as métricas avisa o gestor", async () => {
  const c = cenario({ fonte: { obterMetricas: async () => { throw new Error("banco fora"); } } });
  await c.enviar("relatório");
  await c.enviar(c.email.ultimoCodigo());
  assert.match(c.ultima(), /Não consegui gerar o relatório agora/);
});

test("3.3 cancelar descarta o código pendente", async () => {
  const c = cenario();
  await c.enviar("relatório");
  const codigo = c.email.ultimoCodigo();
  await c.enviar("cancelar");
  assert.match(c.ultima(), /cancelado/);
  assert.equal(await c.enviar(codigo), false);
});

test("3.3 quem não é gestor não recebe código nem relatório", async () => {
  const c = cenario();
  assert.equal(await c.enviar("relatório", "5581900000000"), false);
  assert.equal(await c.enviar("relatório", "123456789@lid"), false);
  assert.equal(c.email.enviados.length, 0);
  assert.equal(c.canal.enviadas.length, 0);
});

test("3.3 outras mensagens do gestor seguem para o atendimento normal", async () => {
  const c = cenario();
  assert.equal(await c.enviar("oi"), false);
  assert.equal(await c.enviar("2"), false);
  assert.equal(c.canal.enviadas.length, 0);
});

test("3.3 GESTORES_JSON é validado na subida", () => {
  assert.deepEqual(lerGestores("[]"), []);
  assert.equal(lerGestores(JSON.stringify([GESTOR]))[0].email, "gestora@example.com");
  assert.throws(() => lerGestores("não é json"));
  assert.throws(() => lerGestores(JSON.stringify([{ nome: "Sem e-mail", telefone: TELEFONE_GESTOR }])));
  assert.throws(() => lerGestores(JSON.stringify([{ ...GESTOR, email: "invalido" }])));
  const canal = new CanalSimulado();
  const fonte = { obterMetricas: async () => METRICAS };
  assert.throws(() => new FluxoDoGestor(canal, new EmailSimulado(), fonte, [GESTOR, GESTOR], { fusoHorario: "UTC" }));
  assert.throws(() => new FluxoDoGestor(canal, new EmailSimulado(), fonte, [{ ...GESTOR, telefone: "abc" }], { fusoHorario: "UTC" }));
});

test("mascararEmail mostra só o começo do usuário", () => {
  assert.equal(mascararEmail("maria.souza@wxn.com.br"), "ma***@wxn.com.br");
  assert.equal(mascararEmail("ab@x.com"), "a***@x.com");
  assert.equal(mascararEmail("semarroba"), "***");
});
