import assert from "node:assert/strict";
import { test } from "node:test";
import { Atendimento } from "../Atendimento.js";
import type { ClassificadorDeIntencao } from "../ClassificadorDeIntencao.js";
import type { GeradorDeResposta } from "../GeradorDeResposta.js";
import { LimitadorDeTaxa } from "../LimitadorDeTaxa.js";
import { Menu } from "../Menu.js";
import type { EstadoDoMenu, NovoEvento } from "../Repositorios.js";
import { ServicoDeFila } from "../ServicoDeFila.js";
import { topicosDoMenu } from "../Topicos.js";
import { Atendente } from "../entidades/Atendente.js";
import { Conversa } from "../entidades/Conversa.js";
import { MotivoDaTransferencia, PrioridadeTicket, StatusConversa, StatusTicket } from "../entidades/Enums.js";
import { Mensagem } from "../entidades/Mensagem.js";
import { Cliente } from "../entidades/Cliente.js";
import { Chatbot } from "../entidades/Chatbot.js";
import { RepositorioDeFilaEmMemoria } from "../../repositorios/RepositorioDeFilaEmMemoria.js";
import { CanalSimulado } from "./apoio/CanalSimulado.js";

/** Nestes testes ninguém está dentro de um sub-menu com IA, então a escolha por nível não é usada. */
const ESCOLHA_VAZIA = { escolherOpcao: async () => ({ id: null, confianca: 0 }) };
/** Para os testes que garantem que a IA NÃO é consultada. */
const ESCOLHA_PROIBIDA = {
  escolherOpcao: async (): Promise<never> => {
    throw new Error("IA indevida");
  },
};

/** Gerador falso: "nota fiscal" não está no manual; o resto responde ecoando a pergunta e o tamanho do histórico. */
const GERADOR_FALSO: GeradorDeResposta = {
  nome: "gerador-falso",
  gerar: async (pergunta, historico) =>
    pergunta.includes("nota fiscal")
      ? { encontrou: false, texto: "" }
      : { encontrou: true, texto: `resposta para ${pergunta} (histórico ${historico.length})` },
};

function cenario(
  classificador: ClassificadorDeIntencao | null = null,
  gerador: GeradorDeResposta | null = null,
  clienteCustom: Cliente | null = null
) {
  const cliente = clienteCustom ?? new Cliente(1, "Cliente Teste", "cliente@example.com", "5581999999999", "Empresa WXN");
  const bot = new Chatbot("wxn", "Bot", "simples", 2, true);
  const conversa = new Conversa(1, "simulado", cliente, bot);
  const repositorio = new RepositorioDeFilaEmMemoria([], [new Atendente(2, "Operador", "operador@example.com")], [conversa]);
  const fila = new ServicoDeFila(repositorio);
  const canal = new CanalSimulado();
  const eventos: NovoEvento[] = [];
  const entradas = new Map<string, { id: number; processada: boolean; mensagem: Mensagem }>();
  let estado: EstadoDoMenu = { caminho: [], perguntando: false, historico: [], falhasSeguidas: 0, transferenciaPendente: null };
  const atendimento = new Atendimento(canal,
    {
      obterOuCriar: async () => 1,
      obterPorId: async () => ({
        nome: cliente.getNome(),
        empresa: cliente.getEmpresa(),
        telefone: cliente.getTelefone(),
      }),
    }, { obterOuCriarAtual: async () => 1 }, {
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
      obter: async () => estado,
      salvar: async (_id, novo) => { estado = novo; },
      obterEmpresa: async () => cliente.getEmpresa(),
    }, classificador, new Menu(topicosDoMenu()), {
      confiancaMinima: 0.6, limiteDeMensagens: null,
      avisosDeInstabilidade: new LimitadorDeTaxa(1, 60_000), avisosDeExcesso: new LimitadorDeTaxa(1, 60_000),
    }, fila, gerador);
  const enviar = (texto: string, id = `entrada-${entradas.size + 1}`) => atendimento.processar({
    texto, idExterno: id, remetente: "cliente-simulado", enderecoResposta: "endereco-simulado",
  });
  const ultima = () => canal.enviadas[canal.enviadas.length - 1]?.texto ?? "";
  return { atendimento, enviar, fila, conversa, canal, entradas, eventos, repositorio, ultima, estado: () => estado, cliente };
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
  const c = cenario({ nome: "não deve chamar", classificar: async () => { throw new Error("IA indevida"); }, ...ESCOLHA_PROIBIDA });

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
  const c = cenario({ nome: "simulado", classificar: async () => { chamadas++; return { topico: null, confianca: 0 }; }, ...ESCOLHA_VAZIA });
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
  const humano = cenario({ nome: "simulado", classificar: async () => ({ topico: "atendimento_humano", confianca: 0.9 }), ...ESCOLHA_VAZIA });
  await humano.enviar("Preciso conversar com a equipe");
  assert.equal((await humano.fila.listarFila()).length, 1);
  assert.equal(humano.eventos[0].origem, "ia");
  const incerto = cenario({ nome: "simulado", classificar: async () => ({ topico: "atendimento_humano", confianca: 0.2 }), ...ESCOLHA_VAZIA });
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

// ---------- Modo "escreva sua pergunta" (opção "Outra dúvida" do sub-menu "Dúvida sobre como usar o sistema") ----------

test("modo pergunta: entra pela opção, responde com o gerador e sai com 0", async () => {
  const c = cenario(null, GERADOR_FALSO);
  await c.enviar("2");
  await c.enviar("3"); // "Outra dúvida: escrever minha pergunta"
  assert.match(c.ultima(), /dúvida/);
  assert.equal(c.estado().perguntando, true);

  await c.enviar("como cadastro um usuário");
  assert.match(c.ultima(), /resposta para como cadastro um usuário/);
  assert.match(c.ultima(), /digitar 0 para voltar ao menu/);
  assert.equal(c.eventos.at(-1)?.origem, "ia_gerada");
  assert.equal(c.estado().perguntando, true);

  await c.enviar("0");
  assert.match(c.ultima(), /0 - Voltar/); // voltou ao menu do sub-menu
  assert.equal(c.estado().perguntando, false);

  await c.enviar("outra pergunta qualquer"); // já fora do modo: não vai mais ao gerador
  assert.doesNotMatch(c.ultima(), /resposta para/);
});

test("modo pergunta: o manual não cobre, a resposta é a frase fixa e o cliente continua no modo", async () => {
  const c = cenario(null, GERADOR_FALSO);
  await c.enviar("2");
  await c.enviar("3");
  await c.enviar("como emito nota fiscal");
  assert.match(c.ultima(), /Não encontrei essa informação no nosso manual/);
  assert.equal(c.eventos.at(-1)?.origem, "ia_sem_resposta");
  assert.equal(c.estado().perguntando, true);
  assert.equal(c.estado().historico.length, 0);
});

test("modo pergunta: falha do gerador vira frase fixa e o cliente continua no modo", async () => {
  const quebrado: GeradorDeResposta = { nome: "quebrado", gerar: async () => { throw new Error("fora do ar"); } };
  const c = cenario(null, quebrado);
  await c.enviar("2");
  await c.enviar("3");
  await c.enviar("qualquer coisa");
  assert.match(c.ultima(), /Não consegui responder agora/);
  assert.equal(c.eventos.at(-1)?.origem, "ia_gerada_falhou");
  assert.equal(c.estado().perguntando, true);
});

test("modo pergunta: o pedido de atendente no meio do modo abre o ticket e sai do modo", async () => {
  const c = cenario(null, GERADOR_FALSO);
  await c.enviar("2");
  await c.enviar("3");
  await c.enviar("como cadastro um usuário");
  await c.enviar("atendente");
  const [ticket] = await c.fila.listarFila();
  assert.ok(ticket);
  assert.ok(c.ultima().includes(ticket.getProtocolo()));
  assert.equal(c.estado().perguntando, false);
});

test("modo pergunta: o gerador enxerga a pergunta anterior nos seguimentos", async () => {
  const c = cenario(null, GERADOR_FALSO);
  await c.enviar("2");
  await c.enviar("3");
  await c.enviar("como cadastro um usuário");
  assert.match(c.ultima(), /\(histórico 0\)/);
  await c.enviar("e como desativo");
  assert.match(c.ultima(), /\(histórico 1\)/);
});

test("sem gerador, a opção 'Outra dúvida' avisa e não liga o modo", async () => {
  const c = cenario(null, null);
  await c.enviar("2");
  await c.enviar("3");
  assert.match(c.ultima(), /No momento não consigo responder perguntas escritas/);
  assert.equal(c.estado().perguntando, false);
});

// ============================================================================
// HISTÓRIA 2.1 — Transferência para atendimento humano com motivo e dados
// ============================================================================

test("2.1 Cenário 1: pedido explícito cria ticket com motivo PEDIDO_DO_CLIENTE, prioridade MEDIA e dados do cliente", async () => {
  const c = cenario();
  await c.enviar("atendente");
  const [ticket] = await c.fila.listarFila();
  assert.ok(ticket);
  assert.equal(ticket.getMotivo(), MotivoDaTransferencia.PEDIDO_DO_CLIENTE);
  assert.equal(ticket.getPrioridade(), PrioridadeTicket.MEDIA);
  const dados = ticket.getDados();
  assert.equal(dados.clienteNome, "Cliente Teste");
  assert.equal(dados.empresa, "Empresa WXN");
  assert.equal(dados.solicitacaoDireta, true);
});

test("2.1 Cenário 2: pergunta sem resposta oferece confirmação sem abrir ticket antes do sim", async () => {
  const c = cenario(null, GERADOR_FALSO);
  await c.enviar("2");
  await c.enviar("3"); // entra em "Outra dúvida"
  await c.enviar("como emito nota fiscal"); // não coberta pelo manual
  assert.equal((await c.fila.listarFila()).length, 0); // NENHUM ticket criado antes da confirmação
  assert.match(c.ultima(), /Deseja falar com um atendente humano\? Digite Sim ou Não/);
  assert.ok(c.estado().transferenciaPendente);
  assert.equal(c.estado().transferenciaPendente?.motivo, MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA);
});

test("2.1 Cenário 2: confirmação com 'sim' abre ticket com motivo PERGUNTA_SEM_RESPOSTA, prioridade MEDIA e dados contextuais", async () => {
  const c = cenario(null, GERADOR_FALSO);
  await c.enviar("2");
  await c.enviar("3");
  await c.enviar("como emito nota fiscal");
  assert.equal((await c.fila.listarFila()).length, 0);

  await c.enviar("sim");
  const [ticket] = await c.fila.listarFila();
  assert.ok(ticket);
  assert.equal(ticket.getMotivo(), MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA);
  assert.equal(ticket.getPrioridade(), PrioridadeTicket.MEDIA);
  assert.equal(ticket.getAssunto(), "Dúvida sobre como usar o sistema - Pergunta sem resposta");
  const dados = ticket.getDados();
  assert.equal(dados.clienteNome, "Cliente Teste");
  assert.equal(dados.empresa, "Empresa WXN");
  assert.equal(dados.ultimaPergunta, "como emito nota fiscal");
  assert.equal(dados.topico, "operacao_sistema");
  assert.ok(c.ultima().includes(ticket.getProtocolo()));
  assert.equal(c.estado().transferenciaPendente, null);
  assert.equal(c.estado().perguntando, false);
});

test("2.1 Cenário 2: resposta numérica '1' é aceita para confirmar transferência", async () => {
  const c = cenario(null, GERADOR_FALSO);
  await c.enviar("2");
  await c.enviar("3");
  await c.enviar("como emito nota fiscal");
  await c.enviar("1"); // confirmação numérica
  const [ticket] = await c.fila.listarFila();
  assert.ok(ticket);
  assert.equal(ticket.getMotivo(), MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA);
  assert.ok(c.ultima().includes(ticket.getProtocolo()));
});

test("2.1 Cenário 4: recusa de pergunta sem resposta com 'não' ou '2' não cria ticket e volta ao menu", async () => {
  const c = cenario(null, GERADOR_FALSO);
  await c.enviar("2");
  await c.enviar("3");
  await c.enviar("como emito nota fiscal");
  assert.ok(c.estado().transferenciaPendente);

  await c.enviar("não");
  assert.equal((await c.fila.listarFila()).length, 0); // nenhum ticket criado
  assert.equal(c.estado().transferenciaPendente, null);
  assert.equal(c.estado().perguntando, false);
  assert.match(c.ultima(), /Tudo bem! Vamos continuar por aqui/);
  assert.match(c.ultima(), /Digite o número da opção/); // reexibiu o menu principal
});

test("2.1 Cenário 3: uma mensagem não reconhecida não cria ticket e zera falhas em mensagem subsequente válida", async () => {
  const c = cenario();
  await c.enviar("99"); // inválida 1
  assert.equal((await c.fila.listarFila()).length, 0);
  assert.equal(c.estado().falhasSeguidas, 1);
  assert.match(c.ultima(), /Não encontrei essa opção/);

  await c.enviar("2"); // opção válida reconhecida
  assert.equal(c.estado().falhasSeguidas, 0); // zera o contador de falhas
  assert.equal(c.estado().transferenciaPendente, null);
  assert.match(c.ultima(), /Dúvida sobre como usar o sistema/);

  await c.enviar("99"); // inválida novamente, mas é a primeira consecutiva
  assert.equal(c.estado().falhasSeguidas, 1);
  assert.equal((await c.fila.listarFila()).length, 0);
});

test("2.1 Cenário 3: duas mensagens não reconhecidas consecutivas oferecem humano e confirmação abre ticket com FALHAS_SEGUIDAS e prioridade ALTA", async () => {
  const c = cenario();
  await c.enviar("99"); // falha 1
  assert.equal(c.estado().falhasSeguidas, 1);
  assert.equal((await c.fila.listarFila()).length, 0);

  await c.enviar("98"); // falha 2 consecutiva
  assert.equal(c.estado().falhasSeguidas, 2);
  assert.equal((await c.fila.listarFila()).length, 0); // NENHUM ticket criado antes da confirmação
  assert.match(c.ultima(), /Não consegui entender sua solicitação. Deseja falar com um atendente humano\?/);
  assert.ok(c.estado().transferenciaPendente);
  assert.equal(c.estado().transferenciaPendente?.motivo, MotivoDaTransferencia.FALHAS_SEGUIDAS);
  assert.equal(c.estado().transferenciaPendente?.prioridade, PrioridadeTicket.ALTA);

  await c.enviar("sim");
  const [ticket] = await c.fila.listarFila();
  assert.ok(ticket);
  assert.equal(ticket.getMotivo(), MotivoDaTransferencia.FALHAS_SEGUIDAS);
  assert.equal(ticket.getPrioridade(), PrioridadeTicket.ALTA);
  assert.equal(ticket.getAssunto(), "Dificuldade no autoatendimento");
  const dados = ticket.getDados();
  assert.equal(dados.clienteNome, "Cliente Teste");
  assert.equal(dados.empresa, "Empresa WXN");
  assert.equal(dados.falhasConsecutivas, 2);
  assert.equal(dados.ultimaTentativa, "98");
  assert.equal(c.estado().falhasSeguidas, 0);
  assert.equal(c.estado().transferenciaPendente, null);
});

test("2.1 Cenário 3: falha técnica da IA (ia_falhou) não incrementa o contador de falhas consecutivas", async () => {
  const quebrado: ClassificadorDeIntencao = {
    nome: "quebrado",
    classificar: async () => { throw new Error("timeout api"); },
    escolherOpcao: async () => { throw new Error("timeout api"); },
  };
  const c = cenario(quebrado);
  await c.enviar("algum texto"); // ia_falhou
  assert.equal(c.estado().falhasSeguidas, 0); // NÃO incrementou falhas
  assert.equal((await c.fila.listarFila()).length, 0);
  assert.equal(c.estado().transferenciaPendente, null);
});

test("2.1 Cenário 4: recusa após duas falhas seguidas cancela oferta, zera falhas e exibe menu", async () => {
  const c = cenario();
  await c.enviar("99");
  await c.enviar("98"); // 2ª falha
  assert.ok(c.estado().transferenciaPendente);

  await c.enviar("não");
  assert.equal((await c.fila.listarFila()).length, 0);
  assert.equal(c.estado().falhasSeguidas, 0);
  assert.equal(c.estado().transferenciaPendente, null);
  assert.match(c.ultima(), /Tudo bem! Vamos continuar por aqui/);
});

test("2.1: resposta ambígua durante confirmação reforça a pergunta sem abrir ticket e aceita confirmação posterior", async () => {
  const c = cenario();
  await c.enviar("99");
  await c.enviar("98");
  assert.ok(c.estado().transferenciaPendente);

  await c.enviar("quanto custa?"); // resposta ambígua
  assert.equal((await c.fila.listarFila()).length, 0);
  assert.ok(c.estado().transferenciaPendente); // pendência permanece ativa
  assert.match(c.ultima(), /Por favor, responda apenas Sim ou Não/);

  await c.enviar("sim"); // agora confirma
  const [ticket] = await c.fila.listarFila();
  assert.ok(ticket);
  assert.equal(ticket.getMotivo(), MotivoDaTransferencia.FALHAS_SEGUIDAS);
  assert.ok(c.ultima().includes(ticket.getProtocolo()));
});

test("2.1 Cenário 5: nova tentativa de transferência com ticket já aberto reutiliza mesmo ticket e protocolo", async () => {
  const c = cenario();
  await c.enviar("3"); // abre ticket PEDIDO_DO_CLIENTE
  const [ticket1] = await c.fila.listarFila();
  assert.ok(ticket1);

  await c.enviar("atendente"); // nova solicitação na mesma conversa
  const tickets = await c.fila.listarFila();
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].getProtocolo(), ticket1.getProtocolo());
  assert.equal(tickets[0].getMotivo(), MotivoDaTransferencia.PEDIDO_DO_CLIENTE);
  assert.ok(c.ultima().includes(ticket1.getProtocolo()));
});

test("2.1: confirmações simultâneas ou concorrentes reutilizam o mesmo ticket sem duplicidade", async () => {
  const c = cenario();
  await c.enviar("99");
  await c.enviar("98");
  assert.ok(c.estado().transferenciaPendente);

  await Promise.all([c.enviar("sim", "sim-1"), c.enviar("sim", "sim-2")]);
  const tickets = await c.fila.listarFila();
  assert.equal(tickets.length, 1);
  assert.ok(c.canal.enviadas.some((m) => m.texto.includes(tickets[0].getProtocolo())));
});

test("2.1: falha antes de salvar estado (ticket já criado na fila) recupera o mesmo ticket na confirmação", async () => {
  const c = cenario();
  await c.enviar("99");
  await c.enviar("98");
  assert.ok(c.estado().transferenciaPendente);

  // Simula que o ticket já foi criado no banco/fila em tentativa anterior
  const ticketCriado = await c.fila.solicitarAtendimentoHumano(1, {
    assunto: "Dificuldade no autoatendimento",
    prioridade: PrioridadeTicket.ALTA,
    motivo: MotivoDaTransferencia.FALHAS_SEGUIDAS,
    dados: { teste: true },
  });

  await c.enviar("sim"); // cliente confirma novamente
  const tickets = await c.fila.listarFila();
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].getProtocolo(), ticketCriado.getProtocolo());
  assert.ok(c.ultima().includes(ticketCriado.getProtocolo()));
  assert.equal(c.estado().transferenciaPendente, null);
});