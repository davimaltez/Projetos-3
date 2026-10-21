import type { Pool } from "pg";
import type { RepositorioDeContextoDoMenu } from "../nucleo/Repositorios.js";

/** Depois desse tempo sem mexer no menu, o cliente volta ao menu principal. */
const VALIDADE_PADRAO_MS = 10 * 60_000;

/** Guarda o nível do menu em conversas.contexto (JSONB), na chave "menu". */
export class ContextoMenuRepositorio implements RepositorioDeContextoDoMenu {
  constructor(
    private readonly pool: Pool,
    private readonly validadeMs: number = VALIDADE_PADRAO_MS
  ) {}

  async obterCaminho(conversaId: number): Promise<string[]> {
    const r = await this.pool.query("SELECT contexto->'menu' AS menu FROM conversas WHERE id = $1", [conversaId]);
    const menu = r.rows[0]?.menu as { caminho?: unknown; em?: unknown } | null | undefined;
    if (!menu || !Array.isArray(menu.caminho) || typeof menu.em !== "string") return [];
    if (Date.now() - Date.parse(menu.em) > this.validadeMs) return [];
    return menu.caminho.filter((id): id is string => typeof id === "string");
  }

  async salvarCaminho(conversaId: number, caminho: readonly string[]): Promise<void> {
    const valor = JSON.stringify({ caminho, em: new Date().toISOString() });
    // jsonb_set preserva as outras chaves do contexto (ex.: o número da demanda, na história 1.4).
    await this.pool.query(
      `UPDATE conversas
          SET contexto = jsonb_set(COALESCE(contexto, '{}'::jsonb), '{menu}', $2::jsonb)
        WHERE id = $1`,
      [conversaId, valor]
    );
  }
}