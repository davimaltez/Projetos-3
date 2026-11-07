import type { Pool } from "pg";
import type { TrocaDeConversa } from "../nucleo/GeradorDeResposta.js";
import type { EstadoDoMenu, RepositorioDeContextoDoMenu, TransferenciaPendente } from "../nucleo/Repositorios.js";

/** Depois desse tempo sem mexer no menu, o cliente volta ao menu principal. */
const VALIDADE_PADRAO_MS = 10 * 60_000;
const MAX_TROCAS = 3;

function estadoVazio(): EstadoDoMenu {
  return { caminho: [], perguntando: false, historico: [], falhasSeguidas: 0, transferenciaPendente: null };
}

/** Guarda o estado do menu em conversas.contexto (JSONB), na chave "menu". */
export class ContextoMenuRepositorio implements RepositorioDeContextoDoMenu {
  constructor(
    private readonly pool: Pool,
    private readonly validadeMs: number = VALIDADE_PADRAO_MS
  ) {}

  async obter(conversaId: number): Promise<EstadoDoMenu> {
    const r = await this.pool.query("SELECT contexto->'menu' AS menu FROM conversas WHERE id = $1", [conversaId]);
    const bruto = r.rows[0]?.menu as
      | {
          caminho?: unknown;
          perguntando?: unknown;
          historico?: unknown;
          falhasSeguidas?: unknown;
          transferenciaPendente?: unknown;
          em?: unknown;
        }
      | null
      | undefined;
    if (!bruto || typeof bruto.em !== "string") return estadoVazio();
    if (Date.now() - Date.parse(bruto.em) > this.validadeMs) return estadoVazio();

    return {
      caminho: Array.isArray(bruto.caminho) ? bruto.caminho.filter((id): id is string => typeof id === "string") : [],
      perguntando: bruto.perguntando === true,
      historico: lerHistorico(bruto.historico),
      falhasSeguidas:
        typeof bruto.falhasSeguidas === "number" && Number.isInteger(bruto.falhasSeguidas) ? bruto.falhasSeguidas : 0,
      transferenciaPendente: lerTransferenciaPendente(bruto.transferenciaPendente),
    };
  }

  async salvar(conversaId: number, estado: EstadoDoMenu): Promise<void> {
    const valor = JSON.stringify({
      caminho: estado.caminho,
      perguntando: estado.perguntando,
      historico: estado.historico,
      falhasSeguidas: estado.falhasSeguidas ?? 0,
      transferenciaPendente: estado.transferenciaPendente ?? null,
      em: new Date().toISOString(),
    });
    // jsonb_set preserva as outras chaves do contexto (ex.: o número da demanda, na história 1.4).
    await this.pool.query(
      `UPDATE conversas
          SET contexto = jsonb_set(COALESCE(contexto, '{}'::jsonb), '{menu}', $2::jsonb)
        WHERE id = $1`,
      [conversaId, valor]
    );
  }

  async obterEmpresa(conversaId: number): Promise<string | null> {
    try {
      const r = await this.pool.query<{ empresa: string | null }>(
        "SELECT contexto->>'empresa' AS empresa FROM conversas WHERE id = $1",
        [conversaId]
      );
      return typeof r.rows[0]?.empresa === "string" ? r.rows[0].empresa : null;
    } catch {
      return null;
    }
  }
}

/** O que vem do banco não é confiável: só entram trocas com os dois textos. */
function lerHistorico(bruto: unknown): TrocaDeConversa[] {
  if (!Array.isArray(bruto)) return [];
  const trocas: TrocaDeConversa[] = [];
  for (const item of bruto) {
    const t = item as { cliente?: unknown; resposta?: unknown } | null;
    if (t && typeof t.cliente === "string" && typeof t.resposta === "string") {
      trocas.push({ cliente: t.cliente, resposta: t.resposta });
    }
  }
  return trocas.slice(-MAX_TROCAS);
}

function lerTransferenciaPendente(bruto: unknown): TransferenciaPendente | null {
  if (!bruto || typeof bruto !== "object") return null;
  const p = bruto as Record<string, unknown>;
  if (typeof p.motivo !== "string" || typeof p.assunto !== "string" || typeof p.prioridade !== "string") {
    return null;
  }
  return {
    motivo: p.motivo as any,
    assunto: p.assunto,
    prioridade: p.prioridade as any,
    dados: typeof p.dados === "object" && p.dados !== null && !Array.isArray(p.dados)
      ? (p.dados as Record<string, unknown>)
      : {},
  };
}