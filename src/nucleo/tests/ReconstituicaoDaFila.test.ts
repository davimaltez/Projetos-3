import assert from "node:assert/strict";
import { test } from "node:test";
import { Atendente } from "../entidades/Atendente.js";
import { Chatbot } from "../entidades/Chatbot.js";
import { Cliente } from "../entidades/Cliente.js";
import { Conversa } from "../entidades/Conversa.js";
import { Prioridade, StatusConversa, StatusTicket } from "../entidades/Enums.js";
import { Mensagem } from "../entidades/Mensagem.js";
import { Ticket } from "../entidades/Ticket.js";

// Cliente histórico: sem nome e sem e-mail cadastrados.
const cliente = new Cliente(17, null, null, "5581999990017");
const atendente = new Atendente(9, "Ana", "ana@example.test");
const bot = new Chatbot(1, "Bot", "simples", 2, true);
const abertura = new Date("2026-01-01T10:00:00Z");
const fechamento = new Date("2026-01-01T11:00:00Z");

function conversaHistorica(status: StatusConversa | null = null): Conversa {
  return Conversa.reconstituir({
    id: 1, canal: null, cliente, chatbot: null, dataInicio: null, dataFim: null,
    status, estadoPersistido: status ?? "LEGADO", mensagens: [],
  });
}

test("reconstituição representa ausências sem criar identidades ou datas", () => {
  const conversa = conversaHistorica();
  assert.equal(conversa.getCanal(), null);
  assert.equal(conversa.getDataInicio(), null);
  assert.equal(conversa.getDataFim(), null);
  assert.equal(conversa.getStatus(), null);
  assert.equal(conversa.getEstadoPersistido(), "LEGADO");
  assert.equal(conversa.getChatbot(), null);
  assert.equal(conversa.getCliente().getNome(), null);
  assert.equal(conversa.getCliente().getEmail(), null);
  assert.equal(conversa.getCliente().getIdentificacao(), "cliente:17");
  const mensagem = Mensagem.reconstituir({
    id: 31, direcao: "saida", conteudo: null, dataHora: abertura,
    remetente: null, intencaoDetectada: null,
  });
  assert.equal(mensagem.getConteudo(), null);
  assert.equal(mensagem.getRemetente(), null);
  assert.equal(mensagem.getIntencaoDetectada(), null);
  assert.equal(mensagem.getId(), 31);
  assert.equal(mensagem.getDirecao(), "saida");
});

test("construtores e transições normais preservam o comportamento anterior", () => {
  const conversa = new Conversa(1, "whatsapp", cliente, bot, abertura);
  const mensagem = new Mensagem("Olá", abertura, cliente);
  assert.equal(conversa.getStatus(), StatusConversa.COM_BOT);
  assert.equal(conversa.getChatbot(), bot);
  assert.deepEqual(conversa.getDataInicio(), abertura);
  assert.equal(mensagem.getIntencaoDetectada(), "");
  conversa.adicionarMensagem(mensagem);
  const ticket = conversa.transferirParaHumano();
  assert.equal(ticket.getResumoBot(), "Olá");
  assert.equal(conversa.transferirParaHumano(), ticket);
  assert.equal(conversa.getStatus(), StatusConversa.AGUARDANDO_ATENDENTE);
  ticket.atribuir(atendente);
  ticket.fechar();
  assert.equal(ticket.getStatus(), StatusTicket.ENCERRADO);
  assert.ok(ticket.getDataFechamento() instanceof Date);
  conversa.encerrar();
  assert.throws(() => conversa.adicionarMensagem(mensagem));
  assert.throws(() => conversa.transferirParaHumano());
  // A identidade comum de atendentes continua estaticamente completa.
  const email: string = atendente.getEmail();
  assert.equal(email, "ana@example.test");
});

test("fábrica restaura ticket encerrado e conversa encerrada sem executar transições", () => {
  const dataFim = new Date(fechamento);
  const mensagens = [new Mensagem("Resolvido", abertura, cliente)];
  const conversa = Conversa.reconstituir({
    id: 1, canal: null, cliente, chatbot: null, dataInicio: abertura, dataFim,
    status: StatusConversa.ENCERRADA, estadoPersistido: "ENCERRADA", mensagens,
  });
  const ticket = Ticket.reconstituir({
    protocolo: "historico", assunto: "Suporte", prioridade: Prioridade.ALTA,
    status: StatusTicket.ENCERRADO, dataAbertura: abertura, dataFechamento: dataFim,
    resumoBot: "Resumo", conversa, atendente,
  });
  dataFim.setFullYear(2000);
  mensagens.pop();
  assert.deepEqual(ticket.getDataFechamento(), fechamento);
  assert.deepEqual(conversa.getDataFim(), fechamento);
  assert.equal(conversa.getHistorico().length, 1);
  const copia = ticket.getDataFechamento();
  copia?.setFullYear(1999);
  conversa.getHistorico().pop();
  assert.deepEqual(ticket.getDataFechamento(), fechamento);
  assert.equal(conversa.getHistorico().length, 1);
  assert.throws(() => ticket.atribuir(atendente));
});

test("vínculo reconstituído evita gerar outro protocolo sem alterar o estado legado", () => {
  const conversa = conversaHistorica(StatusConversa.COM_BOT);
  const ticket = Ticket.reconstituir({
    protocolo: "existente", assunto: "Suporte", prioridade: Prioridade.MEDIA,
    status: StatusTicket.AGUARDANDO, dataAbertura: abertura, dataFechamento: null,
    resumoBot: "", conversa, atendente: null,
  });
  assert.equal(conversa.transferirParaHumano(), ticket);
  assert.equal(conversa.getStatus(), StatusConversa.COM_BOT);
  assert.throws(() => conversaHistorica().vincularTicketReconstituido(ticket));
});

test("fábricas recusam estado inconsistente e datas inválidas", () => {
  assert.throws(() => Ticket.reconstituir({
    protocolo: "incorreto", assunto: "", prioridade: Prioridade.MEDIA,
    status: StatusTicket.ENCERRADO, dataAbertura: abertura, dataFechamento: null,
    resumoBot: "", conversa: conversaHistorica(), atendente,
  }), /inconsistente/);
  assert.throws(() => Mensagem.reconstituir({
    id: 1, direcao: "entrada", conteudo: "", dataHora: new Date(NaN),
    remetente: cliente, intencaoDetectada: null,
  }), /inválida/);
});

test("datas e arrays reconstituídos são protegidos por cópias", () => {
  const data = new Date(abertura);
  const mensagem = Mensagem.reconstituir({
    id: 1, direcao: "entrada", conteudo: "", dataHora: data, remetente: cliente, intencaoDetectada: "",
  });
  data.setFullYear(2000);
  mensagem.getDataHora().setFullYear(1999);
  assert.deepEqual(mensagem.getDataHora(), abertura);
  assert.equal(mensagem.getConteudo(), "");
  assert.equal(mensagem.getIntencaoDetectada(), "");
});
