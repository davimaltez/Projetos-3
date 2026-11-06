import assert from "node:assert/strict";
import { test } from "node:test";
import { FluxoDoOperador, lerVinculosOperadoresWhatsApp } from "../FluxoDoOperador.js";
import { Atendente } from "../entidades/Atendente.js";
import { Cliente } from "../entidades/Cliente.js";
import { Chatbot } from "../entidades/Chatbot.js";
import { Conversa } from "../entidades/Conversa.js";
import { Mensagem } from "../entidades/Mensagem.js";
import { ServicoDeFila } from "../ServicoDeFila.js";
import { RepositorioDeFilaEmMemoria } from "../../repositorios/RepositorioDeFilaEmMemoria.js";
import { CanalSimulado } from "./apoio/CanalSimulado.js";

const operador = new Atendente(7, "Operador", "operador@example.com");
function cenario(vinculos = [{ id: 7, telefone: "5581999999999" }]) {
    const canal = new CanalSimulado();
    const fila = new ServicoDeFila(new RepositorioDeFilaEmMemoria());
    const fluxo = new FluxoDoOperador(canal, fila, [operador], vinculos);
    const enviar = (remetente: string, texto: string) => fluxo.processarSeOperador({
        idExterno: `msg-${texto}`, remetente, enderecoResposta: remetente, texto,
    });
    return { canal, fila, fluxo, enviar };
}

test("número não cadastrado continua no fluxo do cliente e não vê a fila", async () => {
    const c = cenario();
    assert.equal(await c.enviar("5581888888888", "fila"), false);
    assert.equal(c.canal.enviadas.length, 0);
});

test("operador cadastrado recebe aviso de fila vazia", async () => {
    const c = cenario();
    assert.equal(await c.enviar("5581999999999", " Fila "), true);
    assert.match(c.canal.enviadas[0].texto, /Não há atendimentos aguardando/);
});

test("operador não cai no menu de cliente ao digitar outro comando", async () => {
    const c = cenario();
    assert.equal(await c.enviar("5581999999999", "olá"), true);
    assert.match(c.canal.enviadas[0].texto, /Comando do operador/);
});

test("identificador anônimo não ganha privilégios de operador", async () => {
    const c = cenario();
    assert.equal(await c.enviar("123456789@lid", "fila"), false);
});

test("vínculos inválidos falham na inicialização", () => {
    assert.throws(() => lerVinculosOperadoresWhatsApp("não é JSON"));
    assert.throws(() => new FluxoDoOperador(new CanalSimulado(), new ServicoDeFila(new RepositorioDeFilaEmMemoria()), [operador], [{ id: 999, telefone: "5581999999999" }]));
});


test("fila com ticket mostra protocolo, assunto e prioridade", async () => {
    const cliente = new Cliente(1, "Cliente", "cliente@example.com", "5581888888888");
    const chatbot = new Chatbot("wxn", "Bot", "simples", 2, true);
    const conversa = new Conversa(42, "simulado", cliente, chatbot);
    const canal = new CanalSimulado();
    const repo = new RepositorioDeFilaEmMemoria([], [operador], [conversa]);
    const fila = new ServicoDeFila(repo);
    const ticket = await fila.solicitarAtendimentoHumano(42);
    const fluxo = new FluxoDoOperador(canal, fila, [operador], [{ id: 7, telefone: "5581999999999" }]);
    assert.equal(await fluxo.processarSeOperador({ idExterno: "f1", remetente: "5581999999999", enderecoResposta: "op", texto: "fila" }), true);
    assert.match(canal.enviadas[0].texto, new RegExp(ticket.getProtocolo()));
    assert.match(canal.enviadas[0].texto, /Prioridade:/);
});

test("operador assume por número e recebe o histórico após atribuição", async () => {
    const cliente = new Cliente(1, "Cliente", "cliente@example.com", "5581888888888");
    const bot = new Chatbot("wxn", "Bot", "simples", 2, true);
    const conversa = new Conversa(55, "simulado", cliente, bot);
    conversa.adicionarMensagem(new Mensagem("Preciso de suporte", new Date("2026-11-06T12:00:00Z"), cliente));
    const repo = new RepositorioDeFilaEmMemoria([], [operador], [conversa]);
    const fila = new ServicoDeFila(repo);
    const ticket = await fila.solicitarAtendimentoHumano(55);
    const canal = new CanalSimulado();
    const fluxo = new FluxoDoOperador(canal, fila, [operador], [{ id: 7, telefone: "5581999999999" }]);
    const msg = (texto: string) => ({ idExterno: `m-${texto}`, remetente: "5581999999999", enderecoResposta: "operador", texto });
    await fluxo.processarSeOperador(msg("fila"));
    await fluxo.processarSeOperador(msg("1"));
    assert.equal(ticket.getStatus(), "EM_ATENDIMENTO");
    assert.match(canal.enviadas.at(-1)!.texto, /Novo atendimento/);
    assert.match(canal.enviadas.at(-1)!.texto, new RegExp(ticket.getProtocolo()));
    assert.match(canal.enviadas.at(-1)!.texto, /Preciso de suporte/);
});

test("opção sem lista ou fora da lista não assume ticket", async () => {
    const c = cenario();
    await c.enviar("5581999999999", "1");
    assert.match(c.canal.enviadas.at(-1)!.texto, /Envie "fila"/);
    await c.enviar("5581999999999", "fila");
    await c.enviar("5581999999999", "2");
    assert.match(c.canal.enviadas.at(-1)!.texto, /Número inválido|Envie "fila"/);
});

test("dois operadores com lista antiga não assumem o mesmo ticket", async () => {
    const outro = new Atendente(8, "Outro", "outro@example.com");
    const cliente = new Cliente(1, "Cliente", "cliente@example.com", "5581888888888");
    const bot = new Chatbot("wxn", "Bot", "simples", 2, true);
    const conversa = new Conversa(56, "simulado", cliente, bot);
    const repo = new RepositorioDeFilaEmMemoria([], [operador, outro], [conversa]);
    const fila = new ServicoDeFila(repo);
    const ticket = await fila.solicitarAtendimentoHumano(56);
    const canal = new CanalSimulado();
    const fluxo = new FluxoDoOperador(canal, fila, [operador, outro], [
        { id: 7, telefone: "5581999999999" }, { id: 8, telefone: "5581977777777" },
    ]);
    const enviar = (remetente: string, texto: string) => fluxo.processarSeOperador({ idExterno: `${remetente}-${texto}`, remetente, enderecoResposta: remetente, texto });
    await enviar("5581999999999", "fila");
    await enviar("5581977777777", "fila");
    await enviar("5581999999999", "1");
    await enviar("5581977777777", "1");
    assert.equal(ticket.getAtendente()?.getId(), "7");
    assert.match(canal.enviadas.at(-1)!.texto, /já foi assumida/);
});
