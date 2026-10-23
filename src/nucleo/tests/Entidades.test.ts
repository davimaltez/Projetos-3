import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Atendente } from "../entidades/Atendente.js";
import { Chatbot, INTENCAO_INDEFINIDA, RESPOSTA_SEM_TOPICO } from "../entidades/Chatbot.js";
import { Cliente } from "../entidades/Cliente.js";
import { Conversa } from "../entidades/Conversa.js";
import {
  Prioridade, PrioridadeTicket, StatusAtendente, StatusConversa, StatusTicket, TipoAtendimento, TipoRemetente,
} from "../entidades/Enums.js";
import { Mensagem } from "../entidades/Mensagem.js";
import type { Remetente } from "../entidades/Remetente.js";
import { Ticket } from "../entidades/Ticket.js";
import { RepositorioDeFilaEmMemoria } from "../../repositorios/RepositorioDeFilaEmMemoria.js";
import { ServicoDeFila } from "../ServicoDeFila.js";
import { TOPICOS } from "../Topicos.js";

// Dados fictícios: nenhum telefone, e-mail ou serviço real é usado.
const agora = new Date("2026-01-01T10:00:00Z");

function novoCliente(telefone = "5581999990001"): Cliente {
  return new Cliente(1, "Carla", "carla@example.test", telefone, "Distribuidora Exemplo");
}

function novoBot(limiteTentativas = 2): Chatbot {
  return new Chatbot(7, "Assistente WXN", "simples e cordial", limiteTentativas, true);
}

function novoTicket(): Ticket {
  const conversa = new Conversa(1, "whatsapp", novoCliente(), novoBot(), agora);
  return new Ticket("P-1", "Suporte", Prioridade.MEDIA, agora, "Resumo", conversa);
}

function doCliente(cliente: Cliente, intencao?: string): Mensagem {
  return new Mensagem("mensagem do cliente", agora, cliente, intencao);
}

describe("Enums do diagrama", () => {
  test("StatusConversa tem os 4 estados, inclusive EM_ATENDIMENTO", () => {
    assert.deepEqual(Object.values(StatusConversa), ["COM_BOT", "AGUARDANDO_ATENDENTE", "EM_ATENDIMENTO", "ENCERRADA"]);
  });

  test("StatusAtendente usa os mesmos valores do CHECK da tabela atendentes", () => {
    assert.deepEqual(Object.values(StatusAtendente), ["DISPONIVEL", "OCUPADO", "OFFLINE"]);
  });

  test("TipoAtendimento tem SIMPLIFICADO e PERSONALIZADO", () => {
    assert.deepEqual(Object.values(TipoAtendimento), ["SIMPLIFICADO", "PERSONALIZADO"]);
  });

  test("TipoRemetente tem CLIENTE, ATENDENTE e CHATBOT (plano)", () => {
    assert.deepEqual(Object.values(TipoRemetente), ["CLIENTE", "ATENDENTE", "CHATBOT"]);
  });

  test("PrioridadeTicket tem BAIXA, MEDIA, ALTA e URGENTE (plano)", () => {
    assert.deepEqual(Object.values(PrioridadeTicket), ["BAIXA", "MEDIA", "ALTA", "URGENTE"]);
  });

  test("Prioridade (nome antigo) é o mesmo enum que PrioridadeTicket", () => {
    assert.equal(Prioridade, PrioridadeTicket);
    assert.equal(Prioridade.URGENTE, PrioridadeTicket.URGENTE);
  });

  test("a fila atende URGENTE antes de ALTA, MEDIA e BAIXA", async () => {
    const criar = (protocolo: string, prioridade: PrioridadeTicket) => {
      const conversa = new Conversa(1, "whatsapp", novoCliente(), novoBot(), agora);
      return new Ticket(protocolo, "Suporte", prioridade, agora, "Resumo", conversa);
    };
    const fila = await new ServicoDeFila(new RepositorioDeFilaEmMemoria([
      criar("baixa", PrioridadeTicket.BAIXA), criar("alta", PrioridadeTicket.ALTA),
      criar("urgente", PrioridadeTicket.URGENTE), criar("media", PrioridadeTicket.MEDIA),
    ])).listarFila();
    assert.deepEqual(fila.map((t) => t.getProtocolo()), ["urgente", "alta", "media", "baixa"]);
  });
});

describe("Remetente", () => {
  test("Cliente, Atendente e Chatbot se identificam sem colidir, mesmo com o mesmo id", () => {
    const remetentes: Remetente[] = [
      new Cliente(5, "C", null, "5581999990005"),
      new Atendente(5, "A", "a@example.test"),
      new Chatbot(5, "B", "simples", 1, true),
    ];
    assert.deepEqual(remetentes.map((r) => r.getIdentificacao()), ["cliente:5", "atendente:5", "chatbot:5"]);
  });

  test("getId devolve texto, getNome e getTipo identificam cada remetente (plano)", () => {
    const remetentes: Remetente[] = [
      new Cliente(5, "Carla", null, "5581999990005"),
      new Atendente(6, "Ana", "ana@example.test"),
      new Chatbot(7, "Assistente WXN", "simples", 1, true),
    ];
    assert.deepEqual(remetentes.map((r) => r.getId()), ["5", "6", "7"]);
    assert.deepEqual(remetentes.map((r) => r.getNome()), ["Carla", "Ana", "Assistente WXN"]);
    assert.deepEqual(remetentes.map((r) => r.getTipo()),
      [TipoRemetente.CLIENTE, TipoRemetente.ATENDENTE, TipoRemetente.CHATBOT]);
  });

  test("id numérico do banco e id em texto viram o mesmo id", () => {
    assert.equal(new Atendente(101, "Ana", "ana@example.test").getId(), new Atendente("101", "Ana", "ana@example.test").getId());
  });

  test("cliente antigo sem nome é um remetente com nome null", () => {
    const remetente: Remetente = new Cliente(8, null, null, "5581999990008");
    assert.equal(remetente.getNome(), null);
    assert.equal(remetente.getTipo(), TipoRemetente.CLIENTE);
  });

  test("a mensagem tem um remetente associado (não é um remetente)", () => {
    const cliente = novoCliente();
    const mensagem = doCliente(cliente);
    assert.equal(mensagem.getRemetente(), cliente);
    assert.equal("getIdentificacao" in mensagem, false);
  });
});

describe("Usuario (via Cliente e Atendente)", () => {
  test("getters devolvem o que foi informado no construtor", () => {
    const atendente = new Atendente(2, "Ana", "ana@example.test");
    assert.equal(atendente.getId(), "2");
    assert.equal(atendente.getNome(), "Ana");
    assert.equal(atendente.getEmail(), "ana@example.test");
  });

  test("setNome e setEmail alteram os valores", () => {
    const atendente = new Atendente(2, "Ana", "ana@example.test");
    atendente.setNome("Ana Souza");
    atendente.setEmail("ana.souza@example.test");
    assert.equal(atendente.getNome(), "Ana Souza");
    assert.equal(atendente.getEmail(), "ana.souza@example.test");
  });

  test("setNome recusa nome vazio e não altera o valor anterior", () => {
    const atendente = new Atendente(2, "Ana", "ana@example.test");
    assert.throws(() => atendente.setNome("   "), /nome não pode ser vazio/);
    assert.equal(atendente.getNome(), "Ana");
  });

  test("setEmail recusa e-mail sem formato válido e não altera o valor anterior", () => {
    const atendente = new Atendente(2, "Ana", "ana@example.test");
    for (const invalido of ["ana", "ana@", "@example.test", "ana example@test.com"]) {
      assert.throws(() => atendente.setEmail(invalido), /E-mail inválido/);
    }
    assert.equal(atendente.getEmail(), "ana@example.test");
  });

  test("cliente histórico aceita nome e e-mail nulos", () => {
    const cliente = new Cliente(3, null, null, "5581999990003");
    assert.equal(cliente.getNome(), null);
    assert.equal(cliente.getEmail(), null);
    cliente.setNome("Carla");
    assert.equal(cliente.getNome(), "Carla");
  });
});

describe("Atendente", () => {
  test("começa OFFLINE e sem especialidade quando não informados", () => {
    const atendente = new Atendente(2, "Ana", "ana@example.test");
    assert.equal(atendente.getStatus(), StatusAtendente.OFFLINE);
    assert.equal(atendente.getEspecialidade(), null);
  });

  test("setStatus altera a disponibilidade", () => {
    const atendente = new Atendente(2, "Ana", "ana@example.test");
    atendente.setStatus(StatusAtendente.DISPONIVEL);
    assert.equal(atendente.getStatus(), StatusAtendente.DISPONIVEL);
  });

  test("assumirTicket atribui o ticket e deixa o atendente OCUPADO", () => {
    const atendente = new Atendente(2, "Ana", "ana@example.test", StatusAtendente.DISPONIVEL, "Fiscal");
    const ticket = novoTicket();
    atendente.assumirTicket(ticket);
    assert.equal(ticket.getAtendente(), atendente);
    assert.equal(ticket.getStatus(), StatusTicket.EM_ATENDIMENTO);
    assert.equal(atendente.getStatus(), StatusAtendente.OCUPADO);
  });

  for (const status of [StatusAtendente.OFFLINE, StatusAtendente.OCUPADO]) {
    test(`atendente ${status} não assume ticket e o ticket continua AGUARDANDO`, () => {
      const atendente = new Atendente(2, "Ana", "ana@example.test", status);
      const ticket = novoTicket();
      assert.throws(() => atendente.assumirTicket(ticket), /DISPONIVEL/);
      assert.equal(ticket.getStatus(), StatusTicket.AGUARDANDO);
      assert.equal(ticket.getAtendente(), null);
      assert.equal(atendente.getStatus(), status);
    });
  }

  test("não assume ticket que outro atendente já assumiu, e continua DISPONIVEL", () => {
    const ana = new Atendente(2, "Ana", "ana@example.test", StatusAtendente.DISPONIVEL);
    const bruno = new Atendente(3, "Bruno", "bruno@example.test", StatusAtendente.DISPONIVEL);
    const ticket = novoTicket();
    ana.assumirTicket(ticket);
    assert.throws(() => bruno.assumirTicket(ticket), /nao esta aguardando/);
    assert.equal(ticket.getAtendente(), ana);
    assert.equal(bruno.getStatus(), StatusAtendente.DISPONIVEL);
  });

  test("encerrarTicket fecha o ticket e devolve o atendente a DISPONIVEL", () => {
    const atendente = new Atendente(2, "Ana", "ana@example.test", StatusAtendente.DISPONIVEL);
    const ticket = novoTicket();
    atendente.assumirTicket(ticket);
    atendente.encerrarTicket(ticket);
    assert.equal(ticket.getStatus(), StatusTicket.ENCERRADO);
    assert.notEqual(ticket.getDataFechamento(), null);
    assert.equal(atendente.getStatus(), StatusAtendente.DISPONIVEL);
  });

  test("só o responsável encerra: outro atendente e ticket sem dono são recusados", () => {
    const ana = new Atendente(2, "Ana", "ana@example.test", StatusAtendente.DISPONIVEL);
    const bruno = new Atendente(3, "Bruno", "bruno@example.test", StatusAtendente.DISPONIVEL);
    const semDono = novoTicket();
    assert.throws(() => ana.encerrarTicket(semDono), /responsável/);

    const ticket = novoTicket();
    ana.assumirTicket(ticket);
    assert.throws(() => bruno.encerrarTicket(ticket), /responsável/);
    assert.equal(ticket.getStatus(), StatusTicket.EM_ATENDIMENTO);
    assert.equal(bruno.getStatus(), StatusAtendente.DISPONIVEL);
  });

  test("reconhece o responsável pelo id, mesmo em outra instância (ex.: lida do banco)", () => {
    const ana = new Atendente(2, "Ana", "ana@example.test", StatusAtendente.DISPONIVEL);
    const ticket = novoTicket();
    ana.assumirTicket(ticket);
    const mesmaAna = new Atendente(2, "Ana", "ana@example.test", StatusAtendente.OCUPADO);
    mesmaAna.encerrarTicket(ticket);
    assert.equal(ticket.getStatus(), StatusTicket.ENCERRADO);
  });
});

describe("Cliente", () => {
  test("getters e valores padrão", () => {
    const cliente = new Cliente(1, "Carla", null, "5581999990001");
    assert.equal(cliente.getTelefone(), "5581999990001");
    assert.equal(cliente.getEmpresa(), null);
    assert.equal(cliente.getTipoAtendimento(), TipoAtendimento.SIMPLIFICADO);
    assert.equal(cliente.isAutenticado(), false);
  });

  test("setTipoAtendimento altera o tipo", () => {
    const cliente = novoCliente();
    cliente.setTipoAtendimento(TipoAtendimento.PERSONALIZADO);
    assert.equal(cliente.getTipoAtendimento(), TipoAtendimento.PERSONALIZADO);
  });

  for (const telefone of ["5581999990001", "8199999000", "123456789012345"]) {
    test(`autentica com telefone válido (${telefone.length} dígitos)`, () => {
      const cliente = novoCliente(telefone);
      assert.equal(cliente.autenticar(), true);
      assert.equal(cliente.isAutenticado(), true);
    });
  }

  for (const telefone of ["", "819999900", "1234567890123456", "+5581999990001", "123456789@lid", "81 99999-0001"]) {
    test(`não autentica com identificador inválido: "${telefone}"`, () => {
      const cliente = novoCliente(telefone);
      assert.equal(cliente.autenticar(), false);
      assert.equal(cliente.isAutenticado(), false);
    });
  }

  test("iniciarConversa cria a conversa com o bot, ligada ao cliente", () => {
    const cliente = novoCliente();
    const bot = novoBot();
    cliente.autenticar();
    const conversa = cliente.iniciarConversa(10, "whatsapp", bot);
    assert.equal(conversa.getId(), 10);
    assert.equal(conversa.getCanal(), "whatsapp");
    assert.equal(conversa.getCliente(), cliente);
    assert.equal(conversa.getChatbot(), bot);
    assert.equal(conversa.getStatus(), StatusConversa.COM_BOT);
  });

  test("cliente não autenticado não inicia conversa", () => {
    const cliente = novoCliente("123456789@lid");
    assert.throws(() => cliente.iniciarConversa(10, "whatsapp", novoBot()), /autenticado/);
    cliente.autenticar();
    assert.throws(() => cliente.iniciarConversa(10, "whatsapp", novoBot()), /autenticado/);
  });
});

describe("Chatbot", () => {
  test("getters de configuração", () => {
    const bot = novoBot(3);
    assert.equal(bot.getId(), "7");
    assert.equal(bot.getNome(), "Assistente WXN");
    assert.equal(bot.getTomDeVoz(), "simples e cordial");
    assert.equal(bot.getLimiteTentativas(), 3);
    assert.equal(bot.isDisponivel24h(), true);
    assert.equal(new Chatbot(8, "Bot comercial", "formal", 1, false).isDisponivel24h(), false);
  });

  for (const limite of [0, -1, 1.5, Number.NaN]) {
    test(`recusa limiteTentativas inválido (${limite})`, () => {
      assert.throws(() => novoBot(limite), /limiteTentativas/);
    });
  }

  test("detectarIntencao lê a intenção da mensagem; vazia vira indefinido", () => {
    const bot = novoBot();
    const cliente = novoCliente();
    assert.equal(bot.detectarIntencao(doCliente(cliente, "status_demanda")), "status_demanda");
    assert.equal(bot.detectarIntencao(doCliente(cliente)), INTENCAO_INDEFINIDA);
    assert.equal(bot.detectarIntencao(doCliente(cliente, "   ")), INTENCAO_INDEFINIDA);
  });

  test("responder usa o texto do tópico e tem o bot como remetente", () => {
    const bot = novoBot();
    const resposta = bot.responder(doCliente(novoCliente(), "status_demanda"));
    const topico = TOPICOS.find((t) => t.id === "status_demanda");
    assert.equal(resposta.getConteudo(), topico?.respostaProvisoria);
    assert.equal(resposta.getRemetente(), bot);
    assert.equal(resposta.getIntencaoDetectada(), "status_demanda");
  });

  test("responder sem tópico reconhecido oferece o menu e o atendente", () => {
    const resposta = novoBot().responder(doCliente(novoCliente()));
    assert.equal(resposta.getConteudo(), RESPOSTA_SEM_TOPICO);
    assert.equal(resposta.getIntencaoDetectada(), INTENCAO_INDEFINIDA);
  });

  test("responder não entrega ao cliente a resposta de tópico só de administrador", () => {
    const resposta = novoBot().responder(doCliente(novoCliente(), "relatorio_admin"));
    assert.equal(resposta.getConteudo(), RESPOSTA_SEM_TOPICO);
  });

  describe("deveTransferir", () => {
    function conversaCom(intencoesDoCliente: (string | undefined)[], limite = 2): { bot: Chatbot; conversa: Conversa } {
      const bot = novoBot(limite);
      const cliente = novoCliente();
      const conversa = new Conversa(1, "whatsapp", cliente, bot, agora);
      for (const intencao of intencoesDoCliente) {
        const pergunta = doCliente(cliente, intencao);
        conversa.adicionarMensagem(pergunta);
        conversa.adicionarMensagem(bot.responder(pergunta));
      }
      return { bot, conversa };
    }

    test("conversa sem mensagens não transfere", () => {
      const { bot, conversa } = conversaCom([]);
      assert.equal(bot.deveTransferir(conversa), false);
    });

    test("uma falha abaixo do limite (2) não transfere", () => {
      const { bot, conversa } = conversaCom([undefined]);
      assert.equal(bot.deveTransferir(conversa), false);
    });

    test("falhas seguidas iguais ao limite transferem", () => {
      const { bot, conversa } = conversaCom([undefined, undefined]);
      assert.equal(bot.deveTransferir(conversa), true);
    });

    test("um acerto no meio zera a contagem", () => {
      const { bot, conversa } = conversaCom([undefined, "status_demanda", undefined]);
      assert.equal(bot.deveTransferir(conversa), false);
    });

    test("as respostas do próprio bot não contam como falhas do cliente", () => {
      // Cada resposta "não entendi" do bot também tem intenção indefinida.
      const { bot, conversa } = conversaCom([undefined], 2);
      assert.equal(conversa.getHistorico().length, 2);
      assert.equal(bot.deveTransferir(conversa), false);
    });

    test("com limite 1, a primeira falha já transfere", () => {
      const { bot, conversa } = conversaCom([undefined], 1);
      assert.equal(bot.deveTransferir(conversa), true);
    });

    test("conversa que já saiu do bot não transfere de novo", () => {
      const { bot, conversa } = conversaCom([undefined, undefined]);
      conversa.transferirParaHumano();
      assert.equal(conversa.getStatus(), StatusConversa.AGUARDANDO_ATENDENTE);
      assert.equal(bot.deveTransferir(conversa), false);
    });
  });
});
