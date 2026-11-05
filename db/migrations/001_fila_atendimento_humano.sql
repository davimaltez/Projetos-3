-- Migração 001: persistência da fila de atendimento humano.
-- Pré-requisito: schema original do WXN no schema public (PostgreSQL 16).
-- Executar uma única vez com psql -X -v ON_ERROR_STOP=1 -f este_arquivo.
-- Não usar --single-transaction: este arquivo já controla a transação.
-- Objetos preexistentes com os nomes abaixo são conflitos, inclusive em reaplicação.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';

-- Exige as seis tabelas legadas antes de modificar a estrutura.
DO $$
DECLARE
  tabela TEXT;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'clientes', 'conversas', 'mensagens', 'eventos', 'conhecimento', 'administradores'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = tabela AND c.relkind = 'r'
    ) THEN
      RAISE EXCEPTION 'Migração 001: tabela public.% ausente ou incompatível.', tabela;
    END IF;
  END LOOP;

  -- Tipos usados pelos novos relacionamentos e pelo índice de histórico.
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND (
      (table_name = 'conversas' AND column_name = 'id' AND udt_name = 'int4')
      OR (table_name = 'mensagens' AND column_name IN ('id', 'conversa_id') AND udt_name = 'int4')
      OR (table_name = 'mensagens' AND column_name = 'criado_em' AND udt_name = 'timestamptz')
    )
  ) <> 4 THEN
    RAISE EXCEPTION 'Migração 001: tipos/colunas de conversas ou mensagens incompatíveis com o schema original.';
  END IF;
END;
$$;

-- Identidade fornecida pela aplicação; não gera outro ID para um Atendente existente.
CREATE TABLE atendentes (
  id INTEGER CONSTRAINT atendentes_pkey PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OFFLINE',
  especialidade TEXT,
  CONSTRAINT atendentes_status_check
    CHECK (status IN ('DISPONIVEL', 'OCUPADO', 'OFFLINE'))
);

CREATE TABLE tickets (
  protocolo TEXT CONSTRAINT tickets_pkey PRIMARY KEY,
  conversa_id INTEGER NOT NULL,
  atendente_id INTEGER,
  assunto TEXT NOT NULL,
  prioridade TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AGUARDANDO',
  data_abertura TIMESTAMPTZ NOT NULL,
  data_fechamento TIMESTAMPTZ,
  resumo_bot TEXT NOT NULL,
  CONSTRAINT tickets_conversa_unique UNIQUE (conversa_id),
  CONSTRAINT tickets_conversa_fk
    FOREIGN KEY (conversa_id) REFERENCES conversas(id) ON DELETE RESTRICT,
  CONSTRAINT tickets_atendente_fk
    FOREIGN KEY (atendente_id) REFERENCES atendentes(id) ON DELETE RESTRICT,
  CONSTRAINT tickets_prioridade_check
    CHECK (prioridade IN ('ALTA', 'MEDIA', 'BAIXA')),
  CONSTRAINT tickets_status_check
    CHECK (status IN ('AGUARDANDO', 'EM_ATENDIMENTO', 'ENCERRADO')),
  CONSTRAINT tickets_estado_check CHECK (
    (status = 'AGUARDANDO' AND atendente_id IS NULL AND data_fechamento IS NULL)
    OR
    (status = 'EM_ATENDIMENTO' AND atendente_id IS NOT NULL AND data_fechamento IS NULL)
    OR
    (status = 'ENCERRADO' AND atendente_id IS NOT NULL AND data_fechamento IS NOT NULL)
  )
);

-- UNIQUE(conversa_id) já cria o índice desse relacionamento.
CREATE INDEX idx_tickets_atendente ON tickets (atendente_id);

-- A ordem do enum não é alfabética: ALTA, MEDIA, BAIXA.
-- Disponível para consultas SQL futuras; o serviço atual continua ordenando a fila.
CREATE INDEX idx_tickets_fila ON tickets (
  (CASE prioridade WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END),
  data_abertura,
  protocolo
) WHERE status = 'AGUARDANDO';

CREATE INDEX idx_mensagens_conversa_historico
  ON mensagens (conversa_id, criado_em, id);

COMMIT;
