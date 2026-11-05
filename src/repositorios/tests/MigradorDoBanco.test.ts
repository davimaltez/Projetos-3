import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";
import { MigradorDoBanco } from "../MigradorDoBanco.js";
import { AtendenteRepositorio } from "../AtendenteRepositorio.js";
import { Atendente } from "../../nucleo/entidades/Atendente.js";
import { StatusAtendente } from "../../nucleo/entidades/Enums.js";

const url = process.env.FILA_TEST_DATABASE_URL;
test("migrações e cadastro em PostgreSQL isolado", { skip: !url }, async (t) => {
  const controle = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
  t.after(() => controle.end());
  const sql = await readFile(new URL("../../../db/schema.sql", import.meta.url), "utf8");
  const legado = sql.split("-- Etapa 3:")[0]
    .replace(/,\s*-- Conversa.dataCriacao[\s\S]*?criado_em TIMESTAMPTZ NOT NULL DEFAULT now\(\)/, "");
  const primeiraFila = await readFile(new URL("./apoio/fila-primeira-versao.sql", import.meta.url), "utf8");
  const validacaoSql = await readFile(new URL("../../../db/tests/fila.sql", import.meta.url), "utf8");
  async function isolado(operacao: (pool: pg.Pool, schema: string) => Promise<void>) {
    const schema = `migracao_test_${randomUUID().replaceAll("-", "")}`;
    await controle.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema},pg_catalog`, connectionTimeoutMillis: 5000 });
    try { await operacao(pool, schema); }
    finally { await pool.end(); await controle.query(`DROP SCHEMA ${schema} CASCADE`); }
  }
  async function dadosAntigos(pool: pg.Pool) {
    await pool.query(`INSERT INTO clientes (id, telefone) VALUES (10, '5581999999999');
      INSERT INTO conversas (id, cliente_id) VALUES (10, 10);
      INSERT INTO mensagens (conversa_id, texto, criado_em, direcao)
        VALUES (10, 'Histórico preservado', '2026-01-01T10:00:00Z', 'entrada')`);
  }

  await t.test("instala banco vazio, reaplica sem erro e passa nas restrições SQL da equipe", () => isolado(async (pool, schema) => {
    await new MigradorDoBanco(pool).executar();
    await new MigradorDoBanco(pool).executar();
    await pool.query(validacaoSql.replace("SET LOCAL search_path = public, pg_catalog;", `SET LOCAL search_path = ${schema}, pg_catalog;`));
  }));

  await t.test("reconhece a migração 001 já aplicada e preserva tickets e datas ao aplicar 002", () => isolado(async (pool, schema) => {
    await pool.query(legado);
    await dadosAntigos(pool);
    const migracao = await readFile(new URL("../../../db/migrations/001_fila_atendimento_humano.sql", import.meta.url), "utf8");
    await pool.query(migracao.replace("SET LOCAL search_path = public, pg_catalog;", `SET LOCAL search_path = ${schema}, pg_catalog;`)
      .replaceAll("n.nspname = 'public'", "n.nspname = current_schema()")
      .replaceAll("table_schema = 'public'", "table_schema = current_schema()"));
    await pool.query(`INSERT INTO tickets (protocolo, conversa_id, assunto, prioridade, data_abertura, resumo_bot)
      VALUES ('legado-001', 10, 'Suporte', 'ALTA', '2026-01-01T10:01:00Z', 'Resumo')`);
    await new MigradorDoBanco(pool).executar();
    await new MigradorDoBanco(pool).executar();
    assert.equal((await pool.query("SELECT id FROM tickets")).rows[0].id, "legado-001");
    assert.deepEqual((await pool.query("SELECT criado_em FROM conversas")).rows[0].criado_em, new Date("2026-01-01T10:00:00Z"));
  }));

  await t.test("migra o primeiro formato da branch preservando protocolos, responsáveis e histórico", () => isolado(async (pool, schema) => {
    await pool.query(legado + primeiraFila);
    await dadosAntigos(pool);
    await pool.query(`INSERT INTO atendentes (id, nome, email) VALUES (1, 'Ana', 'ana@example.com');
      INSERT INTO tickets (protocolo, conversa_id, assunto, prioridade, status, aberto_em, resumo_bot, atendente_id)
      VALUES ('protocolo-original', 10, 'Suporte', 'MEDIA', 'EM_ATENDIMENTO', '2026-01-01T10:01:00Z', 'Resumo', 1)`);
    await new MigradorDoBanco(pool).executar();
    await new MigradorDoBanco(pool).executar();
    assert.deepEqual((await pool.query("SELECT id, status, atendente_id, data_abertura FROM tickets")).rows[0], {
      id: "protocolo-original", status: "EM_ATENDIMENTO", atendente_id: 1, data_abertura: new Date("2026-01-01T10:01:00Z"),
    });
    assert.equal((await pool.query("SELECT texto FROM mensagens")).rows[0].texto, "Histórico preservado");
    await pool.query(validacaoSql.replace("SET LOCAL search_path = public, pg_catalog;", `SET LOCAL search_path = ${schema}, pg_catalog;`));
  }));

  await t.test("conflito de dados no formato antigo falha sem perder registros ou renomear colunas", () => isolado(async (pool) => {
    await pool.query(legado + primeiraFila);
    await dadosAntigos(pool);
    await pool.query(`INSERT INTO atendentes (id, nome, email) VALUES (1, 'Ana', 'ana@example.com');
      INSERT INTO tickets (protocolo, conversa_id, assunto, prioridade, status, resumo_bot, atendente_id, fechado_em)
        VALUES ('antigo-a', 10, 'A', 'MEDIA', 'ENCERRADO', '', 1, now()),
               ('antigo-b', 10, 'B', 'MEDIA', 'ENCERRADO', '', 1, now())`);
    await assert.rejects(new MigradorDoBanco(pool).executar(), /múltiplos tickets por conversa/);
    assert.equal((await pool.query("SELECT count(*)::int AS total FROM tickets WHERE protocolo LIKE 'antigo-%'")).rows[0].total, 2);
  }));

  await t.test("estrutura parcial incompatível provoca rollback, sem criar metade da fila", () => isolado(async (pool) => {
    await pool.query(legado);
    await pool.query("CREATE TABLE atendentes (id INT)");
    await assert.rejects(new MigradorDoBanco(pool).executar(), /already exists/);
    assert.equal((await pool.query("SELECT to_regclass('tickets') AS tabela")).rows[0].tabela, null);
  }));

  await t.test("cadastro repete sem duplicar e preserva status/especialidade existentes", () => isolado(async (pool) => {
    await new MigradorDoBanco(pool).executar();
    await pool.query(`INSERT INTO atendentes (id, nome, email, status, especialidade)
      VALUES (1, 'Nome antigo', 'antigo@example.com', 'DISPONIVEL', 'Suporte')`);
    const cadastro = new AtendenteRepositorio(pool);
    await cadastro.cadastrar([new Atendente(1, "Nome atual", "atual@example.com")]);
    await cadastro.cadastrar([new Atendente(1, "Nome atual", "atual@example.com")]);
    assert.deepEqual((await pool.query("SELECT nome, email, status, especialidade FROM atendentes")).rows,
      [{ nome: "Nome atual", email: "atual@example.com", status: StatusAtendente.DISPONIVEL, especialidade: "Suporte" }]);
  }));
});
