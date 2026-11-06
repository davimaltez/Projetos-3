import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { AtendenteNaoCadastradoError, TicketIndisponivelError, TicketNaoEncontradoError } from "../nucleo/ErrosDaFila.js";
import type { RepositorioDeFila } from "../nucleo/RepositorioDeFila.js";
import { PEDIDO_PADRAO, type PedidoDeAtendimento } from "../nucleo/PedidoDeAtendimento.js";
import { Atendente } from "../nucleo/entidades/Atendente.js";
import { Chatbot } from "../nucleo/entidades/Chatbot.js";
import { Cliente } from "../nucleo/entidades/Cliente.js";
import { Conversa } from "../nucleo/entidades/Conversa.js";
import {
  MotivoDaTransferencia,
  Prioridade,
  StatusAtendente,
  StatusConversa,
  StatusTicket,
} from "../nucleo/entidades/Enums.js";
import { Mensagem } from "../nucleo/entidades/Mensagem.js";
import { Ticket } from "../nucleo/entidades/Ticket.js";

// Mantém o import antigo (`from "./RepositorioDeFilaPg.js"`) funcionando.
export { AtendenteNaoCadastradoError } from "../nucleo/ErrosDaFila.js";

/**
 * Mensagens de saída podem ter o chatbot ou um atendente como remetente.
 */
const CHATBOT_DAS_MENSAGENS = new Chatbot("wxn", "Assistente WXN", "simples e cordial", 2, true);

/** Mesma expressão do índice idx_tickets_fila (db/schema.sql): URGENTE, ALTA, MEDIA, BAIXA. */
const ORDEM_SQL_DA_PRIORIDADE =
    "(CASE t.prioridade WHEN 'URGENTE' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END)";

interface LinhaTicket {
  id: string;
  assunto: string;
  prioridade: string;
  status: string;
  motivo: string;
  dados: Record<string, unknown> | null;
  data_abertura: Date;
  data_fechamento: Date | null;
  resumo_bot: string;
  conversa_id: number;
  conversa_criada_em: Date;
  estado_conversa: string;
  cliente_id: number;
  cliente_nome: string | null;
  cliente_telefone: string;
  atendente_id: number | null;
  atendente_nome: string | null;
  atendente_email: string | null;
  atendente_status: string | null;
  atendente_especialidade: string | null;
  mensagem_id: number | null;
  mensagem_texto: string | null;
  mensagem_data: Date | null;
  mensagem_direcao: string | null;
  mensagem_processado: boolean | null;
  mensagem_atendente_id: number | null;
  mensagem_intencao: string | null;
}

// Uma consulta fornece um retrato consistente, sem uma ida ao banco por ticket/mensagem.
// O LATERAL seleciona a classificação mais recente da entrada, sem multiplicar o histórico.
const CONSULTA = `
  SELECT t.id, t.assunto, t.prioridade, t.status, t.motivo, t.dados,
         t.data_abertura, t.data_fechamento, t.resumo_bot, t.conversa_id,
         c.criado_em AS conversa_criada_em, c.estado AS estado_conversa, c.cliente_id, cl.nome AS cliente_nome, cl.telefone AS cliente_telefone,
         t.atendente_id, a.nome AS atendente_nome, a.email AS atendente_email,
         a.status AS atendente_status, a.especialidade AS atendente_especialidade,
         m.id AS mensagem_id, m.texto AS mensagem_texto, m.criado_em AS mensagem_data,
         m.direcao AS mensagem_direcao, m.processado AS mensagem_processado,
         m.atendente_id AS mensagem_atendente_id,
         classificacao.intencao AS mensagem_intencao
  FROM tickets t
         JOIN conversas c ON c.id = t.conversa_id
         JOIN clientes cl ON cl.id = c.cliente_id
         LEFT JOIN atendentes a ON a.id = t.atendente_id
         LEFT JOIN mensagens m ON m.conversa_id = c.id
         LEFT JOIN LATERAL (
    SELECT e.intencao
    FROM eventos e
    WHERE m.direcao = 'entrada'
      AND e.conversa_id = c.id
      AND e.tipo = 'resposta'
      AND e.sintetico = false
      AND e.dados->>'mensagemId' = m.id::text
  ORDER BY e.criado_em DESC, e.id DESC
    LIMIT 1
    ) classificacao ON true
`;

function prioridadePersistida(valor: string): Prioridade {
  switch (valor) {
      // URGENTE ainda é recusado pelo CHECK de tickets.prioridade (ver db/schema.sql).
    case Prioridade.URGENTE: return Prioridade.URGENTE;
    case Prioridade.ALTA: return Prioridade.ALTA;
    case Prioridade.MEDIA: return Prioridade.MEDIA;
    case Prioridade.BAIXA: return Prioridade.BAIXA;
    default: throw new Error("Prioridade de ticket persistido inválida.");
  }
}

function statusPersistido(valor: string): StatusTicket {
  switch (valor) {
    case StatusTicket.AGUARDANDO: return StatusTicket.AGUARDANDO;
    case StatusTicket.EM_ATENDIMENTO: return StatusTicket.EM_ATENDIMENTO;
    case StatusTicket.ENCERRADO: return StatusTicket.ENCERRADO;
    default: throw new Error("Status de ticket persistido inválido.");
  }
}

function motivoPersistido(valor: string): MotivoDaTransferencia {
  switch (valor) {
    case MotivoDaTransferencia.PEDIDO_DO_CLIENTE: return MotivoDaTransferencia.PEDIDO_DO_CLIENTE;
    case MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA: return MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA;
    case MotivoDaTransferencia.FALHAS_SEGUIDAS: return MotivoDaTransferencia.FALHAS_SEGUIDAS;
    case MotivoDaTransferencia.DEMANDA_NAO_ENCONTRADA: return MotivoDaTransferencia.DEMANDA_NAO_ENCONTRADA;
    default: throw new Error("Motivo de ticket persistido inválido.");
  }
}

function estadoDaConversa(valor: string): StatusConversa | null {
  switch (valor) {
    case "BOT":
    case StatusConversa.COM_BOT: return StatusConversa.COM_BOT;
    case StatusConversa.AGUARDANDO_ATENDENTE: return StatusConversa.AGUARDANDO_ATENDENTE;
    case StatusConversa.EM_ATENDIMENTO: return StatusConversa.EM_ATENDIMENTO;
    case StatusConversa.ENCERRADA: return StatusConversa.ENCERRADA;
    default: return null; // O texto original fica disponível na conversa.
  }
}

function statusDoAtendente(valor: string | null): StatusAtendente {
  switch (valor) {
    case StatusAtendente.DISPONIVEL: return StatusAtendente.DISPONIVEL;
    case StatusAtendente.OCUPADO: return StatusAtendente.OCUPADO;
    case StatusAtendente.OFFLINE: return StatusAtendente.OFFLINE;
    default: throw new Error("Status de atendente persistido inválido.");
  }
}

/** Persistência da fila e da transferência; o cadastro de operadores fica em AtendenteRepositorio. */
export class RepositorioDeFilaPg implements RepositorioDeFila {
  constructor(private readonly pool: Pool) {}

  async buscarPorConversa(conversaId: number): Promise<Ticket | null> {
    return (await this.carregar(" WHERE t.conversa_id = $1", [String(conversaId)],
        " ORDER BY m.criado_em, m.id"))[0] ?? null;
  }

  async enfileirar(conversaId: number, pedido: PedidoDeAtendimento = PEDIDO_PADRAO): Promise<Ticket> {
    const db = await this.pool.connect();
    let erroDeRollback: Error | undefined;
    try {
      await db.query("BEGIN");
      const { rows } = await db.query<{ id: number; estado: string }>(
          "SELECT id, estado FROM conversas WHERE id = $1 FOR UPDATE", [conversaId]);
      if (!rows[0]) throw new Error("Conversa não encontrada.");
      const existente = await this.carregar(" WHERE t.conversa_id = $1", [String(conversaId)],
          " ORDER BY m.criado_em, m.id", db);
      if (existente[0]?.getStatus() === StatusTicket.ENCERRADO) {
        throw new TicketIndisponivelError(existente[0].getId());
      }
      if (existente[0]) {
        // Já tem ticket: devolve o mesmo, com o mesmo protocolo. O pedido novo é ignorado.
        await db.query("COMMIT");
        return existente[0];
      }
      if (rows[0].estado === StatusConversa.ENCERRADA) throw new Error("Conversa encerrada.");
      const id = randomUUID();
      // O resumo é fixado na abertura; o histórico continua vindo da tabela mensagens.
      // Assunto, prioridade, motivo e dados vêm do pedido (história 2.1), não são mais valores fixos.
      await db.query(`INSERT INTO tickets (id, conversa_id, assunto, prioridade, motivo, dados, data_abertura, resumo_bot)
        SELECT $1, c.id, $3::text, $4::text, $5::text, $6::jsonb, now(),
          COALESCE((SELECT string_agg(m.texto, E'\\n' ORDER BY m.criado_em, m.id)
            FROM mensagens m WHERE m.conversa_id = c.id AND m.texto <> ''), '')
        FROM conversas c WHERE c.id = $2`,
          [id, conversaId, pedido.assunto, pedido.prioridade, pedido.motivo, JSON.stringify(pedido.dados)]);
      await db.query("UPDATE conversas SET estado = $2, atualizado_em = now() WHERE id = $1",
          [conversaId, StatusConversa.AGUARDANDO_ATENDENTE]);
      await db.query(`INSERT INTO eventos (conversa_id, tipo, origem, dados)
        VALUES ($1, 'transferencia_humana', 'fila', $2)`,
          [conversaId, JSON.stringify({ protocolo: id, motivo: pedido.motivo, prioridade: pedido.prioridade })]);
      const [ticket] = await this.carregar(" WHERE t.id = $1", [id], " ORDER BY m.criado_em, m.id", db);
      await db.query("COMMIT");
      return ticket;
    } catch (erro) {
      try { await db.query("ROLLBACK"); }
      catch (falha) { erroDeRollback = falha instanceof Error ? falha : new Error("Falha no rollback."); }
      throw erro;
    } finally {
      db.release(erroDeRollback);
    }
  }

  async listarAguardando(): Promise<Ticket[]> {
    // Filtra e ordena no banco: a fila não carrega tickets encerrados nem seus históricos.
    return this.carregar(
        " WHERE t.status = 'AGUARDANDO'",
        [],
        ` ORDER BY ${ORDEM_SQL_DA_PRIORIDADE}, t.data_abertura, t.id, m.criado_em, m.id`
    );
  }

  async buscarPorId(id: string): Promise<Ticket | null> {
    return (await this.carregar(" WHERE t.id = $1", [id], " ORDER BY t.id, m.criado_em, m.id"))[0] ?? null;
  }

  async atribuirAtendente(ticketId: string, atendenteId: string): Promise<void> {
    const client = await this.pool.connect();
    let erroDeRollback: Error | undefined;
    try {
      await client.query("BEGIN");
      const ticket = await client.query<{ status: string }>(
          "SELECT status FROM tickets WHERE id = $1 FOR UPDATE", [ticketId]
      );
      if (ticket.rows.length === 0) throw new TicketNaoEncontradoError(ticketId);
      if (ticket.rows[0].status !== StatusTicket.AGUARDANDO) throw new TicketIndisponivelError(ticketId);

      // O cadastro é precondição explícita. atendentes.id é inteiro: um id que não é
      // número nunca está cadastrado (e não chega ao banco como erro de conversão).
      // FOR SHARE impede a exclusão do atendente até o COMMIT.
      const cadastrado = /^-?\d{1,10}$/.test(atendenteId) && (await client.query(
          "SELECT 1 FROM atendentes WHERE id = $1 FOR SHARE", [atendenteId]
      )).rows.length === 1;
      if (!cadastrado) throw new AtendenteNaoCadastradoError(atendenteId);

      const atribuicao = await client.query(
          `UPDATE tickets SET status = 'EM_ATENDIMENTO', atendente_id = $2
         WHERE id = $1 AND status = 'AGUARDANDO'`,
          [ticketId, atendenteId]
      );
      if (atribuicao.rowCount !== 1) {
        throw new Error("A atribuição não atualizou o ticket bloqueado.");
      }
      await client.query(`UPDATE conversas SET estado = $2, atualizado_em = now()
        WHERE id = (SELECT conversa_id FROM tickets WHERE id = $1)`, [ticketId, StatusConversa.EM_ATENDIMENTO]);
      await client.query(`INSERT INTO eventos (conversa_id, tipo, origem, dados)
        SELECT conversa_id, 'ticket_assumido', 'operador_http', $2 FROM tickets WHERE id = $1`,
          [ticketId, JSON.stringify({ protocolo: ticketId, atendenteId })]);
      await client.query("COMMIT");
    } catch (erro) {
      try {
        await client.query("ROLLBACK");
      } catch (falha) {
        // Descarta a conexão defeituosa e mantém o erro original para o chamador.
        erroDeRollback = falha instanceof Error ? falha : new Error("Falha no rollback.");
      }
      throw erro;
    } finally {
      client.release(erroDeRollback);
    }
  }

  async buscarEmAtendimentoPorAtendente(atendenteId: string): Promise<Ticket | null> {
    const { rows } = await this.pool.query<{ id: string }>(
        `SELECT id FROM tickets WHERE atendente_id = $1 AND status = 'EM_ATENDIMENTO'
       ORDER BY data_abertura DESC, id DESC LIMIT 1`, [atendenteId]
    );
    return rows[0] ? this.buscarPorId(rows[0].id) : null;
  }

  async obterDestinoDoCliente(ticketId: string, atendenteId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ endereco_resposta: string | null }>(
        `SELECT cl.endereco_resposta FROM tickets t
       JOIN conversas c ON c.id = t.conversa_id JOIN clientes cl ON cl.id = c.cliente_id
       WHERE t.id = $1 AND t.status = 'EM_ATENDIMENTO' AND t.atendente_id = $2`,
        [ticketId, atendenteId]
    );
    if (!rows[0]) throw new TicketIndisponivelError(ticketId);
    return rows[0].endereco_resposta;
  }

  async registrarRespostaDoAtendente(ticketId: string, atendenteId: string, idEnviado: string, texto: string): Promise<void> {
    const db = await this.pool.connect();
    let descartar = false;
    try {
      await db.query('BEGIN');
      const { rows } = await db.query<{ conversa_id: number }>(
          `SELECT conversa_id FROM tickets WHERE id = $1 AND atendente_id = $2
         AND status = 'EM_ATENDIMENTO' FOR UPDATE`, [ticketId, atendenteId]
      );
      if (!rows[0]) throw new TicketIndisponivelError(ticketId);
      await db.query(`INSERT INTO mensagens (conversa_id, wamid, direcao, texto, processado, atendente_id)
        VALUES ($1, $2, 'saida', $3, true, $4)
        ON CONFLICT (wamid) DO NOTHING`, [rows[0].conversa_id, idEnviado, texto, atendenteId]);
      await db.query(`INSERT INTO eventos (conversa_id, tipo, origem, dados)
        VALUES ($1, 'mensagem_atendente', 'operador_whatsapp', $2)`,
          [rows[0].conversa_id, JSON.stringify({ ticketId, atendenteId })]);
      await db.query('COMMIT');
    } catch (erro) {
      try { await db.query('ROLLBACK'); } catch { descartar = true; }
      throw erro;
    } finally { db.release(descartar); }
  }

  async encerrarTicket(ticketId: string, atendenteId: string): Promise<void> {
    const db = await this.pool.connect();
    let descartar = false;
    try {
      await db.query('BEGIN');
      const { rows } = await db.query<{ conversa_id: number }>(
          `SELECT conversa_id FROM tickets WHERE id = $1 AND atendente_id = $2
         AND status = 'EM_ATENDIMENTO' FOR UPDATE`, [ticketId, atendenteId]
      );
      if (!rows[0]) throw new TicketIndisponivelError(ticketId);
      await db.query(`UPDATE tickets SET status = 'ENCERRADO', data_fechamento = now() WHERE id = $1`, [ticketId]);
      await db.query(`UPDATE conversas SET estado = 'ENCERRADA', atualizado_em = now()
        WHERE id = $1`, [rows[0].conversa_id]);
      await db.query(`INSERT INTO eventos (conversa_id, tipo, origem, dados)
        VALUES ($1, 'ticket_encerrado', 'operador_whatsapp', $2)`,
          [rows[0].conversa_id, JSON.stringify({ ticketId, atendenteId })]);
      await db.query('COMMIT');
    } catch (erro) {
      try { await db.query('ROLLBACK'); } catch { descartar = true; }
      throw erro;
    } finally { db.release(descartar); }
  }

  /** As linhas chegam na ordem dos tickets; o Map preserva essa ordem ao agrupar. */
  private async carregar(filtro: string, parametros: string[], ordem: string,
                         db: Pick<Pool, "query"> = this.pool): Promise<Ticket[]> {
    const { rows } = await db.query<LinhaTicket>(CONSULTA + filtro + ordem, parametros);
    const grupos = new Map<string, { linha: LinhaTicket; mensagens: Mensagem[]; cliente: Cliente }>();
    for (const linha of rows) {
      let grupo = grupos.get(linha.id);
      if (!grupo) {
        grupo = {
          linha, mensagens: [],
          // clientes não tem coluna de e-mail: o cliente reconstituído fica sem e-mail.
          cliente: new Cliente(linha.cliente_id, linha.cliente_nome, null, linha.cliente_telefone),
        };
        grupos.set(linha.id, grupo);
      }
      if (linha.mensagem_id !== null) {
        if (linha.mensagem_data === null || linha.mensagem_direcao === null) {
          throw new Error("Mensagem persistida sem data ou direção.");
        }
        grupo.mensagens.push(Mensagem.reconstituir({
          id: linha.mensagem_id,
          direcao: linha.mensagem_direcao,
          texto: linha.mensagem_texto,
          dataEnvio: linha.mensagem_data,
          remetente: linha.mensagem_direcao === "entrada" ? grupo.cliente :
              linha.mensagem_atendente_id !== null && linha.mensagem_atendente_id === linha.atendente_id &&
              linha.atendente_nome !== null && linha.atendente_email !== null
                  ? new Atendente(linha.atendente_id, linha.atendente_nome, linha.atendente_email,
                      statusDoAtendente(linha.atendente_status), linha.atendente_especialidade)
                  : CHATBOT_DAS_MENSAGENS,
          processado: linha.mensagem_processado ?? false,
          intencaoDetectada: linha.mensagem_intencao,
        }));
      }
    }

    return [...grupos.values()].map(({ linha, mensagens, cliente }) => {
      let atendente: Atendente | null = null;
      if (linha.atendente_id !== null) {
        if (linha.atendente_nome === null || linha.atendente_email === null) {
          throw new Error("Ticket persistido sem identidade completa do atendente.");
        }
        atendente = new Atendente(
            linha.atendente_id, linha.atendente_nome, linha.atendente_email,
            statusDoAtendente(linha.atendente_status), linha.atendente_especialidade
        );
      }
      const conversa = Conversa.reconstituir({
        id: linha.conversa_id,
        canal: null,
        cliente,
        chatbot: null,
        dataCriacao: linha.conversa_criada_em,
        dataFim: null,
        status: estadoDaConversa(linha.estado_conversa),
        estadoPersistido: linha.estado_conversa,
        mensagens,
      });
      return Ticket.reconstituir({
        id: linha.id,
        assunto: linha.assunto,
        prioridade: prioridadePersistida(linha.prioridade),
        status: statusPersistido(linha.status),
        dataAbertura: linha.data_abertura,
        dataFechamento: linha.data_fechamento,
        resumoBot: linha.resumo_bot,
        conversa,
        atendente,
        motivo: motivoPersistido(linha.motivo),
        dadosInformados: linha.dados ?? {},
      });
    });
  }
}