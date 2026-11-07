import { Config } from "../config/Config.js";
import { BancoDeDados } from "../repositorios/BancoDeDados.js";
import { MigradorDoBanco } from "../repositorios/MigradorDoBanco.js";

// Executável separado: atualiza o schema sem iniciar HTTP, WhatsApp ou Gemini.
const banco = new BancoDeDados(Config.carregar().databaseUrl);
try {
  await new MigradorDoBanco(banco.pool).executar();
  console.log("Schema atualizado; dados existentes preservados.");
} finally {
  await banco.encerrar();
}
