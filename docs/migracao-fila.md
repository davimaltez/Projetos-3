# Etapa 3 — schema e migração da fila

Esta etapa adiciona `atendentes`, `tickets` e índices. Não implementa o
repositório PostgreSQL, não altera entidades e não conecta a fila à aplicação.

## Modelo e decisões

- `atendentes.id`: INTEGER fornecido pelo cadastro/aplicação, sem sequência.
  Preserva o ID recebido por `Atendente`/`Usuario`.
- Nome e e-mail obrigatórios, sem unicidade de e-mail.
- Status do atendente obrigatório, com default `OFFLINE`; valores:
  `DISPONIVEL`, `OCUPADO`, `OFFLINE`. Especialidade é opcional.
  Não é possível inferir disponibilidade a partir do cadastro.
- `tickets.protocolo`: TEXT e chave primária; aceita protocolos não UUID.
- Conversa obrigatória e única por ticket: cada conversa pode ter zero ou um
  ticket, inclusive considerando tickets encerrados.
- Atendente opcional enquanto aguarda; um atendente pode ter vários tickets.
  As FKs usam `ON DELETE RESTRICT` para preservar os vínculos históricos.
- Prioridades: `ALTA`, `MEDIA`, `BAIXA`. Estados: `AGUARDANDO` (default),
  `EM_ATENDIMENTO`, `ENCERRADO`, iguais aos enums TypeScript.
- Abertura obrigatória, sem default: o gravador deve usar a data da entidade.
  Datas são TIMESTAMPTZ. Resumo é obrigatório, mas pode ser vazio.
- CHECK conjunto: aguardando exige atendente/fechamento nulos; em atendimento
  exige atendente e fechamento nulo; encerrado exige ambos.
- Não se acrescentou uma regra temporal de fechamento >= abertura, nem regras
  de ocupação automática do atendente: não estão definidas nas entidades atuais.

Índices: as PKs e `UNIQUE(conversa_id)` já cobrem protocolo, ID do atendente e
busca de ticket por conversa. Há um índice separado em `tickets.atendente_id`,
um índice parcial da fila aguardando com prioridade numérica, abertura e protocolo,
e um índice em `mensagens(conversa_id, criado_em, id)` para histórico com desempate.
O índice da fila prepara consultas futuras; não muda a ordenação do serviço atual.

## Instalação nova e banco existente

`db/schema.sql` continua montado pelo Docker Compose em
`/docker-entrypoint-initdb.d/01-schema.sql`. A imagem PostgreSQL executa esse
diretório somente na primeira inicialização de um volume vazio.
Não remova o volume para atualizar um banco existente.

Para instalações novas, o schema completo inclui as novas estruturas. Para um
banco já inicializado com as seis tabelas originais, use apenas
`db/migrations/001_fila_atendimento_humano.sql`.

O bloco DDL das novas tabelas e índices é igual nos dois arquivos. A migração
valida as tabelas legadas e os tipos necessários, usa transação e não faz DML.
Não contém `IF NOT EXISTS` nas criações: objetos preexistentes provocam erro,
inclusive em reaplicação. Isso evita aceitar silenciosamente estruturas distintas.
A validação prévia cobre os pré-requisitos usados por esta etapa; não substitui
uma auditoria de todas as colunas legadas.

## Aplicação manual, somente após autorização

1. Confirme o banco de destino e a versão PostgreSQL 16; faça backup e valide
   como restaurá-lo. Não coloque credenciais em arquivos versionados ou comandos.
2. Agende uma janela: criar o índice de mensagens pode bloquear gravações
   durante sua construção. `lock_timeout = '5s'` limita a espera para adquirir
   bloqueios, não o tempo total de construção.
3. Use um cliente `psql` com parâmetros de conexão fornecidos pelo ambiente
   autorizado ou serviço libpq. O comando abaixo pressupõe essa configuração;
   não carrega `.env`.

Na raiz do projeto:

```powershell
psql -X -v ON_ERROR_STOP=1 -f db/migrations/001_fila_atendimento_humano.sql
if ($LASTEXITCODE -ne 0) { throw "Migração não aplicada; verifique o erro do psql." }
```

Alternativa usando o serviço `postgres` já existente no Compose, sem expor os
valores de usuário/senha e sem copiar a migração para o container:

```powershell
Get-Content -Raw -Encoding UTF8 db/migrations/001_fila_atendimento_humano.sql |
  docker compose exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "$POSTGRES_DB"'
if ($LASTEXITCODE -ne 0) { throw "Migração não aplicada; verifique o erro do psql." }
```

Confirme antes o destino configurado no Compose. Nenhum desses comandos deve ser
executado como parte de testes no banco de desenvolvimento.

A migração controla `BEGIN/COMMIT`; não acrescente `--single-transaction`.
Com `ON_ERROR_STOP`, uma falha termina o psql e a transação é desfeita. Não
continue manualmente a partir de uma instrução intermediária. Em erro de objeto
duplicado, inspecione se a migração já foi aplicada ou se há uma definição
conflitante; não apague objetos nem acrescente `IF NOT EXISTS` para forçar sucesso.

Registre a aplicação da versão 001 no controle de implantação da equipe. Não há
executor automático de migrações nesta etapa.

## Verificação sem alterar dados

Execute estas consultas na conexão autorizada, após a aplicação:

```sql
SELECT current_database(), current_schema(), version();

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('atendentes', 'tickets')
ORDER BY table_name, ordinal_position;

SELECT conrelid::regclass AS tabela, conname, pg_get_constraintdef(oid) AS definicao
FROM pg_constraint
WHERE conrelid IN ('public.atendentes'::regclass, 'public.tickets'::regclass)
ORDER BY tabela, conname;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('atendentes', 'tickets', 'mensagens')
ORDER BY tablename, indexname;
```

Devem existir as seis tabelas originais e as duas novas, com PKs, duas FKs,
unicidade de conversa, CHECKs e índices descritos acima. Compare os dados legados
com o backup/levantamento anterior; a migração não deve alterá-los.

Para validar restrições, use `db/tests/fila.sql` **somente em banco de testes
isolado** depois do schema ou da migração. O teste cria dados fictícios e termina
com ROLLBACK; sequências podem avançar mesmo com rollback.

```powershell
psql -X -v ON_ERROR_STOP=1 -f db/tests/fila.sql
if ($LASTEXITCODE -ne 0) { throw "Validação SQL falhou." }
```

Valide também que instalação nova e atualização do schema original têm os mesmos
catálogos de colunas, restrições e índices; reaplicação/conflitos devem falhar sem
deixar criação parcial. Não há script de reversão que apague as novas tabelas:
se houver problema na aplicação, preserve os registros e planeje uma correção.

## Validação realizada nesta entrega

Validação em instância temporária isolada do PostgreSQL 18.6, encerrada ao final:

- Schema novo e migração executaram sem erros de sintaxe.
- Colunas, restrições e índices foram comparados entre instalação nova e migrada.
- Dados fictícios preexistentes nas seis tabelas, suas colunas, restrições, índices
  originais e valores das sequências foram preservados.
- `db/tests/fila.sql` passou nos dois bancos, incluindo as 12 combinações de
  estado/responsável/fechamento, PKs, FKs, UNIQUE, nulabilidade e inserts legados.
- Reaplicação, tabela conflitante, tipo de coluna incompatível e schema ausente
  falharam sem deixar alterações parciais.
- O bloco SQL novo é idêntico entre schema/migração e os enums foram comparados
  com o TypeScript. A verificação de tipos sem emissão de arquivos passou.

Docker/PostgreSQL 16 não estavam disponíveis neste ambiente. O SQL usa recursos
documentados no PostgreSQL 16, mas a execução nessa versão ainda precisa ser
confirmada em ambiente isolado antes da aplicação. Nenhuma migração foi aplicada
ao banco atual do projeto.

## Pendências para a próxima etapa

- `Atendente` ainda não expõe status/especialidade. O default permite persistir
  sua identidade atual, mas a gestão desses atributos precisa ser alinhada.
- A equipe precisa definir a origem dos IDs e o cadastro dos atendentes.
- `Ticket` e `Conversa` ainda não restauram estados/datas históricas pela API
  pública; não usar `fechar()` ou `encerrar()` para reconstituir datas antigas.
- O schema legado não identifica completamente remetentes bot/humano nem
  armazena todos os atributos exigidos por Cliente/Conversa/Mensagem. Esta etapa
  não preenche informações desconhecidas nem modifica essas tabelas.
- A unicidade de conversa é global, conforme UML. Os testes em memória que criam
  tickets distintos com a mesma conversa precisarão de fixtures com conversas
  diferentes nos futuros testes PostgreSQL.
- A atribuição atômica continua sendo responsabilidade do futuro repositório;
  os CHECKs, sozinhos, não impedem sobrescrever um responsável válido.
- O serviço e a interface continuam inalterados; integração, criação e fechamento
  persistidos de tickets não fazem parte desta etapa.

Referências: [inicialização da imagem PostgreSQL](https://hub.docker.com/_/postgres)
[restrições no PostgreSQL 16](https://www.postgresql.org/docs/16/ddl-constraints.html)
e [índices no PostgreSQL 16](https://www.postgresql.org/docs/16/sql-createindex.html).
