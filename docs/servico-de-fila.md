# Fila de atendimento humano

O `ServicoDeFila` é criado em `src/app.ts` com um
`RepositorioDeFilaPg`. A mesma instância é injetada no `Atendimento` e no
`ServidorHttp`: pedidos recebidos pelo WhatsApp geram tickets que o operador
consegue listar, assumir e consultar por HTTP.

## Fluxo do cliente

1. O menu principal oferece `3 - Falar com um atendente`. O comando `atendente`
   também funciona dentro de qualquer submenu, sem IA. Se houver Gemini, pedidos
   em linguagem natural podem ser classificados como `atendimento_humano`.
2. A mensagem de entrada é registrada antes do processamento. Ao transferir, o
   repositório cria um ticket com protocolo UUID, prioridade `MEDIA`, resumo do
   histórico e estado `AGUARDANDO`. A conversa passa a `AGUARDANDO_ATENDENTE`.
3. O cliente recebe a confirmação com seu protocolo. Novos pedidos explícitos
   reutilizam o ticket aberto. Reentregas da mesma mensagem já processada são
   ignoradas; uma falha de envio permite nova tentativa sem duplicar o ticket.
4. Enquanto aguarda ou está em atendimento, novas mensagens continuam sendo
   registradas e ficam disponíveis no histórico. O bot não envia menus nem
   consulta a IA para esses detalhes. Pedidos explícitos repetidos recebem o
   protocolo e o estado atual.
5. Quando um operador assume, ticket e conversa passam a `EM_ATENDIMENTO`, com o
   responsável identificado pela credencial HTTP.

Mensagens do mesmo remetente são processadas em sequência no processo para
preservar a navegação do menu. O banco protege a criação e a assunção dos tickets
entre instâncias diferentes. Prioridade e data de abertura determinam a ordem:
`URGENTE`, `ALTA`, `MEDIA`, `BAIXA`, com os mais antigos primeiro dentro da prioridade.

## Preparação do banco

Com Node.js 24, ative `.local-tools/activate.sh` se existir. Para um banco novo,
`npm run db:up` aplica o schema na primeira inicialização do volume. Para um banco
já existente, execute:

```bash
npm run db:migrate
```

Esse comando reconhece o estado do banco e usa `db/schema.sql` para instalação
nova ou as migrações 001 e 002 para bancos legados. Pode ser reaplicado: bancos já
atualizados pela equipe são apenas verificados. A migração 003 atende exclusivamente
a primeira versão da branch `servico-de-fila`, preservando seus registros e
adaptando os nomes das colunas ao padrão da equipe. Tudo ocorre em uma transação.
Conversas antigas recebem `criado_em` a partir da primeira mensagem ou da última
atualização; não se inventa uma nova data quando há histórico disponível.
O comando não inicia WhatsApp, HTTP ou Gemini. Não é necessário usar `db:reset`.

A aplicação verifica a estrutura da fila antes de conectar o WhatsApp e indica
`db:migrate` se ela não estiver disponível.

## Autenticação do operador

Configure `OPERADORES_HTTP_JSON` no `.env` local como uma lista de operadores.
Cada item possui `id` numérico positivo, `nome`, `email` e um `token` individual
com pelo menos 32 caracteres sem espaços. IDs e tokens devem ser únicos.
Gere tokens com `openssl rand -hex 32`; há um exemplo de formato em `.env.example`.

Na inicialização, as identidades configuradas são cadastradas na tabela
`atendentes`, preservando status e especialidade existentes. A atribuição exige
esse cadastro, conforme o contrato adotado pela equipe.

O token identifica o operador. O corpo da requisição não escolhe o responsável.
As credenciais são comparadas por hash em tempo constante e não são devolvidas
nas respostas. Rotas da fila retornam `503` quando não há operadores configurados
e `401` quando a credencial está ausente ou inválida. Use HTTPS ao expor a API.
Todos os operadores configurados podem consultar a fila e seus históricos.

## API do operador

| Método e rota | Resultado |
| --- | --- |
| `GET /fila` | Tickets aguardando, em ordem de prioridade e chegada, com protocolo, assunto, datas, conversa e resumo |
| `POST /tickets/:protocolo/assumir` | Atribui o operador autenticado e devolve protocolo, status e ID do responsável |
| `GET /tickets/:protocolo/historico` | Todas as mensagens da conversa em ordem cronológica, com conteúdo, data, remetente e intenção registrada |

Use o cabeçalho `Authorization: Bearer <token>`. Por exemplo, com uma variável
`TOKEN_OPERADOR` definida no terminal:

```bash
curl -H "Authorization: Bearer $TOKEN_OPERADOR" http://localhost:3000/fila
curl -X POST -H "Authorization: Bearer $TOKEN_OPERADOR" \
  http://localhost:3000/tickets/PROTOCOLO/assumir
curl -H "Authorization: Bearer $TOKEN_OPERADOR" \
  http://localhost:3000/tickets/PROTOCOLO/historico
```

Protocolos inexistentes retornam `404`; tickets já assumidos ou encerrados,
`409` na assunção. Falhas internas retornam `500` sem detalhes do banco.
As respostas das rotas de operador usam `Cache-Control: no-store`.
`/estou-vivo`, `/status` e a interface estática continuam disponíveis sem essas
credenciais; não foi criado um painel web.

## Persistência e concorrência

A criação bloqueia a conversa e verifica se já existe um ticket aberto. A restrição
`UNIQUE(conversa_id)` também impede duplicação, inclusive para tickets encerrados. Ticket, estado da conversa e evento de
transferência são gravados na mesma transação. A assunção usa bloqueio do ticket
e atualização condicional do ticket `AGUARDANDO`; estado e evento de assunção
também são gravados na transação. Falhas desfazem todas essas mudanças.

O histórico é reconstruído das tabelas `mensagens` e `eventos`, incluindo mensagens
anteriores à transferência e novos detalhes enviados durante a espera ou o
atendimento. A consulta funciona após reiniciar o serviço. O resumo salvo na
abertura não substitui o histórico completo.

`RepositorioDeFilaEmMemoria` continua disponível para testes sem serviços
externos. Recebe tickets, atendentes cadastrados e conversas iniciais no construtor. Suas entidades
mantêm identidade; as listas são cópias.

## Validação

```bash
npm test
npm run typecheck
npm run build
```

Os testes padrão usam canal simulado, armazenamento em memória e HTTP local em
porta temporária. Não carregam `.env` nem iniciam WhatsApp. Para incluir testes
com PostgreSQL, forneça explicitamente uma URL de teste:

```bash
FILA_TEST_DATABASE_URL='postgresql://USUARIO:SENHA@localhost:PORTA/BANCO_TESTE' npm test
```

O teste cria e remove apenas um schema aleatório próprio nesse banco. Valida
migração sobre dados existentes, criação concorrente, persistência entre pools,
assunção simultânea via HTTP, rollback e histórico após a transferência.
A suíte PostgreSQL da equipe usa `FILA_PG_TEST=1` e exige o banco
`wxn_fila_teste` (parâmetros `FILA_PG_TEST_HOST`, `FILA_PG_TEST_PORT`,
`FILA_PG_TEST_USER`, `FILA_PG_TEST_PASSWORD`, `FILA_PG_TEST_DATABASE`).
Sem as variáveis, as respectivas integrações são puladas. Nunca usa `DATABASE_URL` como
alternativa nem acessa uma sessão de WhatsApp.

## Limites desta integração

O acesso do operador ocorre por HTTP. Envio de respostas humanas ao WhatsApp,
encerramento/reabertura por comando, transferência automática por falhas
repetidas, avisos de posição/tempo de espera e satisfação ficam para as próximas
histórias. Não há transferência automática apenas porque a IA ficou incerta:
nesse caso, o menu continua sendo oferecido.
