import { createHash, timingSafeEqual } from "node:crypto";
import { Atendente } from "../nucleo/entidades/Atendente.js";

/** Credenciais individuais do protótipo. Nunca devolve tokens ou os inclui em logs. */
export class AutenticadorDeOperador {
  private readonly operadores: { atendente: Atendente; hash: Buffer }[];

  constructor(configuracao: string = "[]") {
    let dados: unknown;
    try { dados = JSON.parse(configuracao); } catch { throw new Error("OPERADORES_HTTP_JSON deve ser um JSON válido."); }
    if (!Array.isArray(dados)) throw new Error("OPERADORES_HTTP_JSON deve ser uma lista.");
    const ids = new Set<number>();
    const tokens = new Set<string>();
    this.operadores = dados.map((item: unknown) => {
      if (typeof item !== "object" || item === null) throw new Error("Operador HTTP inválido.");
      const { id, nome, email, token } = item as Record<string, unknown>;
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647 ||
          typeof nome !== "string" || !nome.trim() || typeof email !== "string" || !email.trim() ||
          typeof token !== "string" || token.length < 32 || /\s/.test(token) || ids.has(id) || tokens.has(token)) {
        throw new Error("Operador HTTP inválido: use id único positivo, nome, e-mail e token único com ao menos 32 caracteres sem espaços.");
      }
      ids.add(id);
      tokens.add(token);
      return { atendente: new Atendente(id, nome.trim(), email.trim()), hash: this.hash(token) };
    });
  }

  get configurado(): boolean { return this.operadores.length > 0; }

  listarAtendentes(): Atendente[] {
    return this.operadores.map(({ atendente }) => new Atendente(atendente.getId(), atendente.getNome(), atendente.getEmail()));
  }

  autenticar(autorizacao: string | undefined): Atendente | null {
    const token = /^Bearer (\S+)$/i.exec(autorizacao ?? "")?.[1];
    if (!token) return null;
    const hash = this.hash(token);
    return this.operadores.find((operador) => timingSafeEqual(operador.hash, hash))?.atendente ?? null;
  }

  private hash(token: string): Buffer { return createHash("sha256").update(token).digest(); }
}
