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
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
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
