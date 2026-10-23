import type { Pool } from "pg";
import type { RepositorioDeFila } from "../nucleo/RepositorioDeFila.js";
import { Atendente } from "../nucleo/entidades/Atendente.js";
import { Cliente } from "../nucleo/entidades/Cliente.js";
import { Conversa } from "../nucleo/entidades/Conversa.js";
import { Prioridade, StatusAtendente, StatusConversa, StatusTicket } from "../nucleo/entidades/Enums.js";
import { Mensagem } from "../nucleo/entidades/Mensagem.js";
import { Ticket } from "../nucleo/entidades/Ticket.js";

export class AtendenteNaoCadastradoError extends Error {
  constructor(id: number | string) {
    super(`Atendente ${id} não cadastrado. Cadastre a identidade antes da atribuição.`);
    this.name = "AtendenteNaoCadastradoError";
  }
}

export class IdentidadeAtendenteDivergenteError extends Error {
  constructor(id: number | string) {
    super(`A identidade recebida para o atendente ${id} diverge do cadastro.`);
    this.name = "IdentidadeAtendenteDivergenteError";
  }
}

interface LinhaTicket {
  protocolo: string;
  assunto: string;
  prioridade: string;
  status: string;
  data_abertura: Date;
  data_fechamento: Date | null;
  resumo_bot: string;
  conversa_id: number;
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
  mensagem_intencao: string | null;
}

// Uma consulta fornece um retrato consistente, sem uma ida ao banco por ticket/mensagem.
// O LATERAL seleciona a classificação mais recente da entrada, sem multiplicar o histórico.
const CONSULTA = `
  SELECT t.protocolo, t.assunto, t.prioridade, t.status,
         t.data_abertura, t.data_fechamento, t.resumo_bot, t.conversa_id,
         c.estado AS estado_conversa, c.cliente_id, cl.nome AS cliente_nome, cl.telefone AS cliente_telefone,
         t.atendente_id, a.nome AS atendente_nome, a.email AS atendente_email,
         a.status AS atendente_status, a.especialidade AS atendente_especialidade,
         m.id AS mensagem_id, m.texto AS mensagem_texto, m.criado_em AS mensagem_data,
         m.direcao AS mensagem_direcao, classificacao.intencao AS mensagem_intencao
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

  async listar(): Promise<Ticket[]> {
    return this.carregar();
  }

  async obterPorId(ticketId: string): Promise<Ticket | null> {
    return (await this.carregar(ticketId))[0] ?? null;
  }

  async atribuirSeAguardando(ticketId: string, atendente: Atendente): Promise<boolean> {
    const client = await this.pool.connect();
    let erroDeRollback: Error | undefined;
    try {
      await client.query("BEGIN");
      const ticket = await client.query<{ status: string }>(
        "SELECT status FROM tickets WHERE protocolo = $1 FOR UPDATE", [ticketId]
      );
      if (ticket.rows[0]?.status !== StatusTicket.AGUARDANDO) {
        await client.query("COMMIT");
        return false;
      }

      // O cadastro é precondição explícita. Não sobrescrevemos nome/e-mail.
      // FOR SHARE impede mudança de identidade/exclusão até o COMMIT.
      const cadastro = await client.query<{ nome: string; email: string }>(
        "SELECT nome, email FROM atendentes WHERE id = $1 FOR SHARE", [atendente.getId()]
      );
      const identidade = cadastro.rows[0];
      if (!identidade) throw new AtendenteNaoCadastradoError(atendente.getId());
      if (identidade.nome !== atendente.getNome() || identidade.email !== atendente.getEmail()) {
        throw new IdentidadeAtendenteDivergenteError(atendente.getId());
      }

      const atribuicao = await client.query(
        `UPDATE tickets SET status = 'EM_ATENDIMENTO', atendente_id = $2
         WHERE protocolo = $1 AND status = 'AGUARDANDO'`,
        [ticketId, atendente.getId()]
      );
      if (atribuicao.rowCount !== 1) {
        throw new Error("A atribuição não atualizou o ticket bloqueado.");
      }
      await client.query("COMMIT");
      return true;
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

  private async carregar(ticketId?: string): Promise<Ticket[]> {
    const filtro = ticketId === undefined ? "" : " WHERE t.protocolo = $1";
    const { rows } = await this.pool.query<LinhaTicket>(
      CONSULTA + filtro + " ORDER BY t.protocolo, m.criado_em, m.id",
      ticketId === undefined ? [] : [ticketId]
    );
    const grupos = new Map<string, { linha: LinhaTicket; mensagens: Mensagem[]; cliente: Cliente }>();
    for (const linha of rows) {
      let grupo = grupos.get(linha.protocolo);
      if (!grupo) {
        grupo = {
          linha, mensagens: [],
          // clientes não tem coluna de e-mail: o cliente reconstituído fica sem e-mail.
          cliente: new Cliente(linha.cliente_id, linha.cliente_nome, null, linha.cliente_telefone),
        };
        grupos.set(linha.protocolo, grupo);
      }
      if (linha.mensagem_id !== null) {
        if (linha.mensagem_data === null || linha.mensagem_direcao === null) {
          throw new Error("Mensagem persistida sem data ou direção.");
        }
        grupo.mensagens.push(Mensagem.reconstituir({
          id: linha.mensagem_id,
          direcao: linha.mensagem_direcao,
          conteudo: linha.mensagem_texto,
          dataHora: linha.mensagem_data,
          remetente: linha.mensagem_direcao === "entrada" ? grupo.cliente : null,
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
        dataInicio: null,
        dataFim: null,
        status: estadoDaConversa(linha.estado_conversa),
        estadoPersistido: linha.estado_conversa,
        mensagens,
      });
      return Ticket.reconstituir({
        protocolo: linha.protocolo,
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
