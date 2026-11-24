-- História 3.3: nota de satisfação (1 a 5) pedida ao cliente quando o operador encerra o atendimento.
-- A média das notas respondidas entra no relatório do gestor.
-- PENDENTE: pergunta enviada, aguardando a resposta do cliente.
-- RESPONDIDA: o cliente mandou uma nota de 1 a 5.
-- DESCARTADA: o cliente respondeu outra coisa (seguiu para o atendimento normal) ou o envio falhou.
CREATE TABLE IF NOT EXISTS avaliacoes (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  nota SMALLINT CHECK (nota BETWEEN 1 AND 5),
  situacao TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (situacao IN ('PENDENTE', 'RESPONDIDA', 'DESCARTADA')),
  solicitada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  respondida_em TIMESTAMPTZ,
  CHECK ((situacao = 'RESPONDIDA') = (nota IS NOT NULL))
);

-- Busca da avaliação pendente quando chega uma mensagem do cliente.
CREATE INDEX IF NOT EXISTS idx_avaliacoes_pendentes
  ON avaliacoes (cliente_id, solicitada_em DESC) WHERE situacao = 'PENDENTE';
