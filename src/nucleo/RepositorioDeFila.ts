import type { Atendente } from "./entidades/Atendente.js";
import type { Ticket } from "./entidades/Ticket.js";

/** Persistência necessária à fila, independente de banco ou canal de atendimento. */
export interface RepositorioDeFila {
  /** Retorna uma lista própria; filtrar e ordenar a fila é responsabilidade do serviço. */
  listar(): Promise<Ticket[]>;

  /** O identificador do ticket é seu protocolo. Inclui a conversa e seu histórico completo. */
  obterPorId(ticketId: string): Promise<Ticket | null>;

  /**
   * Verifica o status e atribui como uma única operação indivisível, inclusive entre
   * instâncias do serviço. Retorna false se não existir ou não estiver AGUARDANDO.
   * Nesse caso, não altera o ticket nem seu responsável.
   * Uma implementação SQL deve garantir isso no banco (transação ou atualização
   * condicional); uma leitura seguida de gravação sem proteção não é suficiente.
   */
  atribuirSeAguardando(ticketId: string, atendente: Atendente): Promise<boolean>;
}
