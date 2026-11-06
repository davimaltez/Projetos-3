import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { test } from "node:test";
import pg from "pg";
import { Atendimento } from "../../nucleo/Atendimento.js";
import { LimitadorDeTaxa } from "../../nucleo/LimitadorDeTaxa.js";
import { Menu } from "../../nucleo/Menu.js";
import { ServicoDeFila } from "../../nucleo/ServicoDeFila.js";
import { topicosDoMenu } from "../../nucleo/Topicos.js";
import { Atendente } from "../../nucleo/entidades/Atendente.js";
import { MotivoDaTransferencia, PrioridadeTicket, StatusConversa, StatusTicket } from "../../nucleo/entidades/Enums.js";
import type { PedidoDeAtendimento } from "../../nucleo/PedidoDeAtendimento.js";
import { CanalSimulado } from "../../nucleo/tests/apoio/CanalSimulado.js";
import { AutenticadorDeOperador } from "../../http/AutenticadorDeOperador.js";
import { ServidorHttp } from "../../http/ServidorHttp.js";
import { ClienteRepositorio } from "../ClienteRepositorio.js";
import { ConversaRepositorio } from "../ConversaRepositorio.js";
import { ContextoMenuRepositorio } from "../ContextoMenuRepositorio.js";
import { EventoRepositorio } from "../EventoRepositorio.js";
import { MensagemRepositorio } from "../MensagemRepositorio.js";
import { AtendenteRepositorio } from "../AtendenteRepositorio.js";
import { RepositorioDeFilaPg } from "../RepositorioDeFilaPg.js";

// Opt-in explícito. Não carrega .env nem usa DATABASE_URL ou sessão de WhatsApp.
const url = process.env.FILA_TEST_DATABASE_URL;
test("integração da fila em PostgreSQL isolado", { skip: !url }, async (t) => {
  const schema = `teste_fila_${randomUUID().replaceAll("-", "")}`;
  const administrador = new pg.Pool({ connectionString: url });
  await administrador.query(`CREATE SCHEMA ${schema}`);
  const opcoes = { connectionString: url, options: `-c search_path=${schema}`, max: 5 };
  const pool = new pg.Pool(opcoes);
  let outroPool: pg.Pool | undefined;
  let http: ServidorHttp | undefined;
  t.after(async () => {
    await http?.encerrar();
    await outroPool?.end();
    await pool.end();
    await administrador.query(`DROP SCHEMA ${schema} CASCADE`);
    await administrador.end();
  });
  const sql = await readFile(new URL("../../../db/schema.sql", import.meta.url), "utf8");
  let conversaId = 0;
  let protocolo = "";
  const clientes = new ClienteRepositorio(pool);
  const conversas = new ConversaRepositorio(pool);
  const mensagens = new MensagemRepositorio(pool);
  const fila = new ServicoDeFila(new RepositorioDeFilaPg(pool));
  const canal = new CanalSimulado();
  const atendimento = new Atendimento(canal, clientes, conversas, mensagens, new EventoRepositorio(pool),
    new ContextoMenuRepositorio(pool), null, new Menu(topicosDoMenu()), {
      confiancaMinima: 0.6, limiteDeMensagens: null,
      avisosDeExcesso: new LimitadorDeTaxa(1, 60_000), avisosDeInstabilidade: new LimitadorDeTaxa(1, 60_000),
    }, fila);
  const enviar = (texto: string, idExterno: string) => atendimento.processar({
    remetente: "cliente-de-integracao", enderecoResposta: "endereco-simulado", texto, idExterno,
  });

  await t.test("schema atualiza uma instalação anterior e pode ser reaplicado sem perder dados", async () => {
    await pool.query(sql.split("-- Etapa 3:")[0].replace(/,\s*-- Conversa.dataCriacao[\s\S]*?criado_em TIMESTAMPTZ NOT NULL DEFAULT now\(\)/, ""));
    const clienteId = await clientes.obterOuCriar("cliente-de-integracao", "simulado");
    conversaId = await conversas.obterOuCriarAtual(clienteId);
    await mensagens.registrarEntrada(conversaId, "antiga", "Mensagem anterior à migração");
    const urlMigracao = new URL(url!);
    urlMigracao.searchParams.set("options", `-c search_path=${schema}`);
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const resultado = await promisify(execFile)(process.execPath,
        ["--import", "tsx", "src/scripts/migrarBanco.ts"], {
          env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: "/dev/null", DATABASE_URL: urlMigracao.toString() },
        });
      assert.match(resultado.stdout, /dados existentes preservados/);
    }
    assert.equal((await pool.query("SELECT texto FROM mensagens WHERE wamid = 'antiga'")).rows[0].texto,
      "Mensagem anterior à migração");
  });

  await t.test("primeiras mensagens concorrentes compartilham uma única conversa", async () => {
    const clienteId = await clientes.obterOuCriar("outro-cliente", "simulado");
    const ids = await Promise.all([conversas.obterOuCriarAtual(clienteId), new ConversaRepositorio(pool).obterOuCriarAtual(clienteId)]);
    assert.equal(ids[0], ids[1]);
    assert.equal((await pool.query("SELECT count(*)::int AS total FROM conversas WHERE cliente_id = $1", [clienteId])).rows[0].total, 1);
  });

  await t.test("bot real com canal simulado cria ticket consultável e mantém histórico anterior", async () => {
    await enviar("oi", "oi");
    await enviar("3", "pedido");
    const [ticket] = await fila.listarFila();
    assert.ok(ticket);
    protocolo = ticket.getProtocolo();
    assert.equal(ticket.getConversa().getId(), String(conversaId));
    assert.equal(ticket.getConversa().getStatus(), StatusConversa.AGUARDANDO_ATENDENTE);
    assert.ok(canal.enviadas.at(-1)?.texto.includes(protocolo));
    const historico = await fila.obterHistoricoDoTicket(protocolo);
    assert.equal(historico[0].getTexto(), "Mensagem anterior à migração");
    const pedido = historico.find((m) => m.getTexto() === "3")!;
    assert.equal(pedido.getIntencaoDetectada(), "atendimento_humano");
    assert.equal(pedido.getRemetente().getIdentificacao(), "cliente:1");
  });

  await t.test("reprocessamento e duas instâncias enfileirando preservam protocolo e evento único", async () => {
    const resultados = await Promise.all([
      fila.solicitarAtendimentoHumano(conversaId),
      new ServicoDeFila(new RepositorioDeFilaPg(pool)).solicitarAtendimentoHumano(conversaId),
    ]);
    assert.ok(resultados.every((ticket) => ticket.getProtocolo() === protocolo));
    await enviar("3", "pedido");
    assert.equal(canal.enviadas.length, 2);
    assert.equal((await pool.query("SELECT count(*)::int AS total FROM tickets")).rows[0].total, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS total FROM eventos WHERE tipo = 'transferencia_humana'")).rows[0].total, 1);
  });

  const tokens = ["credencial-de-teste-operador-um-123456789", "credencial-de-teste-operador-dois-123456789"];
  let base = "";
  let vencedor = 0;
  await t.test("nova instância lê a fila persistida e HTTP permite apenas uma assunção concorrente", async () => {
    outroPool = new pg.Pool(opcoes);
    const novaFila = new ServicoDeFila(new RepositorioDeFilaPg(outroPool));
    assert.equal((await novaFila.listarFila())[0].getProtocolo(), protocolo);
    await new AtendenteRepositorio(pool).cadastrar(tokens.map((_token, i) => new Atendente(i + 1, `Operador ${i + 1}`, `operador${i + 1}@example.com`)));
    http = new ServidorHttp(0, "127.0.0.1", canal, { verificar: async () => true }, false, novaFila,
      new AutenticadorDeOperador(JSON.stringify(tokens.map((token, i) => ({ id: i + 1,
        nome: `Operador ${i + 1}`, email: `operador${i + 1}@example.com`, token })))));
    await http.iniciar();
    base = `http://127.0.0.1:${http.portaEmUso}`;
    const disputas = await Promise.all(tokens.map((token) => fetch(`${base}/tickets/${protocolo}/assumir`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    })));
    assert.deepEqual(disputas.map((r) => r.status).sort(), [200, 409]);
    vencedor = disputas.findIndex((r) => r.status === 200) + 1;
    const ticket = await new RepositorioDeFilaPg(outroPool).buscarPorId(protocolo);
    assert.equal(ticket?.getAtendente()?.getId(), String(vencedor));
    assert.equal(ticket?.getStatus(), StatusTicket.EM_ATENDIMENTO);
    assert.equal(ticket?.getConversa().getStatus(), StatusConversa.EM_ATENDIMENTO);
    assert.deepEqual(await novaFila.listarFila(), []);
  });

  await t.test("após assunção, entradas seguem no histórico HTTP sem o bot responder", async () => {
    await enviar("Mais detalhes após a transferência", "detalhes");
    assert.equal(canal.enviadas.length, 2);
    const historico = await (await fetch(`${base}/tickets/${protocolo}/historico`, {
      headers: { Authorization: `Bearer ${tokens[vencedor - 1]}` },
    })).json();
    assert.ok(Array.isArray(historico));
    assert.equal(historico.at(-1).conteudo, "Mais detalhes após a transferência");
    assert.equal((await pool.query("SELECT processado FROM mensagens WHERE wamid = 'detalhes'")).rows[0].processado, true);
  });

  await t.test("falha ao registrar evento desfaz criação e estado da conversa", async () => {
    const clienteId = await clientes.obterOuCriar("cliente-rollback", "simulado");
    const id = await conversas.obterOuCriarAtual(clienteId);
    await pool.query(`CREATE FUNCTION falhar_evento() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falha simulada de auditoria'; END $$;
      CREATE TRIGGER falha_evento BEFORE INSERT ON eventos FOR EACH ROW EXECUTE FUNCTION falhar_evento()`);
    try {
      await assert.rejects(fila.solicitarAtendimentoHumano(id), /falha simulada de auditoria/);
      assert.equal(await fila.obterAtendimentoHumano(id), null);
      assert.equal((await pool.query("SELECT estado FROM conversas WHERE id = $1", [id])).rows[0].estado, "BOT");
    } finally { await pool.query("DROP TRIGGER falha_evento ON eventos; DROP FUNCTION falhar_evento()"); }
  });

  await t.test("falha na auditoria de assunção desfaz responsável e estado", async () => {
    const clienteId = await clientes.obterOuCriar("cliente-rollback-assuncao", "simulado");
    const id = await conversas.obterOuCriarAtual(clienteId);
    const ticket = await fila.solicitarAtendimentoHumano(id);
    await pool.query(`CREATE FUNCTION falhar_evento() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falha simulada de auditoria'; END $$;
      CREATE TRIGGER falha_evento BEFORE INSERT ON eventos FOR EACH ROW EXECUTE FUNCTION falhar_evento()`);
    await new AtendenteRepositorio(pool).cadastrar([new Atendente(20, "Teste", "teste@example.com")]);
    try {
      await assert.rejects(fila.assumirTicket(ticket.getProtocolo(), new Atendente(20, "Teste", "teste@example.com")),
        /falha simulada de auditoria/);
      const salvo = await new RepositorioDeFilaPg(pool).buscarPorId(ticket.getProtocolo());
      assert.equal(salvo?.getStatus(), StatusTicket.AGUARDANDO);
      assert.equal(salvo?.getAtendente(), null);
      assert.equal(salvo?.getConversa().getStatus(), StatusConversa.AGUARDANDO_ATENDENTE);
      assert.equal((await pool.query("SELECT count(*)::int AS total FROM atendentes WHERE id = 20")).rows[0].total, 1);
    } finally { await pool.query("DROP TRIGGER falha_evento ON eventos; DROP FUNCTION falhar_evento()"); }
  });

  await t.test("ticket encerrado preserva datas e responsável e continua com histórico consultável", async () => {
    const data = new Date("2026-11-04T18:00:00Z");
    await pool.query("UPDATE tickets SET status = 'ENCERRADO', data_fechamento = $2 WHERE id = $1", [protocolo, data]);
    const repositorio = new RepositorioDeFilaPg(pool);
    await assert.rejects(repositorio.atribuirAtendente(protocolo, "10"), /não está mais aguardando/);
    const fechado = await repositorio.buscarPorId(protocolo);
    assert.equal(fechado?.getAtendente()?.getId(), String(vencedor));
    assert.deepEqual(fechado?.getDataFechamento(), data);
    assert.ok((await fila.obterHistoricoDoTicket(protocolo)).length > 0);
  });

  await t.test("pedidos concorrentes criam um único ticket e um único evento de transferência", async () => {
    const clienteId = await clientes.obterOuCriar("cliente-criacao-concorrente", "simulado");
    const id = await conversas.obterOuCriarAtual(clienteId);
    const outraFila = new ServicoDeFila(new RepositorioDeFilaPg(outroPool!));
    const tickets = await Promise.all([fila.solicitarAtendimentoHumano(id), outraFila.solicitarAtendimentoHumano(id)]);
    assert.equal(tickets[0].getId(), tickets[1].getId());
    assert.equal((await pool.query("SELECT count(*)::int AS total FROM tickets WHERE conversa_id = $1", [id])).rows[0].total, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS total FROM eventos WHERE conversa_id = $1 AND tipo = 'transferencia_humana'", [id])).rows[0].total, 1);
  });

  await t.test("cliente retorna após encerramento com uma conversa nova sem perder o histórico antigo", async () => {
    const { rows } = await pool.query<{ cliente_id: number }>("UPDATE conversas SET estado = 'ENCERRADA' WHERE id = $1 RETURNING cliente_id", [conversaId]);
    const novosIds = await Promise.all([conversas.obterOuCriarAtual(rows[0].cliente_id), conversas.obterOuCriarAtual(rows[0].cliente_id)]);
    assert.notEqual(novosIds[0], conversaId);
    assert.equal(novosIds[0], novosIds[1]);
    assert.ok((await fila.obterHistoricoDoTicket(protocolo)).length > 0);
  });

    // ---------- História 2.1: assunto, prioridade, motivo e dados do ticket ----------

  const novaConversa = async (nome: string) => conversas.obterOuCriarAtual(await clientes.obterOuCriar(nome, "simulado"));
  const pedidoDe = (motivo: MotivoDaTransferencia, prioridade: PrioridadeTicket): PedidoDeAtendimento => ({
    assunto: `Assunto de ${motivo}`,
    prioridade,
    motivo,
    dados: { topico: "operacao_sistema", ultimaPergunta: `pergunta de ${motivo}`, tentativas: 2 },
  });

  await t.test("2.1: o ticket guarda assunto, prioridade, motivo e dados de cada motivo, e o evento registra o motivo", async () => {
    for (const motivo of Object.values(MotivoDaTransferencia)) {
      const id = await novaConversa(`cliente-motivo-${motivo}`);
      const prioridade = motivo === MotivoDaTransferencia.DEMANDA_NAO_ENCONTRADA ? PrioridadeTicket.ALTA : PrioridadeTicket.MEDIA;
      const pedido = pedidoDe(motivo, prioridade);

      const criado = await fila.solicitarAtendimentoHumano(id, pedido);
      assert.equal(criado.getMotivo(), motivo);
      assert.equal(criado.getAssunto(), pedido.assunto);
      assert.equal(criado.getPrioridade(), prioridade);
      assert.deepEqual(criado.getDados(), pedido.dados);

      // Lido de novo do banco, por outra instância do repositório.
      const salvo = await new RepositorioDeFilaPg(pool).buscarPorId(criado.getProtocolo());
      assert.equal(salvo?.getMotivo(), motivo);
      assert.equal(salvo?.getAssunto(), pedido.assunto);
      assert.equal(salvo?.getPrioridade(), prioridade);
      assert.deepEqual(salvo?.getDados(), pedido.dados);

      // E na própria tabela.
      const linha = (await pool.query("SELECT motivo, assunto, prioridade, dados FROM tickets WHERE id = $1",
        [criado.getProtocolo()])).rows[0];
      assert.equal(linha.motivo, motivo);
      assert.equal(linha.assunto, pedido.assunto);
      assert.equal(linha.prioridade, prioridade);
      assert.deepEqual(linha.dados, pedido.dados);

      const eventos = (await pool.query("SELECT dados FROM eventos WHERE conversa_id = $1 AND tipo = 'transferencia_humana'", [id])).rows;
      assert.equal(eventos.length, 1);
      assert.equal(eventos[0].dados.motivo, motivo);
      assert.equal(eventos[0].dados.prioridade, prioridade);
      assert.equal(eventos[0].dados.protocolo, criado.getProtocolo());
    }
  });

  await t.test("2.1: sem pedido, o ticket é o pedido explícito de antes", async () => {
    const id = await novaConversa("cliente-pedido-padrao");
    const ticket = await fila.solicitarAtendimentoHumano(id);
    assert.equal(ticket.getAssunto(), "Atendimento humano");
    assert.equal(ticket.getPrioridade(), PrioridadeTicket.MEDIA);
    assert.equal(ticket.getMotivo(), MotivoDaTransferencia.PEDIDO_DO_CLIENTE);
    assert.deepEqual(ticket.getDados(), {});
  });

  await t.test("2.1: ticket gravado sem motivo, como os anteriores à migração, vale como pedido do cliente", async () => {
    const id = await novaConversa("cliente-ticket-antigo");
    const antigo = randomUUID();
    // Insert do jeito antigo: sem motivo e sem dados, para usar os valores padrão da migração.
    await pool.query(`INSERT INTO tickets (id, conversa_id, assunto, prioridade, data_abertura, resumo_bot)
      VALUES ($1, $2, 'Atendimento humano', 'MEDIA', now(), '')`, [antigo, id]);
    const lido = await new RepositorioDeFilaPg(pool).buscarPorId(antigo);
    assert.equal(lido?.getMotivo(), MotivoDaTransferencia.PEDIDO_DO_CLIENTE);
    assert.deepEqual(lido?.getDados(), {});
  });

  await t.test("2.1: um segundo pedido na mesma conversa devolve o mesmo ticket e não muda motivo nem prioridade", async () => {
    const id = await novaConversa("cliente-segundo-pedido");
    const primeiro = await fila.solicitarAtendimentoHumano(id, pedidoDe(MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA, PrioridadeTicket.MEDIA));
    const segundo = await fila.solicitarAtendimentoHumano(id, pedidoDe(MotivoDaTransferencia.FALHAS_SEGUIDAS, PrioridadeTicket.ALTA));
    assert.equal(segundo.getProtocolo(), primeiro.getProtocolo());
    assert.equal(segundo.getMotivo(), MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA);
    assert.equal(segundo.getPrioridade(), PrioridadeTicket.MEDIA);
    assert.equal((await pool.query("SELECT count(*)::int AS total FROM tickets WHERE conversa_id = $1", [id])).rows[0].total, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS total FROM eventos WHERE conversa_id = $1 AND tipo = 'transferencia_humana'", [id])).rows[0].total, 1);
  });

  await t.test("2.1: a fila sai ordenada pela prioridade de verdade e, dentro dela, por quem espera há mais tempo", async () => {
    // Criados nesta ordem: o de prioridade ALTA é o mais novo e mesmo assim deve vir primeiro.
    const sequencia: Array<[string, PrioridadeTicket]> = [
      ["baixa", PrioridadeTicket.BAIXA],
      ["media-antiga", PrioridadeTicket.MEDIA],
      ["alta", PrioridadeTicket.ALTA],
      ["media-recente", PrioridadeTicket.MEDIA],
    ];
    const protocolos: Record<string, string> = {};
    for (const [nome, prioridade] of sequencia) {
      const id = await novaConversa(`cliente-ordem-${nome}`);
      const ticket = await fila.solicitarAtendimentoHumano(id, pedidoDe(MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA, prioridade));
      protocolos[nome] = ticket.getProtocolo();
    }
    const esperado = [protocolos["alta"], protocolos["media-antiga"], protocolos["media-recente"], protocolos["baixa"]];
    // A fila tem tickets de outros subtestes: olha só para os criados aqui.
    const nossos = new Set(esperado);

    // Direto do banco (a ordenação do SQL) e pelo serviço (que ordena de novo).
    const doBanco = (await new RepositorioDeFilaPg(pool).listarAguardando()).map((x) => x.getProtocolo()).filter((p) => nossos.has(p));
    const doServico = (await fila.listarFila()).map((x) => x.getProtocolo()).filter((p) => nossos.has(p));
    assert.deepEqual(doBanco, esperado);
    assert.deepEqual(doServico, esperado);
  });

  await t.test("2.1: pedido inválido é recusado antes do banco, sem ticket nem evento", async () => {
    const id = await novaConversa("cliente-pedido-invalido");
    const invalido = { ...pedidoDe(MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA, PrioridadeTicket.MEDIA), assunto: "   " };
    await assert.rejects(fila.solicitarAtendimentoHumano(id, invalido), /assunto/);
    assert.equal(await fila.obterAtendimentoHumano(id), null);
    assert.equal((await pool.query("SELECT count(*)::int AS total FROM eventos WHERE conversa_id = $1 AND tipo = 'transferencia_humana'", [id])).rows[0].total, 0);
  });
});
