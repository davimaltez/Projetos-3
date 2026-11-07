-- História 2.1: o ticket passa a guardar por que o caso foi para a fila e o que o cliente já informou.
-- Tickets antigos receberam o padrão: até aqui toda transferência era pedido do cliente.
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS motivo text NOT NULL DEFAULT 'PEDIDO_DO_CLIENTE'
    CHECK (motivo IN ('PEDIDO_DO_CLIENTE', 'PERGUNTA_SEM_RESPOSTA', 'FALHAS_SEGUIDAS', 'DEMANDA_NAO_ENCONTRADA')),
  ADD COLUMN IF NOT EXISTS dados jsonb NOT NULL DEFAULT '{}'::jsonb;