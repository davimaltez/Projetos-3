import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RepositorioDeFilaEmMemoria } from "../../repositorios/RepositorioDeFilaEmMemoria.js";
import type { RepositorioDeFila } from "../RepositorioDeFila.js";
import { ServicoDeFila, TicketIndisponivelError, TicketNaoEncontradoError } from "../ServicoDeFila.js";
import { Atendente } from "../entidades/Atendente.js";
import type { Chatbot } from "../entidades/Chatbot.js";
import type { Cliente } from "../entidades/Cliente.js";
import { Conversa } from "../entidades/Conversa.js";
import { Prioridade, StatusTicket } from "../entidades/Enums.js";
import { Mensagem } from "../entidades/Mensagem.js";
import { Ticket } from "../entidades/Ticket.js";
import { Usuario } from "../entidades/Usuario.js";

// Objetos fictícios: nenhuma configuração, credencial ou serviço externo é usado.
class ClienteDeTeste extends Usuario implements Cliente {}

const cliente = new ClienteDeTeste(1, "Cliente de teste", "cliente@example.com");
const bot: Chatbot = {
  getId: () => 1,
  getNome: () => "Bot de teste",
  getIdentificacao: () => "chatbot:1",
};
const ana = new Atendente(2, "Ana", "ana@example.com");
const bruno = new Atendente(3, "Bruno", "bruno@example.com");

function instante(minuto: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 10, minuto));
}

function criarTicket(protocolo: string, prioridade = Prioridade.MEDIA, minuto = 0): Ticket {
  const conversa = new Conversa(1, "whatsapp", cliente, bot, instante(0));
  return new Ticket(protocolo, "Suporte", prioridade, instante(minuto), "Resumo do bot", conversa);
}

function criarServico(tickets: readonly Ticket[] = []): ServicoDeFila {
  return new ServicoDeFila(new RepositorioDeFilaEmMemoria(tickets));
}

describe("ServicoDeFila.listarFila", () => {
  test("retorna uma lista vazia quando não há tickets", async () => {
    assert.deepEqual(await criarServico().listarFila(), []);
  });

  test("prioriza ALTA, MEDIA e BAIXA mesmo quando os menos prioritários chegaram antes", async () => {
    const baixa = criarTicket("baixa", Prioridade.BAIXA, 0);
    const alta = criarTicket("alta", Prioridade.ALTA, 20);
    const media = criarTicket("media", Prioridade.MEDIA, 10);
    const fila = await criarServico([baixa, alta, media]).listarFila();
    assert.deepEqual(fila.map((ticket) => ticket.getProtocolo()), ["alta", "media", "baixa"]);
  });

  for (const prioridade of [Prioridade.ALTA, Prioridade.MEDIA, Prioridade.BAIXA]) {
    test(`atende por ordem de chegada dentro da prioridade ${prioridade}`, async () => {
      const antigo = criarTicket("antigo", prioridade, 0);
      const recente = criarTicket("recente", prioridade, 20);
      const intermediario = criarTicket("intermediario", prioridade, 10);
      const fila = await criarServico([recente, antigo, intermediario]).listarFila();
      assert.deepEqual(fila.map((ticket) => ticket.getProtocolo()), ["antigo", "intermediario", "recente"]);
    });
  }

  test("exclui tickets em atendimento e encerrados", async () => {
    const aguardando = criarTicket("aguardando", Prioridade.BAIXA);
    const emAtendimento = criarTicket("em-atendimento", Prioridade.ALTA);
    const encerrado = criarTicket("encerrado", Prioridade.ALTA);
    emAtendimento.atribuir(ana);
    encerrado.atribuir(bruno);
    encerrado.fechar();

    assert.deepEqual(await criarServico([emAtendimento, encerrado, aguardando]).listarFila(), [aguardando]);
    assert.deepEqual(await criarServico([emAtendimento, encerrado]).listarFila(), []);
  });

  test("ordenar e modificar a lista retornada não altera a lista do repositório", async () => {
    const baixa = criarTicket("baixa", Prioridade.BAIXA);
    const alta = criarTicket("alta", Prioridade.ALTA);
    const repositorio = new RepositorioDeFilaEmMemoria([baixa, alta]);
    const fila = await new ServicoDeFila(repositorio).listarFila();
    fila.pop();
    assert.deepEqual(await repositorio.listar(), [baixa, alta]);
  });
});

describe("ServicoDeFila.assumirTicket", () => {
  test("atribui ao atendente, persiste EM_ATENDIMENTO e retira o ticket da fila", async () => {
    const ticket = criarTicket("pendente");
    const repositorio = new RepositorioDeFilaEmMemoria([ticket]);
    const servico = new ServicoDeFila(repositorio);

    await servico.assumirTicket("pendente", ana);

    const salvo = await repositorio.obterPorId("pendente");
    assert.ok(salvo);
    assert.equal(salvo.getStatus(), StatusTicket.EM_ATENDIMENTO);
    assert.equal(salvo.getAtendente(), ana);
    assert.deepEqual(await servico.listarFila(), []);
  });

  test("recusa ticket já assumido por outro atendente e preserva o primeiro responsável", async () => {
    const ticket = criarTicket("ocupado");
    const servico = criarServico([ticket]);
    await servico.assumirTicket("ocupado", ana);

    await assert.rejects(servico.assumirTicket("ocupado", bruno), TicketIndisponivelError);
    assert.equal(ticket.getAtendente(), ana);
    assert.equal(ticket.getStatus(), StatusTicket.EM_ATENDIMENTO);
  });

  test("também recusa nova atribuição ao mesmo atendente", async () => {
    const ticket = criarTicket("ocupado");
    const servico = criarServico([ticket]);
    await servico.assumirTicket("ocupado", ana);
    await assert.rejects(servico.assumirTicket("ocupado", ana), TicketIndisponivelError);
    assert.equal(ticket.getAtendente(), ana);
  });

  test("não reabre um ticket encerrado", async () => {
    const ticket = criarTicket("encerrado");
    ticket.atribuir(ana);
    ticket.fechar();
    const dataFechamento = ticket.getDataFechamento();

    await assert.rejects(criarServico([ticket]).assumirTicket("encerrado", bruno), TicketIndisponivelError);
    assert.equal(ticket.getStatus(), StatusTicket.ENCERRADO);
    assert.equal(ticket.getAtendente(), ana);
    assert.deepEqual(ticket.getDataFechamento(), dataFechamento);
  });

  test("informa quando o protocolo não existe", async () => {
    await assert.rejects(criarServico().assumirTicket("inexistente", ana), TicketNaoEncontradoError);
  });

  test("duas instâncias disputando o mesmo ticket permitem somente uma atribuição", async () => {
    const ticket = criarTicket("disputado");
    const repositorio = new RepositorioDeFilaEmMemoria([ticket]);
    const servicoA = new ServicoDeFila(repositorio);
    const servicoB = new ServicoDeFila(repositorio);
    const atendentes = [ana, bruno];

    const resultados = await Promise.allSettled([
      servicoA.assumirTicket("disputado", ana),
      servicoB.assumirTicket("disputado", bruno),
    ]);

    assert.equal(resultados.filter((resultado) => resultado.status === "fulfilled").length, 1);
    const recusado = resultados.find((resultado) => resultado.status === "rejected");
    assert.ok(recusado && recusado.reason instanceof TicketIndisponivelError);
    const vencedor = resultados.findIndex((resultado) => resultado.status === "fulfilled");
    assert.equal(ticket.getAtendente(), atendentes[vencedor]);
    assert.equal(ticket.getStatus(), StatusTicket.EM_ATENDIMENTO);
  });

  test("recusa quando o repositório detecta disputa após uma leitura que ainda mostrava AGUARDANDO", async () => {
    const leituraAnterior = criarTicket("disputado");
    const repositorio: RepositorioDeFila = {
      listar: async () => [leituraAnterior],
      obterPorId: async () => leituraAnterior,
      atribuirSeAguardando: async () => false,
    };

    await assert.rejects(new ServicoDeFila(repositorio).assumirTicket("disputado", ana), TicketIndisponivelError);
    assert.equal(leituraAnterior.getAtendente(), null);
    assert.equal(leituraAnterior.getStatus(), StatusTicket.AGUARDANDO);
  });
});

describe("ServicoDeFila.obterHistoricoDoTicket", () => {
  test("entrega todas as mensagens em ordem cronológica, preservando remetentes e demais dados", async () => {
    const ticket = criarTicket("historico");
    const conversa = ticket.getConversa();
    const pergunta = new Mensagem("Meu pedido é 123", instante(0), cliente, "status_demanda");
    const respostaBot = new Mensagem("Vou transferir seu atendimento", instante(1), bot);
    const respostaHumana = new Mensagem("Vou consultar seu pedido", instante(2), ana);
    conversa.adicionarMensagem(respostaHumana);
    conversa.adicionarMensagem(pergunta);
    conversa.adicionarMensagem(respostaBot);
    const outroTicket = criarTicket("outro");
    outroTicket.getConversa().adicionarMensagem(new Mensagem("Outra conversa", instante(0), bruno));
    const servico = criarServico([outroTicket, ticket]);
    await servico.assumirTicket("historico", ana);

    const historico = await servico.obterHistoricoDoTicket("historico");

    assert.deepEqual(historico, [pergunta, respostaBot, respostaHumana]);
    assert.equal(historico[0].getConteudo(), "Meu pedido é 123");
    assert.equal(historico[0].getRemetente(), cliente);
    assert.equal(historico[0].getIntencaoDetectada(), "status_demanda");
    assert.deepEqual(historico[0].getDataHora(), instante(0));
    // A consulta não reordena nem remove mensagens da entidade.
    historico.pop();
    assert.deepEqual(conversa.getHistorico(), [respostaHumana, pergunta, respostaBot]);
  });

  test("retorna uma lista vazia para conversa sem mensagens", async () => {
    assert.deepEqual(await criarServico([criarTicket("vazio")]).obterHistoricoDoTicket("vazio"), []);
  });

  test("permite consultar o histórico de um ticket encerrado", async () => {
    const ticket = criarTicket("encerrado");
    const mensagem = new Mensagem("Problema resolvido", instante(0), cliente);
    ticket.getConversa().adicionarMensagem(mensagem);
    ticket.atribuir(ana);
    ticket.fechar();
    assert.deepEqual(await criarServico([ticket]).obterHistoricoDoTicket("encerrado"), [mensagem]);
  });

  test("informa quando o ticket não existe", async () => {
    await assert.rejects(criarServico().obterHistoricoDoTicket("inexistente"), TicketNaoEncontradoError);
  });
});

describe("RepositorioDeFilaEmMemoria", () => {
  test("as listas de entrada e de saída não permitem remover tickets do armazenamento", async () => {
    const ticket = criarTicket("armazenado");
    const entrada = [ticket];
    const repositorio = new RepositorioDeFilaEmMemoria(entrada);
    entrada.pop();
    const saida = await repositorio.listar();
    saida.pop();
    assert.equal(await repositorio.obterPorId("armazenado"), ticket);
    assert.deepEqual(await new RepositorioDeFilaEmMemoria().listar(), []);
  });

  test("recusa protocolos duplicados para evitar atribuição ambígua", () => {
    assert.throws(
      () => new RepositorioDeFilaEmMemoria([criarTicket("repetido"), criarTicket("repetido")]),
      /protocolos duplicados/,
    );
  });

  test("a atribuição condicional não sobrescreve o atendente nem cria tickets inexistentes", async () => {
    const ticket = criarTicket("pendente");
    const repositorio = new RepositorioDeFilaEmMemoria([ticket]);
    assert.equal(await repositorio.atribuirSeAguardando("pendente", ana), true);
    assert.equal(await repositorio.atribuirSeAguardando("pendente", bruno), false);
    assert.equal(ticket.getAtendente(), ana);
    assert.equal(await repositorio.atribuirSeAguardando("inexistente", bruno), false);
    assert.equal(await repositorio.obterPorId("inexistente"), null);
    assert.equal((await repositorio.listar()).length, 1);
  });
});
