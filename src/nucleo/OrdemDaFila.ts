import { PrioridadeTicket } from "./entidades/Enums.js";
import type { Ticket } from "./entidades/Ticket.js";

/** Menor número = atendido antes. É a mesma ordem do índice idx_tickets_fila (db/schema.sql). */
export const ORDEM_DE_PRIORIDADE: Readonly<Record<PrioridadeTicket, number>> = {
  [PrioridadeTicket.URGENTE]: 0,
  [PrioridadeTicket.ALTA]: 1,
  [PrioridadeTicket.MEDIA]: 2,
  [PrioridadeTicket.BAIXA]: 3,
};

/** Ordem da fila: prioridade e, dentro dela, quem abriu antes (maior tempo de espera). */
export function compararNaFila(a: Ticket, b: Ticket): number {
  return (
    ORDEM_DE_PRIORIDADE[a.getPrioridade()] - ORDEM_DE_PRIORIDADE[b.getPrioridade()] ||
    a.getDataAbertura().getTime() - b.getDataAbertura().getTime()
  );
}
