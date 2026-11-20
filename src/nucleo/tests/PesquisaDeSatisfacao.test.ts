import assert from "node:assert/strict";
import { test } from "node:test";
import { Atendimento } from "../Atendimento.js";
import { FluxoDoOperador } from "../FluxoDoOperador.js";
import { LimitadorDeTaxa } from "../LimitadorDeTaxa.js";
import { Menu } from "../Menu.js";
import { lerNota, PesquisaDeSatisfacao, TEXTO_AGRADECIMENTO_AVALIACAO } from "../PesquisaDeSatisfacao.js";
import type { EstadoDoMenu, NovoEvento, RepositorioDeAvaliacoes } from "../Repositorios.js";
import { ServicoDeFila } from "../ServicoDeFila.js";
import { topicosDoMenu } from "../Topicos.js";
import { Atendente } from "../entidades/Atendente.js";
import { Chatbot } from "../entidades/Chatbot.js";
import { Cliente } from "../entidades/Cliente.js";
import { Conversa } from "../entidades/Conversa.js";
import { RepositorioDeFilaEmMemoria } from "../../repositorios/RepositorioDeFilaEmMemoria.js";
import { CanalSimulado } from "./apoio/CanalSimulado.js";

type Situacao = "PENDENTE" | "RESPONDIDA" | "DESCARTADA";

/** Avaliações em memória, com o mesmo comportamento do AvaliacaoRepositorio (sem o prazo de 24 h). */
class AvaliacoesEmMemoria implements RepositorioDeAvaliacoes {
  readonly registros = new Map<string, { clienteId: number; nota: number | null; situacao: Situacao }>();
  constructor(private readonly clienteDoTicket: (ticketId: string) => number = () => 1) {}
  async solicitar(ticketId: string): Promise<void> {
    if (!this.registros.has(ticketId)) {
      this.registros.set(ticketId, { clienteId: this.clienteDoTicket(ticketId), nota: null, situacao: "PENDENTE" });
    }
  }
  async pendenteDoCliente(clienteId: number): Promise<string | null> {
    const pendentes = [...this.registros].filter(([, r]) => r.clienteId === clienteId && r.situacao === "PENDENTE");
    return pendentes.at(-1)?.[0] ?? null;
  }
  async registrarNota(ticketId: string, nota: number): Promise<void> {
    const r = this.registros.get(ticketId);
    if (r?.situacao === "PENDENTE") Object.assign(r, { nota, situacao: "RESPONDIDA" });
  }
  async descartar(ticketId: string): Promise<void> {
    const r = this.registros.get(ticketId);
    if (r?.situacao === "PENDENTE") r.situacao = "DESCARTADA";
  }
}

test("3.3 lerNota aceita só notas de 1 a 5", () => {
  assert.equal(lerNota("4"), 4);
  assert.equal(lerNota(" 5 "), 5);
  assert.equal(lerNota("nota 3"), 3);
  assert.equal(lerNota("1 estrela"), 1);
  assert.equal(lerNota("5!"), 5);
  assert.equal(lerNota("0"), null);
  assert.equal(lerNota("6"), null);
  assert.equal(lerNota("45"), null);
  assert.equal(lerNota("quero falar de outra coisa"), null);
});

const operador = new Atendente(7, "Operador", "operador@example.com");
const TELEFONE_OPERADOR = "5581999999999";

async function ticketEmAtendimento(pesquisa: PesquisaDeSatisfacao | null, canal: CanalSimulado) {
  const cliente = new Cliente(1, "Maria", null, "5581888888888");
  const conversa = new Conversa(42, "simulado", cliente, new Chatbot("wxn", "Bot", "simples", 2, true));
  const repo = new RepositorioDeFilaEmMemoria([], [operador], [conversa]);
  const fila = new ServicoDeFila(repo);
  const ticket = await fila.solicitarAtendimentoHumano(42);
  repo.definirEnderecoCliente(ticket.getProtocolo(), "endereco-cliente");
  const fluxo = new FluxoDoOperador(canal, fila, [operador], [{ id: 7, telefone: TELEFONE_OPERADOR }], undefined, pesquisa);
  let n = 0;
  const comando = (texto: string) => fluxo.processarSeOperador({
    idExterno: `op-${++n}`, remetente: TELEFONE_OPERADOR, enderecoResposta: "endereco-operador", texto,
  });
  await comando("fila");
  await comando("1");
  return { ticket, comando };
}

test("3.3 ao encerrar, o cliente recebe o pedido de nota e a avaliação fica pendente", async () => {
  const canal = new CanalSimulado();
  const avaliacoes = new AvaliacoesEmMemoria();
  const { ticket, comando } = await ticketEmAtendimento(new PesquisaDeSatisfacao(canal, avaliacoes), canal);
  await comando("encerrar");

  const paraCliente = canal.enviadas.filter((m) => m.endereco === "endereco-cliente");
  assert.equal(paraCliente.length, 1);
  assert.match(paraCliente[0].texto, new RegExp(`protocolo ${ticket.getProtocolo()}`));
  assert.match(paraCliente[0].texto, /De 1 a 5/);
  assert.equal(avaliacoes.registros.get(ticket.getProtocolo())?.situacao, "PENDENTE");
  // O operador continua recebendo a confirmação de sempre.
  assert.ok(canal.enviadas.some((m) => m.endereco === "endereco-operador" && /encerrado/.test(m.texto)));
});

test("3.3 sem pesquisa configurada, encerrar continua como antes", async () => {
  const canal = new CanalSimulado();
  const { comando } = await ticketEmAtendimento(null, canal);
  await comando("encerrar");
  assert.equal(canal.enviadas.filter((m) => m.endereco === "endereco-cliente").length, 0);
});

test("3.3 falha ao enviar o pedido de nota descarta a avaliação e não atrapalha o operador", async () => {
  const canal = new CanalSimulado();
  const avaliacoes = new AvaliacoesEmMemoria();
  const { ticket, comando } = await ticketEmAtendimento(new PesquisaDeSatisfacao(canal, avaliacoes), canal);
  const enviarOriginal = canal.enviarTexto.bind(canal);
  canal.enviarTexto = async (endereco, texto) => {
    if (endereco === "endereco-cliente") throw new Error("cliente inacessível");
    return enviarOriginal(endereco, texto);
  };
  await comando("encerrar");
  assert.equal(avaliacoes.registros.get(ticket.getProtocolo())?.situacao, "DESCARTADA");
  assert.match(canal.enviadas.at(-1)!.texto, /encerrado/);
});

/** Atendimento mínimo: só o necessário para ver a nota chegando do cliente. */
function atendimentoComAvaliacoes(avaliacoes: RepositorioDeAvaliacoes | null) {
  const canal = new CanalSimulado();
  const eventos: NovoEvento[] = [];
  const processadas = new Set<number>();
  let entradas = 0;
  let estado: EstadoDoMenu = { caminho: [], perguntando: false, historico: [] };
  const conversa = new Conversa(1, "simulado", new Cliente(1, "Maria", null, "5581888888888"),
    new Chatbot("wxn", "Bot", "simples", 2, true));
  const atendimento = new Atendimento(canal,
    { obterOuCriar: async () => 1 },
    { obterOuCriarAtual: async () => 1 },
    {
      registrarEntrada: async () => ++entradas,
      registrarSaida: async () => {},
      marcarProcessada: async (id) => { processadas.add(id); },
    },
    { registrar: async (e) => { eventos.push(e); } },
    { obter: async () => estado, salvar: async (_id, novo) => { estado = novo; } },
    null, new Menu(topicosDoMenu()),
    {
      confiancaMinima: 0.6, limiteDeMensagens: null,
      avisosDeInstabilidade: new LimitadorDeTaxa(1, 60_000), avisosDeExcesso: new LimitadorDeTaxa(1, 60_000),
      avaliacoes,
    },
    new ServicoDeFila(new RepositorioDeFilaEmMemoria([], [], [conversa])),
  );
  let n = 0;
  const enviar = (texto: string) => atendimento.processar({
    idExterno: `c-${++n}`, remetente: "cliente", enderecoResposta: "endereco-cliente", texto,
  });
  return { canal, eventos, enviar, processadas, ultima: () => canal.enviadas.at(-1)?.texto ?? "" };
}

test("3.3 a nota do cliente é gravada, agradecida e registrada como evento", async () => {
  const avaliacoes = new AvaliacoesEmMemoria();
  await avaliacoes.solicitar("PROTO-1");
  const c = atendimentoComAvaliacoes(avaliacoes);
  await c.enviar("4");
  assert.deepEqual(avaliacoes.registros.get("PROTO-1"), { clienteId: 1, nota: 4, situacao: "RESPONDIDA" });
  assert.equal(c.ultima(), TEXTO_AGRADECIMENTO_AVALIACAO);
  assert.equal(c.eventos.at(-1)?.tipo, "avaliacao");
  assert.equal(c.eventos.at(-1)?.dados.nota, 4);
  assert.ok(c.processadas.has(1));

  // Depois de avaliar, "4" volta a ser só uma opção do menu.
  await c.enviar("1");
  assert.notEqual(c.ultima(), TEXTO_AGRADECIMENTO_AVALIACAO);
  assert.equal(c.eventos.at(-1)?.tipo, "resposta");
});

test("3.3 cliente que responde outra coisa segue no atendimento normal e a pesquisa é descartada", async () => {
  const avaliacoes = new AvaliacoesEmMemoria();
  await avaliacoes.solicitar("PROTO-2");
  const c = atendimentoComAvaliacoes(avaliacoes);
  await c.enviar("oi, tenho outra dúvida");
  assert.equal(avaliacoes.registros.get("PROTO-2")?.situacao, "DESCARTADA");
  assert.match(c.ultima(), /1 - /); // recebeu o menu
});

test("3.3 sem avaliação pendente, números continuam sendo opções do menu", async () => {
  const c = atendimentoComAvaliacoes(new AvaliacoesEmMemoria());
  await c.enviar("1");
  assert.notEqual(c.ultima(), TEXTO_AGRADECIMENTO_AVALIACAO);
  assert.equal(c.eventos.at(-1)?.tipo, "resposta");
});

test("3.3 falha ao consultar avaliações não deixa o cliente sem resposta", async () => {
  const quebrado: RepositorioDeAvaliacoes = {
    solicitar: async () => {}, registrarNota: async () => {}, descartar: async () => {},
    pendenteDoCliente: async () => { throw new Error("banco fora"); },
  };
  const c = atendimentoComAvaliacoes(quebrado);
  await c.enviar("oi");
  assert.match(c.ultima(), /1 - /);
});

test("3.3 se o agradecimento falhar, a nota não é gravada e a reentrega vira nota", async () => {
  const avaliacoes = new AvaliacoesEmMemoria();
  await avaliacoes.solicitar("PROTO-3");
  const c = atendimentoComAvaliacoes(avaliacoes);
  c.canal.falharProximoEnvio = true;
  await assert.rejects(c.enviar("5"));
  assert.equal(avaliacoes.registros.get("PROTO-3")?.situacao, "PENDENTE");
  await c.enviar("5");
  assert.equal(avaliacoes.registros.get("PROTO-3")?.nota, 5);
});
