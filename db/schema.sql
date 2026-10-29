-- Schema do MVP Chatbot WXN
-- Rode com: psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  telefone TEXT UNIQUE NOT NULL,
  nome TEXT,
  perfil TEXT NOT NULL DEFAULT 'externo', -- 'interno' | 'externo'
  origem TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversas (
  id SERIAL PRIMARY KEY,
  cliente_id INT NOT NULL REFERENCES clientes(id),
  estado TEXT NOT NULL DEFAULT 'BOT',
  fluxo TEXT,
  contexto JSONB NOT NULL DEFAULT '{}',
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Conversa.dataCriacao (plano da Dupla 2). Bancos existentes: migração 002.
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mensagens (
  id SERIAL PRIMARY KEY,
  conversa_id INT NOT NULL REFERENCES conversas(id),
  wamid TEXT UNIQUE,
  direcao TEXT NOT NULL, -- 'entrada' | 'saida'
  texto TEXT,
  processado BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msg_pendente ON mensagens (processado) WHERE processado = false;

CREATE TABLE IF NOT EXISTS eventos (
  id BIGSERIAL PRIMARY KEY,
  conversa_id INT NOT NULL,
  tipo TEXT NOT NULL,
  perfil TEXT,
  origem TEXT,
  fluxo TEXT,
  intencao TEXT,
  usou_llm BOOLEAN NOT NULL DEFAULT false,
  dados JSONB NOT NULL DEFAULT '{}',
  sintetico BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ev_tempo ON eventos (criado_em);
CREATE INDEX IF NOT EXISTS idx_ev_tipo ON eventos (tipo, criado_em);

CREATE TABLE IF NOT EXISTS conhecimento (
  id SERIAL PRIMARY KEY,
  pergunta TEXT NOT NULL,
  resposta TEXT NOT NULL,
  perfil TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS administradores (
  id SERIAL PRIMARY KEY,
  telefone TEXT UNIQUE NOT NULL,
  nome TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true
);

-- Etapa 3: fila humana. Este bloco é para instalação nova; bancos existentes
-- devem usar db/migrations/001_fila_atendimento_humano.sql e depois
-- db/migrations/002_fila_conforme_plano.sql (ver docs/migracao-fila.md).
BEGIN;
SET LOCAL search_path = public, pg_catalog;

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
  -- O id do ticket é o protocolo mostrado ao cliente.
  id TEXT CONSTRAINT tickets_pkey PRIMARY KEY,
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
    CHECK (prioridade IN ('URGENTE', 'ALTA', 'MEDIA', 'BAIXA')),
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

-- A ordem da fila não é alfabética: URGENTE, ALTA, MEDIA, BAIXA.
-- Mesma expressão usada pelo RepositorioDeFilaPg.listarAguardando().
CREATE INDEX idx_tickets_fila ON tickets (
  (CASE prioridade WHEN 'URGENTE' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END),
  data_abertura,
  id
) WHERE status = 'AGUARDANDO';

CREATE INDEX idx_mensagens_conversa_historico
  ON mensagens (conversa_id, criado_em, id);

COMMIT;

-- História 1.3: serviços contratados. Bancos existentes: migração 003
-- (db/migrations/003_servico_contratado.sql, ver docs/migracao-servico-contratado.md).
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
