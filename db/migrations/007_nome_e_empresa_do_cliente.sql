-- História 2.1: o operador vê nome e empresa do cliente sem precisar perguntar de novo.
-- clientes.nome já existia (preenchido agora com o nome de perfil do WhatsApp);
-- a empresa é perguntada uma única vez pelo bot e guardada aqui.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS empresa TEXT;
