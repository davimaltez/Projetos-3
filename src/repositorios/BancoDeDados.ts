import pg from "pg";

/**
 * Dono do pool de conexões. Uma instância para o processo inteiro:
 * criar Pool/Client por mensagem esgota as conexões do Postgres.
 */
export class BancoDeDados {
  readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      // Sem estes prazos, um banco que "some" (rede caiu, sem recusar a conexão) deixaria cada
      // consulta e o /status pendurados para sempre, e o atendimento parado junto.
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000, // o servidor cancela a consulta
      query_timeout: 10_000, // o cliente desiste de esperar (cobre o caso de o servidor nem responder)
    });
    this.pool.on("error", (erro) => {
      console.error("[db] erro inesperado em conexão ociosa", erro);
    });
  }

  /** Usado na subida e no /status: confirma que o banco responde. */
  async verificar(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async encerrar(): Promise<void> {
    await this.pool.end();
  }
}
