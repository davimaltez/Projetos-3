import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { AutenticadorDeOperador } from "../AutenticadorDeOperador.js";
import { ServidorHttp } from "../ServidorHttp.js";
import { ServicoDeFila } from "../../nucleo/ServicoDeFila.js";
import { Conversa } from "../../nucleo/entidades/Conversa.js";
import { Mensagem } from "../../nucleo/entidades/Mensagem.js";
import { Usuario } from "../../nucleo/entidades/Usuario.js";
import { RepositorioDeFilaEmMemoria } from "../../repositorios/RepositorioDeFilaEmMemoria.js";

const TOKEN = "credencial-ficticia-para-testes-123456789";
class ClienteFicticio extends Usuario {}

async function servidor(t: TestContext, configurado = true) {
  const cliente = new ClienteFicticio(1, "Cliente", "cliente@example.com");
  const bot = { getId: () => 0, getNome: () => "Bot", getIdentificacao: () => "bot" };
  const conversa = new Conversa(1, "simulado", cliente, bot);
  conversa.adicionarMensagem(new Mensagem("Quero atendimento", new Date("2026-01-01T00:00:00Z"), cliente, "atendimento_humano"));
  const fila = new ServicoDeFila(new RepositorioDeFilaEmMemoria([], [conversa]));
  const ticket = await fila.solicitarAtendimentoHumano(1);
  const autenticador = new AutenticadorDeOperador(configurado ? JSON.stringify([
    { id: 2, nome: "Operador", email: "operador@example.com", token: TOKEN },
  ]) : "[]");
  const http = new ServidorHttp(0, "127.0.0.1", { estaConectado: () => true }, { verificar: async () => true }, false, fila, autenticador);
  await http.iniciar();
  t.after(() => http.encerrar());
  const base = `http://127.0.0.1:${http.portaEmUso}`;
  const headers = { Authorization: `Bearer ${TOKEN}` };
  return { base, headers, ticket, conversa, fila };
}

test("rotas da fila exigem autenticação; diagnósticos e interface continuam públicos", async (t) => {
  const s = await servidor(t);
  for (const [rota, method] of [["/fila", "GET"], ["/tickets/x/assumir", "POST"], ["/tickets/x/historico", "GET"]]) {
    const resposta = await fetch(s.base + rota, { method });
    assert.equal(resposta.status, 401);
    assert.equal(resposta.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(s.base + rota, { method, headers: { Authorization: "Bearer incorreto" } })).status, 401);
  }
  assert.equal(await (await fetch(s.base + "/estou-vivo")).text(), "estou vivo");
  assert.deepEqual(await (await fetch(s.base + "/status")).json(), { whatsapp: true, banco: true, ia: false });
  assert.equal((await fetch(s.base + "/")).status, 200);
});

test("operador lista, assume e consulta histórico; nova assunção retorna 409", async (t) => {
  const s = await servidor(t);
  const protocolo = s.ticket.getProtocolo();
  const lista = await fetch(s.base + "/fila", { headers: s.headers });
  assert.equal(lista.status, 200);
  const itens = await lista.json();
  assert.ok(Array.isArray(itens));
  assert.equal(itens[0].protocolo, protocolo);
  const assumir = await fetch(`${s.base}/tickets/${protocolo}/assumir`, {
    method: "POST", headers: { ...s.headers, "Content-Type": "application/json" }, body: JSON.stringify({ atendenteId: 999 }),
  });
  assert.equal(assumir.status, 200);
  assert.deepEqual(await assumir.json(), { protocolo, status: "EM_ATENDIMENTO", atendenteId: 2 });
  assert.equal(s.ticket.getAtendente()?.getId(), 2);
  assert.equal((await fetch(`${s.base}/tickets/${protocolo}/assumir`, { method: "POST", headers: s.headers })).status, 409);
  assert.deepEqual(await (await fetch(s.base + "/fila", { headers: s.headers })).json(), []);
  const historico = await (await fetch(`${s.base}/tickets/${protocolo}/historico`, { headers: s.headers })).json();
  assert.deepEqual(historico, [{ conteudo: "Quero atendimento", dataHora: "2026-01-01T00:00:00.000Z",
    remetente: "usuario:1", intencaoDetectada: "atendimento_humano" }]);
  assert.ok(!JSON.stringify(historico).includes(TOKEN));
});

test("protocolos inexistentes retornam 404 nas operações do operador", async (t) => {
  const s = await servidor(t);
  assert.equal((await fetch(s.base + "/tickets/inexistente/historico", { headers: s.headers })).status, 404);
  assert.equal((await fetch(s.base + "/tickets/inexistente/assumir", { method: "POST", headers: s.headers })).status, 404);
});

test("sem credenciais configuradas, rotas ficam fechadas e diagnóstico permanece acessível", async (t) => {
  const s = await servidor(t, false);
  assert.equal((await fetch(s.base + "/fila", { headers: s.headers })).status, 503);
  assert.equal((await fetch(s.base + "/estou-vivo")).status, 200);
});

test("credenciais inválidas ou duplicadas são recusadas sem expor os tokens", () => {
  const operador = { id: 1, nome: "Operador", email: "operador@example.com", token: TOKEN };
  for (const configuracao of ["{", "{}", "[null]", JSON.stringify([{ ...operador, token: "curto" }]),
    JSON.stringify([operador, { ...operador, token: TOKEN + "outro" }]), JSON.stringify([operador, { ...operador, id: 2 }])]) {
    assert.throws(() => new AutenticadorDeOperador(configuracao), (erro: Error) => !erro.message.includes(TOKEN));
  }
});

test("falha interna responde 500 sem expor detalhes do armazenamento", async (t) => {
  const s = await servidor(t);
  s.fila.listarFila = async () => { throw new Error("detalhe-interno-de-conexao"); };
  const resposta = await fetch(s.base + "/fila", { headers: s.headers });
  assert.equal(resposta.status, 500);
  assert.ok(!(await resposta.text()).includes("detalhe-interno-de-conexao"));
});
