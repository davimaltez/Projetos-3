# História 1.3 — schema e migração dos serviços contratados

Esta etapa adiciona a tabela `servicos_contratados`, de onde o bot lê o serviço
de cada cliente quando ele pergunta sobre o serviço atual (tópico
`servico_contratado`, caminho 3). Não cria tela de cadastro nem importação: os
serviços precisam ser inseridos por quem administra o banco.

## Modelo e decisões

- `cliente_id`: obrigatório, FK para `clientes(id)` com `ON DELETE RESTRICT`.
  Um cliente pode ter zero, um ou vários serviços.
- `nome` obrigatório e `descricao` opcional. Os dois são mostrados ao cliente
  como estão: escreva em linguagem simples, sem jargão (história 1.6).
- `status`: obrigatório, default `EM_DIA`; valores `EM_DIA`, `PENDENTE`,
  `SUSPENSO`, iguais ao tipo `StatusServico` em `src/nucleo/RepositorioDeServicos.ts`.
  O bot traduz para "em dia", "com pendência" e "suspenso".
- `data_inicio`: DATE obrigatória, sem default; o bot mostra como dd/mm/aaaa.
- `ativo`: default `true`. `false` = serviço encerrado; a linha fica guardada,
  mas o bot não mostra.
- O bot acha o cliente pela conversa (`conversas.cliente_id`), que já vem da
  identificação pelo número do WhatsApp.

Índice: parcial em `servicos_contratados(cliente_id) WHERE ativo`, a consulta
feita a cada pergunta.

## Instalação nova e banco existente

`db/schema.sql` só é executado pelo Docker Compose na primeira inicialização
de um volume vazio, e já inclui a tabela no final. Não remova o volume para
atualizar um banco existente: use a migração.

Diferente da 001, a 003 é idempotente (`IF NOT EXISTS`): reaplicar não dá
erro. Em compensação, se já existir uma `servicos_contratados` com outra
estrutura, ela é mantida como está, sem aviso. Confira a estrutura depois
(seção de verificação).

## Aplicação manual

1. Confirme o banco de destino e faça backup.
2. Use um `psql` com a conexão do ambiente autorizado (o comando não lê `.env`).

Na raiz do projeto:

```powershell
psql -X -v ON_ERROR_STOP=1 -f db/migrations/003_servico_contratado.sql
if ($LASTEXITCODE -ne 0) { throw "Migração não aplicada; verifique o erro do psql." }
```

Ou pelo serviço `postgres` do Compose:

```powershell
Get-Content -Raw -Encoding UTF8 db/migrations/003_servico_contratado.sql |
  docker compose exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "$POSTGRES_DB"'
if ($LASTEXITCODE -ne 0) { throw "Migração não aplicada; verifique o erro do psql." }
```

A migração controla `BEGIN/COMMIT`; não acrescente `--single-transaction`.
Ela não depende da 001 nem da 002, só da tabela `clientes`.

## Verificação sem alterar dados

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'servicos_contratados'
ORDER BY ordinal_position;

SELECT conname, pg_get_constraintdef(oid) AS definicao
FROM pg_constraint
WHERE conrelid = 'public.servicos_contratados'::regclass
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'servicos_contratados';
```

## Cadastrar um serviço (exemplo)

```sql
INSERT INTO servicos_contratados (cliente_id, nome, descricao, status, data_inicio)
SELECT id, 'Suporte Mensal', 'Atendimento técnico por telefone e WhatsApp.', 'EM_DIA', DATE '2025-03-10'
FROM clientes WHERE telefone = '5581999990001';
```

O telefone é o mesmo que o bot grava em `clientes.telefone` (DDI + DDD + número).

## Pendências

- Não há cadastro nem importação dos serviços reais da WXN.
- Os valores de `status` foram uma escolha desta etapa; confirmar com a WXN.
- A migração não foi executada em um Postgres nesta entrega.
