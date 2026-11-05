-- Migração 002: ajusta a fila ao plano das duplas.
--   * tickets.protocolo passa a se chamar tickets.id (o valor continua sendo o protocolo);
--   * prioridade aceita URGENTE, e o índice da fila atende URGENTE antes de ALTA;
--   * conversas ganha criado_em (Conversa.dataCriacao).
-- Pré-requisito: migração 001 aplicada. Executar uma única vez com
--   psql -X -v ON_ERROR_STOP=1 -f db/migrations/002_fila_conforme_plano.sql
-- Não usar --single-transaction: este arquivo já controla a transação.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'protocolo'
  ) THEN
    RAISE EXCEPTION 'Migração 002: tickets.protocolo não encontrada. A 001 foi aplicada? A 002 já foi aplicada?';
  END IF;
END;
$$;

ALTER TABLE tickets RENAME COLUMN protocolo TO id;

ALTER TABLE tickets DROP CONSTRAINT tickets_prioridade_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_prioridade_check
  CHECK (prioridade IN ('URGENTE', 'ALTA', 'MEDIA', 'BAIXA'));

DROP INDEX idx_tickets_fila;
CREATE INDEX idx_tickets_fila ON tickets (
  (CASE prioridade WHEN 'URGENTE' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END),
  data_abertura,
  id
) WHERE status = 'AGUARDANDO';

-- Conversas antigas recebem como criação a data da primeira mensagem; sem mensagens,
-- ficam com a última atualização (melhor estimativa disponível).
ALTER TABLE conversas ADD COLUMN criado_em TIMESTAMPTZ;
UPDATE conversas c
   SET criado_em = COALESCE(
     (SELECT min(m.criado_em) FROM mensagens m WHERE m.conversa_id = c.id),
     c.atualizado_em
   );
ALTER TABLE conversas ALTER COLUMN criado_em SET DEFAULT now();
ALTER TABLE conversas ALTER COLUMN criado_em SET NOT NULL;

COMMIT;
