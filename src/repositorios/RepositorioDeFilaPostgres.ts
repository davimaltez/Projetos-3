import type pg from "pg";
import type { RepositorioDeFila } from "../nucleo/RepositorioDeFila.js";
import { Atendente } from "../nucleo/entidades/Atendente.js";
import { Conversa } from "../nucleo/entidades/Conversa.js";
import { Prioridade, StatusConversa, StatusTicket } from "../nucleo/entidades/Enums.js";
import { Mensagem } from "../nucleo/entidades/Mensagem.js";
import { Ticket } from "../nucleo/entidades/Ticket.js";
import { Usuario } from "../nucleo/entidades/Usuario.js";

type Consulta = Pick<pg.Pool, "query">;
class ClientePersistido extends Usuario {}
const BOT = { getId: () => 0, getNome: () => "Chatbot WXN", getIdentificacao: () => "chatbot:wxn" };

interface LinhaConversa {
  conversa_id: number; estado: string; iniciada_em: Date;
  cliente_id: number; telefone: string; cliente_nome: string | null; origem: string | null;
}
interface LinhaTicket extends LinhaConversa {
  protocolo: string; assunto: string; prioridade: Prioridade; status: StatusTicket;
  aberto_em: Date; fechado_em: Date | null; resumo_bot: string;
  atendente_id: number | null; atendente_nome: string | null; atendente_email: string | null;
}
interface LinhaMensagem {
  conversa_id: number; texto: string | null; criado_em: Date; direcao: string; intencao: string | null;
}

const CONVERSA_SQL = `SELECT c.id AS conversa_id, c.estado, c.iniciada_em,
  cl.id AS cliente_id, cl.telefone, cl.nome AS cliente_nome, cl.origem
  FROM conversas c JOIN clientes cl ON cl.id = c.cliente_id`;
const TICKET_SQL = `SELECT t.*, c.estado, c.iniciada_em,
  cl.id AS cliente_id, cl.telefone, cl.nome AS cliente_nome, cl.origem,
  a.nome AS atendente_nome, a.email AS atendente_email
  FROM tickets t JOIN conversas c ON c.id = t.conversa_id
  JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN atendentes a ON a.id = t.atendente_id`;

/** Todas as instâncias compartilham a fila no banco, inclusive após reinício do processo. */
export class RepositorioDeFilaPostgres implements RepositorioDeFila {
  constructor(private readonly pool: pg.Pool) {}

  async enfileirar(conversaId: number): Promise<Ticket> {
    return this.transacao(async (db) => {
      // Serializa a criação e a assunção desta conversa, inclusive entre processos.
      const { rows } = await db.query<LinhaConversa>(`${CONVERSA_SQL} WHERE c.id = $1 FOR UPDATE OF c`, [conversaId]);
      if (!rows[0]) throw new Error("Conversa não encontrada.");
      const existente = await this.buscar(db, "t.conversa_id = $1 AND t.status <> 'ENCERRADO'", [conversaId]);
      if (existente[0]) return existente[0];
      const conversa = this.conversa(rows[0], await this.historicos(db, [conversaId]));
      const ticket = conversa.transferirParaHumano();
      await db.query(`INSERT INTO tickets (protocolo, conversa_id, assunto, prioridade, aberto_em, resumo_bot)
        VALUES ($1, $2, $3, $4, $5, $6)`, [ticket.getProtocolo(), conversaId, ticket.getAssunto(),
        ticket.getPrioridade(), ticket.getDataAbertura(), ticket.getResumoBot()]);
      await db.query("UPDATE conversas SET estado = $2, atualizado_em = now() WHERE id = $1",
        [conversaId, StatusConversa.AGUARDANDO_ATENDENTE]);
      await db.query(`INSERT INTO eventos (conversa_id, tipo, origem, dados)
        VALUES ($1, 'transferencia_humana', 'fila', $2)`,
        [conversaId, JSON.stringify({ protocolo: ticket.getProtocolo() })]);
      return ticket;
    });
  }

  async listar(): Promise<Ticket[]> {
    return this.buscar(this.pool, "t.status = 'AGUARDANDO'", []);
  }

  async obterPorId(ticketId: string): Promise<Ticket | null> {
    return (await this.buscar(this.pool, "t.protocolo = $1", [ticketId]))[0] ?? null;
  }

  async obterAbertoPorConversa(conversaId: number): Promise<Ticket | null> {
    return (await this.buscar(this.pool, "t.conversa_id = $1 AND t.status <> 'ENCERRADO'", [conversaId]))[0] ?? null;
  }

  async atribuirSeAguardando(ticketId: string, atendente: Atendente): Promise<boolean> {
    return this.transacao(async (db) => {
      // Mesma ordem de bloqueios usada na criação: conversa, depois ticket.
      await db.query(`SELECT c.id FROM conversas c JOIN tickets t ON t.conversa_id = c.id
        WHERE t.protocolo = $1 FOR UPDATE OF c`, [ticketId]);
      await db.query(`INSERT INTO atendentes (id, nome, email) VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, email = EXCLUDED.email`,
        [atendente.getId(), atendente.getNome(), atendente.getEmail()]);
      const { rows } = await db.query<{ conversa_id: number }>(`UPDATE tickets
        SET status = 'EM_ATENDIMENTO', atendente_id = $2
        WHERE protocolo = $1 AND status = 'AGUARDANDO' RETURNING conversa_id`, [ticketId, atendente.getId()]);
      if (!rows[0]) return false;
      await db.query("UPDATE conversas SET estado = $2, atualizado_em = now() WHERE id = $1",
        [rows[0].conversa_id, StatusConversa.EM_ATENDIMENTO]);
      await db.query(`INSERT INTO eventos (conversa_id, tipo, origem, dados)
        VALUES ($1, 'ticket_assumido', 'operador_http', $2)`,
        [rows[0].conversa_id, JSON.stringify({ protocolo: ticketId, atendenteId: atendente.getId() })]);
      return true;
    });
  }

  private async buscar(db: Consulta, condicao: string, valores: unknown[]): Promise<Ticket[]> {
    const { rows } = await db.query<LinhaTicket>(`${TICKET_SQL} WHERE ${condicao} ORDER BY t.aberto_em, t.protocolo`, valores);
    if (!rows.length) return [];
    const historicos = await this.historicos(db, rows.map((row) => row.conversa_id));
    return rows.map((row) => Ticket.restaurar({
      protocolo: row.protocolo, assunto: row.assunto, prioridade: row.prioridade,
      status: row.status, dataAbertura: row.aberto_em, dataFechamento: row.fechado_em,
      resumoBot: row.resumo_bot, conversa: this.conversa(row, historicos),
      atendente: row.atendente_id === null ? null : new Atendente(row.atendente_id, row.atendente_nome!, row.atendente_email!),
    }));
  }

  private async historicos(db: Consulta, ids: number[]): Promise<Map<number, LinhaMensagem[]>> {
    const { rows } = await db.query<LinhaMensagem>(`SELECT m.conversa_id, m.texto, m.criado_em, m.direcao,
      e.intencao FROM mensagens m LEFT JOIN LATERAL (
        SELECT intencao FROM eventos WHERE conversa_id = m.conversa_id AND tipo = 'resposta'
          AND dados->>'mensagemId' = m.id::text ORDER BY id DESC LIMIT 1
      ) e ON true WHERE m.conversa_id = ANY($1::int[]) ORDER BY m.criado_em, m.id`, [ids]);
    const resultado = new Map<number, LinhaMensagem[]>();
    for (const row of rows) {
      const mensagens = resultado.get(row.conversa_id) ?? [];
      mensagens.push(row);
      resultado.set(row.conversa_id, mensagens);
    }
    return resultado;
  }

  private conversa(row: LinhaConversa, historicos: Map<number, LinhaMensagem[]>): Conversa {
    const cliente = new ClientePersistido(row.cliente_id, row.cliente_nome ?? row.telefone, "");
    // O histórico atual possui apenas entradas do cliente e saídas do bot.
    const remetenteCliente = { getIdentificacao: () => row.telefone };
    const mensagens = (historicos.get(row.conversa_id) ?? []).map((m) => new Mensagem(m.texto ?? "", m.criado_em,
      m.direcao === "entrada" ? remetenteCliente : BOT, m.intencao ?? ""));
    const status = row.estado === "BOT" ? StatusConversa.COM_BOT : row.estado as StatusConversa;
    return Conversa.restaurar({ id: row.conversa_id, canal: row.origem ?? "whatsapp", cliente,
      chatbot: BOT, dataInicio: row.iniciada_em, status, mensagens });
  }

  private async transacao<T>(operacao: (db: pg.PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const resultado = await operacao(db);
      await db.query("COMMIT");
      return resultado;
    } catch (erro) {
      await db.query("ROLLBACK");
      throw erro;
    } finally {
      db.release();
    }
  }
}
