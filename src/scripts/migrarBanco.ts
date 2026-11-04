import { readFile } from "node:fs/promises";
import { Config } from "../config/Config.js";
import { BancoDeDados } from "../repositorios/BancoDeDados.js";

// Executável separado: atualiza o schema sem iniciar HTTP, WhatsApp ou Gemini.
const banco = new BancoDeDados(Config.carregar().databaseUrl);
try {
  const sql = await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8");
  const cliente = await banco.pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query("SELECT pg_advisory_xact_lock(7418301)");
    await cliente.query(sql);
    await cliente.query("COMMIT");
    console.log("Schema atualizado; dados existentes preservados.");
  } catch (erro) {
    await cliente.query("ROLLBACK");
    throw erro;
  } finally {
    cliente.release();
  }
} finally {
  await banco.encerrar();
}
