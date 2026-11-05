-- Fixture da primeira entrega da branch; nunca usar para instalar a aplicação.
ALTER TABLE conversas ADD COLUMN iniciada_em TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TABLE atendentes (id INT PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL);
CREATE TABLE tickets (
  protocolo TEXT PRIMARY KEY,
  conversa_id INT NOT NULL REFERENCES conversas(id),
  assunto TEXT NOT NULL,
  prioridade TEXT NOT NULL CHECK (prioridade IN ('ALTA', 'MEDIA', 'BAIXA')),
  status TEXT NOT NULL DEFAULT 'AGUARDANDO' CHECK (status IN ('AGUARDANDO', 'EM_ATENDIMENTO', 'ENCERRADO')),
  aberto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  fechado_em TIMESTAMPTZ,
  resumo_bot TEXT NOT NULL,
  atendente_id INT REFERENCES atendentes(id),
  CHECK ((status = 'AGUARDANDO' AND atendente_id IS NULL AND fechado_em IS NULL)
    OR (status = 'EM_ATENDIMENTO' AND atendente_id IS NOT NULL AND fechado_em IS NULL)
    OR (status = 'ENCERRADO' AND atendente_id IS NOT NULL AND fechado_em IS NOT NULL))
);
CREATE UNIQUE INDEX idx_ticket_aberto_conversa ON tickets (conversa_id) WHERE status <> 'ENCERRADO';
CREATE INDEX idx_ticket_fila ON tickets (status, prioridade, aberto_em);
