import type { Pool } from "pg";
import { AtendenteNaoCadastradoError, TicketIndisponivelError, TicketNaoEncontradoError } from "../nucleo/ErrosDaFila.js";
import type { RepositorioDeFila } from "../nucleo/RepositorioDeFila.js";
import { Atendente } from "../nucleo/entidades/Atendente.js";
import { Chatbot } from "../nucleo/entidades/Chatbot.js";
import { Cliente } from "../nucleo/entidades/Cliente.js";
import { Conversa } from "../nucleo/entidades/Conversa.js";
import { Prioridade, StatusAtendente, StatusConversa, StatusTicket } from "../nucleo/entidades/Enums.js";
import { Mensagem } from "../nucleo/entidades/Mensagem.js";
import { Ticket } from "../nucleo/entidades/Ticket.js";

// Mantém o import antigo (`from "./RepositorioDeFilaPg.js"`) funcionando.
export { AtendenteNaoCadastradoError } from "../nucleo/ErrosDaFila.js";

/**
 * Hoje só o bot grava mensagens de saída (o atendente ainda não responde pelo sistema),
 * então toda mensagem 'saida' persistida tem o bot como remetente.
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
  mensagem_intencao: string | null;
}

// Uma consulta fornece um retrato consistente, sem uma ida ao banco por ticket/mensagem.
// O LATERAL seleciona a classificação mais recente da entrada, sem multiplicar o histórico.
const CONSULTA = `
  SELECT t.id, t.assunto, t.prioridade, t.status,
         t.data_abertura, t.data_fechamento, t.resumo_bot, t.conversa_id,
         c.criado_em AS conversa_criada_em, c.estado AS estado_conversa, c.cliente_id, cl.nome AS cliente_nome, cl.telefone AS cliente_telefone,
         t.atendente_id, a.nome AS atendente_nome, a.email AS atendente_email,
         a.status AS atendente_status, a.especialidade AS atendente_especialidade,
         m.id AS mensagem_id, m.texto AS mensagem_texto, m.criado_em AS mensagem_data,
         m.direcao AS mensagem_direcao, m.processado AS mensagem_processado,
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

/** Adaptador da fila; não cadastra atendentes nem cria/fecha tickets. */
export class RepositorioDeFilaPg implements RepositorioDeFila {
  constructor(private readonly pool: Pool) {}

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

  /** As linhas chegam na ordem dos tickets; o Map preserva essa ordem ao agrupar. */
  private async carregar(filtro: string, parametros: string[], ordem: string): Promise<Ticket[]> {
    const { rows } = await this.pool.query<LinhaTicket>(CONSULTA + filtro + ordem, parametros);
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
          remetente: linha.mensagem_direcao === "entrada" ? grupo.cliente : CHATBOT_DAS_MENSAGENS,
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
      });
    });
  }
}
