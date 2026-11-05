-- Compatibilidade com a primeira versão da branch servico-de-fila (protocolo/aberto_em).
-- Bancos já atualizados pela 002 não precisam desta migração.
-- db:migrate identifica o layout e aplica somente o caminho apropriado.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';

-- A unicidade definida pela equipe é por conversa, inclusive tickets encerrados.
-- Se houver múltiplos tickets, falha e preserva tudo para reconciliação manual.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tickets GROUP BY conversa_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Migração 003: múltiplos tickets por conversa; reconcilie os registros antes de migrar.';
  END IF;
END;
$$;

ALTER TABLE tickets RENAME COLUMN protocolo TO id;
ALTER TABLE tickets RENAME COLUMN aberto_em TO data_abertura;
ALTER TABLE tickets RENAME COLUMN fechado_em TO data_fechamento;
ALTER TABLE tickets ALTER COLUMN data_abertura DROP DEFAULT;
ALTER TABLE tickets ADD CONSTRAINT tickets_conversa_unique UNIQUE (conversa_id);
ALTER TABLE tickets RENAME CONSTRAINT tickets_conversa_id_fkey TO tickets_conversa_fk;
ALTER TABLE tickets RENAME CONSTRAINT tickets_atendente_id_fkey TO tickets_atendente_fk;
ALTER TABLE tickets RENAME CONSTRAINT tickets_check TO tickets_estado_check;
ALTER TABLE tickets DROP CONSTRAINT tickets_prioridade_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_prioridade_check
  CHECK (prioridade IN ('URGENTE', 'ALTA', 'MEDIA', 'BAIXA'));
DROP INDEX idx_ticket_aberto_conversa;
DROP INDEX idx_ticket_fila;

ALTER TABLE atendentes ADD COLUMN status TEXT NOT NULL DEFAULT 'OFFLINE';
ALTER TABLE atendentes ADD COLUMN especialidade TEXT;
ALTER TABLE atendentes ADD CONSTRAINT atendentes_status_check
  CHECK (status IN ('DISPONIVEL', 'OCUPADO', 'OFFLINE'));

ALTER TABLE conversas ADD COLUMN criado_em TIMESTAMPTZ;
UPDATE conversas c SET criado_em = COALESCE(
  (SELECT min(m.criado_em) FROM mensagens m WHERE m.conversa_id = c.id), c.iniciada_em, c.atualizado_em);
ALTER TABLE conversas ALTER COLUMN criado_em SET DEFAULT now();
ALTER TABLE conversas ALTER COLUMN criado_em SET NOT NULL;
-- iniciada_em é preservada para não descartar informações da versão anterior.

CREATE INDEX idx_tickets_atendente ON tickets (atendente_id);
CREATE INDEX idx_tickets_fila ON tickets (
  (CASE prioridade WHEN 'URGENTE' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END),
  data_abertura, id
) WHERE status = 'AGUARDANDO';
CREATE INDEX idx_mensagens_conversa_historico ON mensagens (conversa_id, criado_em, id);
COMMIT;
