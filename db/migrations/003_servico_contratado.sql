-- Migração 003: serviços contratados por cada cliente (história 1.3).
--   * cria servicos_contratados, ligada a clientes, de onde o bot lê o serviço de quem pergunta.
-- Pré-requisito: tabela clientes do schema original. Idempotente: pode ser reaplicada sem erro
-- (IF NOT EXISTS), mas NÃO corrige uma tabela já existente com outra estrutura.
-- Executar com
--   psql -X -v ON_ERROR_STOP=1 -f db/migrations/003_servico_contratado.sql
-- Não usar --single-transaction: este arquivo já controla a transação.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clientes' AND column_name = 'id' AND udt_name = 'int4'
  ) THEN
    RAISE EXCEPTION 'Migração 003: tabela public.clientes ausente ou com id incompatível.';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS servicos_contratados (
  id SERIAL CONSTRAINT servicos_contratados_pkey PRIMARY KEY,
  cliente_id INTEGER NOT NULL,
  -- Nome e descrição são mostrados ao cliente: linguagem simples (história 1.6).
  nome TEXT NOT NULL,
  descricao TEXT,
  status TEXT NOT NULL DEFAULT 'EM_DIA',
  data_inicio DATE NOT NULL,
  -- false = serviço encerrado; fica guardado, mas o bot não mostra.
  ativo BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT servicos_contratados_cliente_fk
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT,
  CONSTRAINT servicos_contratados_status_check
    CHECK (status IN ('EM_DIA', 'PENDENTE', 'SUSPENSO'))
);

-- Consulta do bot: serviços ativos de um cliente.
CREATE INDEX IF NOT EXISTS idx_servicos_cliente_ativos
  ON servicos_contratados (cliente_id) WHERE ativo;

COMMIT;
