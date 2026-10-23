import type { Ticket } from "./entidades/Ticket.js";

/**
 * Persistência da fila (plano da Dupla 3), independente de banco ou canal de atendimento.
 * Erros possíveis: ver ErrosDaFila.ts.
 */
export interface RepositorioDeFila {
  /**
   * Somente tickets AGUARDANDO, ordenados por prioridade (URGENTE, ALTA, MEDIA, BAIXA) e,
   * dentro dela, pela data de abertura (quem espera há mais tempo primeiro).
   * Cada ticket vem com a conversa e o histórico completo. Devolve uma lista própria.
   */
  listarAguardando(): Promise<Ticket[]>;

  /** O id do ticket é o protocolo. Inclui a conversa e seu histórico completo; null se não existir. */
  buscarPorId(id: string): Promise<Ticket | null>;

  /**
   * Verifica o status e atribui como uma única operação indivisível, inclusive entre
   * instâncias do serviço: o ticket passa a EM_ATENDIMENTO com esse atendente.
   * - TicketNaoEncontradoError: o ticket não existe;
   * - TicketIndisponivelError: o ticket não está mais AGUARDANDO (nada é alterado);
   * - AtendenteNaoCadastradoError: o atendente não existe no cadastro (nada é alterado).
   * Uma implementação SQL deve garantir isso no banco (transação ou atualização
   * condicional); uma leitura seguida de gravação sem proteção não é suficiente.
   */
  atribuirAtendente(ticketId: string, atendenteId: string): Promise<void>;
}
