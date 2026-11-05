import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { setTimeout as aguardar } from "node:timers/promises";
import pg from "pg";
import { Atendente } from "../../nucleo/entidades/Atendente.js";
import { Prioridade, StatusConversa, StatusTicket, TipoRemetente } from "../../nucleo/entidades/Enums.js";
import { Ticket } from "../../nucleo/entidades/Ticket.js";
import { Mensagem } from "../../nucleo/entidades/Mensagem.js";
import { Conversa } from "../../nucleo/entidades/Conversa.js";
import { ServicoDeFila, TicketIndisponivelError, TicketNaoEncontradoError } from "../../nucleo/ServicoDeFila.js";
import { RepositorioDeFilaPg, AtendenteNaoCadastradoError } from "../RepositorioDeFilaPg.js";

const habilitado = process.env.FILA_PG_TEST === "1";
const abertura = new Date("2026-01-01T10:00:00.123Z");
const fechamento = new Date("2026-01-01T11:00:00.456Z");
const ana = new Atendente(101, "Ana", "ana@example.test");
const bruno = new Atendente(102, "Bruno", "bruno@example.test");
const temCodigo = (codigo: string) => (erro: unknown) =>
  erro instanceof Error && "code" in erro && erro.code === codigo;

describe("RepositorioDeFilaPg — PostgreSQL isolado", { skip: !habilitado, concurrency: false }, () => {
  let controle: pg.Pool;
  let poolA: pg.Pool;
  let poolB: pg.Pool;
  let repositorio: RepositorioDeFilaPg;
  let schema: string;
  let schemaCriado = false;
  let definicao: string;
  let conexao: pg.PoolConfig;

  before(async () => {
    const database = process.env.FILA_PG_TEST_DATABASE;
    if (database !== "wxn_fila_teste") {
      throw new Error("Integração exige FILA_PG_TEST_DATABASE=wxn_fila_teste; nenhum outro banco é permitido.");
    }
    conexao = {
      database,
      host: process.env.FILA_PG_TEST_HOST ?? "127.0.0.1",
      port: Number(process.env.FILA_PG_TEST_PORT ?? 5432),
      user: process.env.FILA_PG_TEST_USER,
      password: process.env.FILA_PG_TEST_PASSWORD,
      ssl: false,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      max: 1,
    };
    controle = new pg.Pool(conexao);
    const alvo = await controle.query<{ banco: string }>("SELECT current_database() AS banco");
    assert.equal(alvo.rows[0].banco, "wxn_fila_teste");
    definicao = await readFile(new URL("../../../db/schema.sql", import.meta.url), "utf8");
  });

  beforeEach(async () => {
    schema = "fila_pg_test_" + randomUUID().replaceAll("-", "");
    assert.match(schema, /^fila_pg_test_[a-f0-9]{32}$/);
    await controle.query(`CREATE SCHEMA "${schema}"`);
    schemaCriado = true;
    poolA = new pg.Pool({ ...conexao, options: `-c search_path=${schema},pg_catalog`, application_name: schema + "_a" });
    poolB = new pg.Pool({ ...conexao, options: `-c search_path=${schema},pg_catalog`, application_name: schema + "_b" });
    // Só muda o destino do bootstrap na memória: nenhum arquivo ou tabela public é alterado.
    const marcador = "SET LOCAL search_path = public, pg_catalog;";
    assert.equal(definicao.split(marcador).length, 2);
    await poolA.query(definicao.replace(marcador, `SET LOCAL search_path = "${schema}", pg_catalog;`));
    repositorio = new RepositorioDeFilaPg(poolA);
  });

  afterEach(async () => {
    await Promise.all([poolA?.end(), poolB?.end()]);
    if (schemaCriado) {
      assert.match(schema, /^fila_pg_test_[a-f0-9]{32}$/);
      await controle.query(`DROP SCHEMA "${schema}" CASCADE`);
      schemaCriado = false;
    }
  });
  after(async () => { await controle?.end(); });

  async function cadastrar(a: Atendente): Promise<void> {
    await poolA.query("INSERT INTO atendentes (id, nome, email) VALUES ($1, $2, $3)",
      [a.getId(), a.getNome(), a.getEmail()]);
  }

  async function criarTicket(protocolo: string, opcoes: {
    prioridade?: Prioridade; status?: StatusTicket; atendenteId?: number | string;
    dataAbertura?: Date; dataFechamento?: Date; estado?: string; nome?: string;
  } = {}): Promise<number> {
    const cliente = await poolA.query<{ id: number }>(
      "INSERT INTO clientes (telefone, nome) VALUES ($1, $2) RETURNING id",
      [randomUUID(), opcoes.nome ?? null]
    );
    const conversa = await poolA.query<{ id: number }>(
      "INSERT INTO conversas (cliente_id, estado) VALUES ($1, $2) RETURNING id",
      [cliente.rows[0].id, opcoes.estado ?? "BOT"]
    );
    const id = conversa.rows[0].id;
    await poolA.query(
      `INSERT INTO tickets (id, conversa_id, assunto, prioridade, status,
         data_abertura, data_fechamento, resumo_bot, atendente_id)
       VALUES ($1, $2, 'Suporte', $3, $4, $5, $6, 'Resumo persistido', $7)`,
      [protocolo, id, opcoes.prioridade ?? Prioridade.MEDIA, opcoes.status ?? StatusTicket.AGUARDANDO,
        opcoes.dataAbertura ?? abertura, opcoes.dataFechamento ?? null, opcoes.atendenteId ?? null]
    );
    return id;
  }

  test("lista vazia e protocolo inexistente", async () => {
    assert.deepEqual(await repositorio.listarAguardando(), []);
    assert.equal(await repositorio.buscarPorId("ausente"), null);
    assert.deepEqual(await new ServicoDeFila(repositorio).listarFila(), []);
    await assert.rejects(repositorio.atribuirAtendente("ausente", ana.getId()), TicketNaoEncontradoError);
  });

  test("reconstitui todos os estados, prioridades e datas sem depender da instância", async () => {
    await cadastrar(ana);
    await criarTicket("aguardando", { prioridade: Prioridade.BAIXA });
    await criarTicket("em-atendimento", { prioridade: Prioridade.ALTA, status: StatusTicket.EM_ATENDIMENTO, atendenteId: ana.getId() });
    await criarTicket("encerrado", { status: StatusTicket.ENCERRADO, atendenteId: ana.getId(), dataFechamento: fechamento });
    // listarAguardando traz só a fila; os outros estados são lidos por id.
    assert.deepEqual((await repositorio.listarAguardando()).map(t => t.getId()), ["aguardando"]);
    const todos = await Promise.all(["aguardando", "em-atendimento", "encerrado"].map(async (id) => {
      const ticket = await repositorio.buscarPorId(id);
      assert.ok(ticket);
      return ticket;
    }));
    assert.deepEqual(todos.map(t => t.getStatus()).sort(), Object.values(StatusTicket).sort());
    for (const ticket of todos) {
      assert.ok(ticket instanceof Ticket);
      assert.ok(ticket.getConversa() instanceof Conversa);
      assert.deepEqual(ticket.getDataAbertura(), abertura);
      assert.equal(ticket.getAssunto(), "Suporte");
      assert.equal(ticket.getResumoBot(), "Resumo persistido");
    }
    const encerrado = await new RepositorioDeFilaPg(poolB).buscarPorId("encerrado");
    assert.ok(encerrado);
    assert.equal(encerrado.getStatus(), StatusTicket.ENCERRADO);
    assert.deepEqual(encerrado.getDataFechamento(), fechamento);
    assert.equal(encerrado.getAtendente()?.getEmail(), ana.getEmail());
    assert.equal((await repositorio.buscarPorId("aguardando"))?.getAtendente(), null);
    assert.equal((await repositorio.buscarPorId("em-atendimento"))?.getPrioridade(), Prioridade.ALTA);
  });

  test("protocolo é texto parametrizado, inclusive aspas e SQL", async () => {
    const protocolo = "'; SELECT 1; --";
    await criarTicket(protocolo);
    assert.equal((await repositorio.buscarPorId(protocolo))?.getProtocolo(), protocolo);
    assert.equal(await repositorio.buscarPorId("' OR true --"), null);
    assert.equal((await repositorio.listarAguardando()).length, 1);
  });

  test("dados históricos ausentes e estado desconhecido permanecem explícitos", async () => {
    const id = await criarTicket("legado", { estado: "ESTADO_LEGADO" });
    await poolA.query("INSERT INTO mensagens (conversa_id, direcao, texto) VALUES ($1, 'saida', NULL)", [id]);
    const ticket = await repositorio.buscarPorId("legado");
    assert.ok(ticket);
    const conversa = ticket.getConversa();
    // conversas.criado_em tem default: a data de criação sempre existe.
    assert.ok(conversa.getDataCriacao() instanceof Date);
    assert.equal(conversa.getDataFim(), null);
    assert.equal(conversa.getCanal(), null);
    assert.equal(conversa.getChatbot(), null);
    assert.equal(conversa.getStatus(), null);
    assert.equal(conversa.getEstadoPersistido(), "ESTADO_LEGADO");
    // Cliente sem nome é apresentado pelo telefone (Remetente.getNome(): string).
    assert.equal(conversa.getCliente().getNome(), conversa.getCliente().getTelefone());
    assert.equal(conversa.getCliente().getEmail(), null);
    const mensagem = conversa.getHistorico()[0];
    assert.equal(mensagem.getTexto(), "");
    assert.equal(mensagem.getRemetente().getTipo(), TipoRemetente.CHATBOT);
    assert.equal(mensagem.isProcessado(), false);
    assert.equal(mensagem.getIntencaoDetectada(), null);
    assert.equal(mensagem.getDirecao(), "saida");
    assert.equal(conversa.transferirParaHumano(), ticket);
  });

  test("histórico completo ordena por data/id e preserva a classificação realmente disponível", async () => {
    await cadastrar(ana);
    const conversaId = await criarTicket("historico", {
      nome: "Cliente", status: StatusTicket.ENCERRADO, atendenteId: ana.getId(),
      dataFechamento: fechamento, estado: "ENCERRADA",
    });
    const outroId = await criarTicket("outra");
    const posterior = await poolA.query<{ id: number }>(
      "INSERT INTO mensagens (conversa_id, direcao, texto, criado_em, processado) VALUES ($1, 'saida', 'Posterior', $2, true) RETURNING id",
      [conversaId, fechamento]);
    const entrada = await poolA.query<{ id: number }>(
      "INSERT INTO mensagens (conversa_id, direcao, texto, criado_em) VALUES ($1, 'entrada', 'Pergunta', '2025-12-31T10:00:00Z') RETURNING id",
      [conversaId]);
    const empate = await poolA.query<{ id: number }>(
      "INSERT INTO mensagens (conversa_id, direcao, texto, criado_em) VALUES ($1, 'saida', '', '2025-12-31T10:00:00Z') RETURNING id",
      [conversaId]);
    await poolA.query("INSERT INTO mensagens (conversa_id, direcao, texto) VALUES ($1, 'entrada', 'Outra conversa')", [outroId]);
    for (const intencao of ["anterior", "atual"]) {
      await poolA.query(
        "INSERT INTO eventos (conversa_id, tipo, intencao, dados, criado_em) VALUES ($1, 'resposta', $2, $3, $4)",
        [conversaId, intencao, JSON.stringify({ mensagemId: entrada.rows[0].id }), abertura]);
    }
    // IDs iguais em eventos de outra conversa, eventos sintéticos e JSON não numérico não contaminam.
    await poolA.query(
      "INSERT INTO eventos (conversa_id, tipo, intencao, dados) VALUES ($1, 'resposta', 'indevida', $2)",
      [outroId, JSON.stringify({ mensagemId: entrada.rows[0].id })]);
    await poolA.query(
      "INSERT INTO eventos (conversa_id, tipo, intencao, dados, sintetico) VALUES ($1, 'resposta', 'sintetica', $2, true)",
      [conversaId, JSON.stringify({ mensagemId: entrada.rows[0].id })]);
    await poolA.query("INSERT INTO eventos (conversa_id, tipo, dados) VALUES ($1, 'resposta', '{\"mensagemId\":\"invalido\"}')", [conversaId]);
    const ticket = await repositorio.buscarPorId("historico");
    assert.ok(ticket);
    assert.equal(ticket.getConversa().getStatus(), StatusConversa.ENCERRADA);
    const historico = await new ServicoDeFila(repositorio).obterHistoricoDoTicket("historico");
    assert.ok(historico.every(m => m instanceof Mensagem));
    assert.deepEqual(historico.map(m => m.getId()), [entrada, empate, posterior].map(r => String(r.rows[0].id)));
    assert.deepEqual(historico.map(m => m.getTexto()), ["Pergunta", "", "Posterior"]);
    assert.equal(historico[0].getRemetente().getIdentificacao(), ticket.getConversa().getCliente().getIdentificacao());
    assert.equal(historico[0].getIntencaoDetectada(), "atual");
    assert.equal(historico[1].getIntencaoDetectada(), null);
    // Mensagem de saída é do bot: não é atribuída ao atendente responsável atual.
    assert.equal(historico[2].getRemetente().getTipo(), TipoRemetente.CHATBOT);
    assert.deepEqual(historico.map(m => m.isProcessado()), [false, false, true]);
    assert.equal(ticket.getConversa().getCliente().getNome(), "Cliente");
  });

  test("ServicoDeFila mantém filtragem e ordenação e conversa vazia retorna histórico vazio", async () => {
    await cadastrar(ana);
    await criarTicket("baixa", { prioridade: Prioridade.BAIXA });
    await criarTicket("alta-recente", { prioridade: Prioridade.ALTA, dataAbertura: fechamento });
    await criarTicket("alta-antiga", { prioridade: Prioridade.ALTA });
    await criarTicket("media");
    await criarTicket("ocupado", { prioridade: Prioridade.ALTA, status: StatusTicket.EM_ATENDIMENTO, atendenteId: ana.getId() });
    const servico = new ServicoDeFila(repositorio);
    assert.deepEqual((await servico.listarFila()).map(t => t.getProtocolo()), ["alta-antiga", "alta-recente", "media", "baixa"]);
    assert.deepEqual(await servico.obterHistoricoDoTicket("media"), []);
    await servico.assumirTicket("media", ana);
    assert.equal((await new RepositorioDeFilaPg(poolB).buscarPorId("media"))?.getAtendente()?.getId(), ana.getId());
  });

  test("listarAguardando filtra e ordena no banco: URGENTE, ALTA, MEDIA, BAIXA e depois chegada", async () => {
    await cadastrar(ana);
    await criarTicket("baixa", { prioridade: Prioridade.BAIXA });
    await criarTicket("urgente-recente", { prioridade: Prioridade.URGENTE, dataAbertura: fechamento });
    await criarTicket("alta", { prioridade: Prioridade.ALTA });
    await criarTicket("urgente-antigo", { prioridade: Prioridade.URGENTE });
    await criarTicket("media", { prioridade: Prioridade.MEDIA });
    await criarTicket("urgente-ocupado", { prioridade: Prioridade.URGENTE, status: StatusTicket.EM_ATENDIMENTO, atendenteId: ana.getId() });
    await criarTicket("urgente-fechado", { prioridade: Prioridade.URGENTE, status: StatusTicket.ENCERRADO, atendenteId: ana.getId(), dataFechamento: fechamento });
    // Direto do repositório (sem o ServicoDeFila reordenar): a ordem vem do SQL.
    assert.deepEqual((await repositorio.listarAguardando()).map(t => t.getId()),
      ["urgente-antigo", "urgente-recente", "alta", "media", "baixa"]);
    assert.equal((await repositorio.buscarPorId("urgente-antigo"))?.getPrioridade(), Prioridade.URGENTE);
  });

  test("a consulta da fila pode usar o índice idx_tickets_fila", async () => {
    await poolA.query("SET enable_seqscan = off");
    const plano = await poolA.query<{ "QUERY PLAN": string }>(
      `EXPLAIN SELECT id FROM tickets WHERE status = 'AGUARDANDO'
        ORDER BY (CASE prioridade WHEN 'URGENTE' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END), data_abertura, id`);
    await poolA.query("RESET enable_seqscan");
    assert.ok(plano.rows.some(l => l["QUERY PLAN"].includes("idx_tickets_fila")));
  });

  test("atribui sem substituir o responsável em novas tentativas", async () => {
    await cadastrar(ana); await cadastrar(bruno); await criarTicket("atribuir");
    await repositorio.atribuirAtendente("atribuir", ana.getId());
    await assert.rejects(repositorio.atribuirAtendente("atribuir", bruno.getId()), TicketIndisponivelError);
    await assert.rejects(repositorio.atribuirAtendente("atribuir", ana.getId()), TicketIndisponivelError);
    const salvo = await new RepositorioDeFilaPg(poolB).buscarPorId("atribuir");
    assert.equal(salvo?.getStatus(), StatusTicket.EM_ATENDIMENTO);
    assert.equal(salvo?.getAtendente()?.getId(), ana.getId());
    assert.deepEqual(salvo?.getDataAbertura(), abertura);
  });

  test("concorrência usa dois backends realmente distintos e só permite um vencedor", async () => {
    await cadastrar(ana); await cadastrar(bruno); await criarTicket("disputa");
    const pidA = (await poolA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const pidB = (await poolB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    assert.notEqual(pidA, pidB);
    const bloqueio = await controle.connect();
    let tentativas: Promise<PromiseSettledResult<void>[]> | undefined;
    try {
      await bloqueio.query("BEGIN");
      await bloqueio.query(`SELECT id FROM "${schema}".tickets WHERE id = 'disputa' FOR UPDATE`);
      tentativas = Promise.allSettled([
        repositorio.atribuirAtendente("disputa", ana.getId()),
        new RepositorioDeFilaPg(poolB).atribuirAtendente("disputa", bruno.getId()),
      ]);
      // Evita rejeição não observada caso uma falha aconteça enquanto esperamos a barreira.
      void tentativas.catch(() => undefined);
      let esperando = 0;
      for (let i = 0; i < 200; i++) {
        await bloqueio.query("SELECT pg_stat_clear_snapshot()");
        const r = await bloqueio.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = ANY($1::int[]) AND wait_event_type = 'Lock'",
          [[pidA, pidB]]);
        esperando = r.rows[0].n;
        if (esperando === 2) break;
        await aguardar(10);
      }
      assert.equal(esperando, 2, "As duas conexões precisam disputar o bloqueio ao mesmo tempo.");
      await bloqueio.query("COMMIT");
    } finally {
      await bloqueio.query("ROLLBACK");
      bloqueio.release();
    }
    assert.ok(tentativas);
    const resultados = await tentativas;
    assert.equal(resultados.filter(r => r.status === "fulfilled").length, 1);
    assert.ok(resultados.some(r => r.status === "rejected" && r.reason instanceof TicketIndisponivelError));
    const vencedor = resultados[0].status === "fulfilled" ? ana : bruno;
    const perdedor = resultados[0].status === "fulfilled" ? bruno : ana;
    await assert.rejects(repositorio.atribuirAtendente("disputa", perdedor.getId()), TicketIndisponivelError);
    assert.equal((await repositorio.buscarPorId("disputa"))?.getAtendente()?.getId(), vencedor.getId());

    await criarTicket("disputa-servico");
    const respostas = await Promise.allSettled([
      new ServicoDeFila(repositorio).assumirTicket("disputa-servico", ana),
      new ServicoDeFila(new RepositorioDeFilaPg(poolB)).assumirTicket("disputa-servico", bruno),
    ]);
    assert.equal(respostas.filter(r => r.status === "fulfilled").length, 1);
    assert.ok(respostas.some(r => r.status === "rejected" && r.reason instanceof TicketIndisponivelError));
  });

  test("ticket encerrado mantém responsável e fechamento", async () => {
    await cadastrar(ana); await cadastrar(bruno);
    await criarTicket("fechado", { status: StatusTicket.ENCERRADO, atendenteId: ana.getId(), dataFechamento: fechamento });
    await assert.rejects(repositorio.atribuirAtendente("fechado", bruno.getId()), TicketIndisponivelError);
    const salvo = await repositorio.buscarPorId("fechado");
    assert.equal(salvo?.getAtendente()?.getId(), ana.getId());
    assert.deepEqual(salvo?.getDataFechamento(), fechamento);
  });

  test("cadastro ausente ou id inválido causa erro e rollback sem alterar o ticket", async () => {
    await criarTicket("cadastro");
    await assert.rejects(repositorio.atribuirAtendente("cadastro", ana.getId()), AtendenteNaoCadastradoError);
    assert.equal((await poolA.query("SELECT * FROM atendentes")).rowCount, 0);
    await cadastrar(ana);
    // atendentes.id é inteiro: um id que não é número é "não cadastrado", não erro de conversão.
    for (const invalido of ["abc", "", "1.5", "99999999999"]) {
      await assert.rejects(repositorio.atribuirAtendente("cadastro", invalido), AtendenteNaoCadastradoError);
    }
    assert.equal((await repositorio.buscarPorId("cadastro"))?.getStatus(), StatusTicket.AGUARDANDO);
    assert.equal((await poolA.query<{ nome: string }>("SELECT nome FROM atendentes")).rows[0].nome, ana.getNome());
    await repositorio.atribuirAtendente("cadastro", ana.getId());
    assert.equal(poolA.idleCount, poolA.totalCount);
  });

  test("erro de integridade depois do UPDATE é propagado, desfeito e libera a conexão", async () => {
    await cadastrar(ana); await criarTicket("rollback");
    await poolA.query(`
      CREATE FUNCTION falhar_atribuicao() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falha de teste' USING ERRCODE = '23514'; END;
      $$;
      CREATE TRIGGER falha_teste AFTER UPDATE ON tickets
        FOR EACH ROW EXECUTE FUNCTION falhar_atribuicao();
    `);
    await assert.rejects(repositorio.atribuirAtendente("rollback", ana.getId()), temCodigo("23514"));
    const salvo = await new RepositorioDeFilaPg(poolB).buscarPorId("rollback");
    assert.equal(salvo?.getStatus(), StatusTicket.AGUARDANDO);
    assert.equal(salvo?.getAtendente(), null);
    assert.equal(poolA.idleCount, poolA.totalCount);
    await poolA.query("DROP TRIGGER falha_teste ON tickets");
    await repositorio.atribuirAtendente("rollback", ana.getId());
  });

  test("conexão encerrada durante a transação descarta cliente e preserva rollback no servidor", async () => {
    await cadastrar(ana); await criarTicket("conexao-interrompida");
    await poolA.query(`
      CREATE FUNCTION interromper_conexao() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_terminate_backend(pg_backend_pid());
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER interrupcao_teste AFTER UPDATE ON tickets
        FOR EACH ROW EXECUTE FUNCTION interromper_conexao();
    `);
    // O pool tem max: 1: a próxima atribuição reutiliza exatamente este cliente.
    const clienteInterrompido = await poolA.connect();
    const errosDoCliente: Error[] = [];
    const errosDoPool: { erro: Error; cliente: pg.Client }[] = [];
    const observarCliente = (erro: Error) => { errosDoCliente.push(erro); };
    const observarPool = (erro: Error, cliente: pg.Client) => {
      errosDoPool.push({ erro, cliente });
    };
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    let aoEncerrar: () => void = () => undefined;
    const encerramento = new Promise<void>((resolve, reject) => {
      aoEncerrar = () => {
        clearTimeout(temporizador);
        resolve();
      };
      temporizador = setTimeout(() => reject(new Error(
        "O cliente interrompido não emitiu end dentro do prazo."
      )), 5000);
      clienteInterrompido.once("end", aoEncerrar);
    });

    // Listeners limitados a esta desconexão; todo erro capturado é validado abaixo.
    clienteInterrompido.on("error", observarCliente);
    poolA.on("error", observarPool);
    clienteInterrompido.release();
    try {
      // allSettled mantém os listeners até ambas as operações terminarem, mesmo em falha.
      const resultados = await Promise.allSettled([
        assert.rejects(
          repositorio.atribuirAtendente("conexao-interrompida", ana.getId()), temCodigo("57P01")),
        encerramento,
      ]);
      for (const resultado of resultados) {
        if (resultado.status === "rejected") throw resultado.reason;
      }
      assert.equal(errosDoCliente.length, 1, "Esperava um único erro de transporte na conexão interrompida.");
      assert.equal(errosDoCliente[0].message, "Connection terminated unexpectedly");
      // Dependendo do momento da liberação, o pool também pode encaminhar o mesmo erro.
      assert.ok(errosDoPool.length <= 1, "O pool emitiu erros adicionais.");
      for (const evento of errosDoPool) {
        assert.equal(evento.cliente, clienteInterrompido, "Erro em outra conexão do pool.");
        assert.equal(evento.erro, errosDoCliente[0], "O pool emitiu um erro diferente da desconexão esperada.");
      }
    } finally {
      clearTimeout(temporizador);
      clienteInterrompido.removeListener("end", aoEncerrar);
      clienteInterrompido.removeListener("error", observarCliente);
      poolA.removeListener("error", observarPool);
    }
    assert.equal(poolA.totalCount, 0);
    const salvo = await new RepositorioDeFilaPg(poolB).buscarPorId("conexao-interrompida");
    assert.equal(salvo?.getStatus(), StatusTicket.AGUARDANDO);
    assert.equal(salvo?.getAtendente(), null);
    await poolB.query("DROP TRIGGER interrupcao_teste ON tickets");
    await repositorio.atribuirAtendente("conexao-interrompida", ana.getId());
  });

  test("erros SQL em consultas e atribuição não viram lista vazia ou null", async () => {
    const poolInvalido = new pg.Pool({ ...conexao, options: "-c search_path=pg_catalog" });
    try {
      const invalido = new RepositorioDeFilaPg(poolInvalido);
      await assert.rejects(invalido.listarAguardando(), temCodigo("42P01"));
      await assert.rejects(invalido.buscarPorId("x"), temCodigo("42P01"));
      await assert.rejects(invalido.atribuirAtendente("x", ana.getId()), temCodigo("42P01"));
      assert.equal(poolInvalido.idleCount, poolInvalido.totalCount);
    } finally { await poolInvalido.end(); }
  });

  test("falha de conexão é propagada antes de adquirir um cliente", async () => {
    const servidor = createServer();
    await new Promise<void>(resolve => servidor.listen(0, "127.0.0.1", resolve));
    const endereco = servidor.address();
    assert.ok(endereco && typeof endereco !== "string");
    await new Promise<void>((resolve, reject) => servidor.close(e => e ? reject(e) : resolve()));
    const indisponivel = new pg.Pool({ ...conexao, host: "127.0.0.1", port: endereco.port, connectionTimeoutMillis: 1000 });
    try {
      await assert.rejects(new RepositorioDeFilaPg(indisponivel).atribuirAtendente("x", ana.getId()));
      assert.equal(indisponivel.totalCount, 0);
    } finally { await indisponivel.end(); }
  });
});
