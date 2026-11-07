-- Etapa 3: guarda o endereço opaco real do WhatsApp e atribui autor às respostas humanas.
-- Aplicada pelo MigradorDoBanco após as migrações da fila.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS endereco_resposta TEXT;
ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS atendente_id INTEGER REFERENCES atendentes(id);
CREATE INDEX IF NOT EXISTS idx_mensagens_atendente ON mensagens(atendente_id)
    WHERE atendente_id IS NOT NULL;
