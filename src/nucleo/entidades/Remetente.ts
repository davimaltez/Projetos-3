import type { TipoRemetente } from "./Enums.js";

/**
 * Quem pode enviar uma mensagem: Cliente, Atendente ou Chatbot.
 * A Mensagem TEM um Remetente (associação); ela não É um Remetente.
 */
export interface Remetente {
  /** Id como texto (plano da Dupla 1). Clientes e atendentes vêm de tabelas diferentes: o id sozinho pode repetir. */
  getId(): string;
  /**
   * null só para clientes antigos cadastrados sem nome (a coluna clientes.nome aceita NULL).
   * Atendente e Chatbot sempre têm nome.
   */
  getNome(): string | null;
  getTipo(): TipoRemetente;
  /** Identificação única entre todos os remetentes: "<tipo>:<id>" (ex.: "cliente:5"). */
  getIdentificacao(): string;
}
