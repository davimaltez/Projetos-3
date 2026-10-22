import type { Remetente } from "./Remetente.js";

/** Identidade do bot associado à conversa; não executa chamadas de IA. */
export interface Chatbot extends Remetente {
  getId(): number;
  getNome(): string;
}
