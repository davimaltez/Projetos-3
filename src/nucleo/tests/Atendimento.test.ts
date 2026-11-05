import assert from "node:assert/strict";
import { test } from "node:test";
import { Atendimento } from "../Atendimento.js";
import type { ClassificadorDeIntencao } from "../ClassificadorDeIntencao.js";
import { LimitadorDeTaxa } from "../LimitadorDeTaxa.js";
import { Menu } from "../Menu.js";
import type { NovoEvento } from "../Repositorios.js";
import { ServicoDeFila } from "../ServicoDeFila.js";
import { topicosDoMenu } from "../Topicos.js";
import { Atendente } from "../entidades/Atendente.js";
import { Conversa } from "../entidades/Conversa.js";
import { StatusConversa } from "../entidades/Enums.js";
import { Mensagem } from "../entidades/Mensagem.js";
import { Cliente } from "../entidades/Cliente.js";
import { Chatbot } from "../entidades/Chatbot.js";
import { RepositorioDeFilaEmMemoria } from "../../repositorios/RepositorioDeFilaEmMemoria.js";
import { CanalSimulado } from "./apoio/CanalSimulado.js";

function cenario(classificador: ClassificadorDeIntencao | null = null) {
  const cliente = new Cliente(1, "Cliente", "cliente@example.com", "5581999999999");
  const bot = new Chatbot("wxn", "Bot", "simples", 2, true);
  const conversa = new Conversa(1, "simulado", cliente, bot);
  const repositorio = new RepositorioDeFilaEmMemoria([], [new Atendente(2, "Operador", "operador@example.com")], [conversa]);
  const fila = new ServicoDeFila(repositorio);
  const canal = new CanalSimulado();
  const eventos: NovoEvento[] = [];
  const entradas = new Map<string, { id: number; processada: boolean; mensagem: Mensagem }>();
  let caminho: string[] = [];
  const atendimento = new Atendimento(canal,
    { obterOuCriar: async () => 1 }, { obterOuCriarAtual: async () => 1 }, {
      registrarEntrada: async (_id, id, texto) => {
        const anterior = entradas.get(id);
        if (anterior) return anterior.processada ? null : anterior.id;
        const mensagem = new Mensagem(texto, new Date(), cliente);
        const entrada = { id: entradas.size + 1, processada: false, mensagem };
        entradas.set(id, entrada);
        conversa.adicionarMensagem(mensagem);
        return entrada.id;
      },
      registrarSaida: async (_id, _externo, texto) => { conversa.adicionarMensagem(new Mensagem(texto, new Date(), bot)); },
      marcarProcessada: async (id) => { [...entradas.values()].find((e) => e.id === id)!.processada = true; },
    }, {
      registrar: async (evento) => {
        eventos.push(evento);
        const entrada = [...entradas.values()].find((e) => e.id === evento.dados.mensagemId);
        entrada?.mensagem.setIntencaoDetectada(evento.intencao ?? "");
      },
    }, {
      obterCaminho: async () => [...caminho],
      salvarCaminho: async (_id, novo) => { caminho = [...novo]; },
    }, classificador, new Menu(topicosDoMenu()), {
      confiancaMinima: 0.6, limiteDeMensagens: null,
      avisosDeInstabilidade: new LimitadorDeTaxa(1, 60_000), avisosDeExcesso: new LimitadorDeTaxa(1, 60_000),
    }, fila);
  const enviar = (texto: string, id = `entrada-${entradas.size + 1}`) => atendimento.processar({
    texto, idExterno: id, remetente: "cliente-simulado", enderecoResposta: "endereco-simulado",
  });
  return { atendimento, enviar, fila, conversa, canal, entradas, eventos, repositorio };
}

test("menu real oferece atendimento humano e a opção 3 cria ticket com histórico", async () => {
  const c = cenario();
  await c.enviar("oi");
  assert.match(c.canal.enviadas[0].texto, /3 - Falar com um atendente/);
  await c.enviar("3");
  const [ticket] = await c.fila.listarFila();
  assert.ok(ticket);
  assert.equal(c.conversa.getStatus(), StatusConversa.AGUARDANDO_ATENDENTE);
  assert.ok(c.canal.enviadas[1].texto.includes(ticket.getProtocolo()));
  assert.deepEqual((await c.fila.obterHistoricoDoTicket(ticket.getProtocolo())).map((m) => m.getTexto()),
    ["oi", c.canal.enviadas[0].texto, "3", c.canal.enviadas[1].texto]);
});

test("comando atendente funciona dentro do submenu sem consultar IA", async () => {
  const c = cenario({ nome: "não deve chamar", classificar: async () => { throw new Error("IA indevida"); } });
  await c.enviar("2");
  assert.match(c.canal.enviadas[0].texto, /envie "atendente"/);
  await c.enviar("atendente");
  assert.equal((await c.fila.listarFila()).length, 1);
  assert.equal(c.eventos.at(-1)?.origem, "menu");
});

test("pedidos repetidos e concorrentes reutilizam um ticket e duplicatas não respondem novamente", async () => {
  const c = cenario();
  await Promise.all([c.enviar("3", "a"), c.enviar("atendente", "b"), c.enviar("atendente", "b")]);
  assert.equal((await c.fila.listarFila()).length, 1);
  const [ticket] = await c.fila.listarFila();
  assert.equal(c.canal.enviadas.length, 2);
  assert.ok(c.canal.enviadas.every((m) => m.texto.includes(ticket.getProtocolo())));
  await c.enviar("3", "a");
  assert.equal(c.canal.enviadas.length, 2);
});

test("mensagens na espera e após assunção são preservadas sem resposta automática ou IA", async () => {
  let chamadas = 0;
  const c = cenario({ nome: "simulado", classificar: async () => { chamadas++; return { topico: null, confianca: 0 }; } });
  await c.enviar("3");
  await c.enviar("Meu problema é com acesso");
  const [ticket] = await c.fila.listarFila();
  await c.fila.assumirTicket(ticket.getProtocolo(), new Atendente(2, "Operador", "operador@example.com"));
  await c.enviar("Mais detalhes do problema");
  assert.equal(c.conversa.getStatus(), StatusConversa.EM_ATENDIMENTO);
  assert.equal(c.canal.enviadas.length, 1);
  assert.equal(chamadas, 0);
  assert.ok([...c.entradas.values()].every((e) => e.processada));
  assert.equal((await c.fila.obterHistoricoDoTicket(ticket.getProtocolo())).at(-1)?.getTexto(), "Mais detalhes do problema");
});

test("falha no envio permite reprocessar a transferência sem duplicar o ticket", async () => {
  const c = cenario();
  c.canal.falharProximoEnvio = true;
  await assert.rejects(c.enviar("atendente", "retry"), /Falha simulada/);
  const [ticket] = await c.fila.listarFila();
  assert.equal(c.entradas.get("retry")?.processada, false);
  await c.enviar("atendente", "retry");
  assert.deepEqual(await c.fila.listarFila(), [ticket]);
  assert.equal(c.entradas.get("retry")?.processada, true);
  assert.ok(c.canal.enviadas[0].texto.includes(ticket.getProtocolo()));
});

test("classificação confiante de pedido humano cria ticket, e incerteza mantém o menu", async () => {
  const humano = cenario({ nome: "simulado", classificar: async () => ({ topico: "atendimento_humano", confianca: 0.9 }) });
  await humano.enviar("Preciso conversar com a equipe");
  assert.equal((await humano.fila.listarFila()).length, 1);
  assert.equal(humano.eventos[0].origem, "ia");
  const incerto = cenario({ nome: "simulado", classificar: async () => ({ topico: "atendimento_humano", confianca: 0.2 }) });
  await incerto.enviar("Estou confuso");
  assert.equal((await incerto.fila.listarFila()).length, 0);
  assert.match(incerto.canal.enviadas[0].texto, /Digite o número/);
});

test("pedido seguido imediatamente de detalhes não deixa o bot responder ao segundo texto", async () => {
  const c = cenario();
  await Promise.all([c.enviar("3", "pedido"), c.enviar("Detalhes", "detalhes")]);
  assert.equal(c.canal.enviadas.length, 1);
  assert.equal(c.entradas.get("detalhes")?.processada, true);
});

test("falha na fila avisa instabilidade sem confirmar transferência e permite nova tentativa", async () => {
  const c = cenario();
  const enfileirar = c.repositorio.enfileirar.bind(c.repositorio);
  c.repositorio.enfileirar = async () => { throw new Error("Falha simulada do banco"); };
  await assert.rejects(c.enviar("3", "retry-banco"), /Falha simulada do banco/);
  assert.equal((await c.fila.listarFila()).length, 0);
  assert.equal(c.entradas.get("retry-banco")?.processada, false);
  assert.match(c.canal.enviadas[0].texto, /instabilidade/);
  c.repositorio.enfileirar = enfileirar;
  await c.enviar("3", "retry-banco");
  assert.equal((await c.fila.listarFila()).length, 1);
  assert.equal(c.entradas.get("retry-banco")?.processada, true);
});
