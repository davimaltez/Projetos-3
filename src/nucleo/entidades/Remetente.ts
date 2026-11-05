import type { TipoRemetente } from "./Enums.js";

/**
 * Quem pode enviar uma mensagem: Cliente, Atendente ou Chatbot.
 * A Mensagem TEM um Remetente (associação); ela não É um Remetente.
 */
export interface Remetente {
  /** Id como texto (plano da Dupla 1). Clientes e atendentes vêm de tabelas diferentes: o id sozinho pode repetir. */
  getId(): string;
  /** Nome para exibir. Cliente antigo cadastrado sem nome mostra o telefone. */
  getNome(): string;
  getTipo(): TipoRemetente;
  /** Identificação única entre todos os remetentes: "<tipo>:<id>" (ex.: "cliente:5"). */
  getIdentificacao(): string;
}
