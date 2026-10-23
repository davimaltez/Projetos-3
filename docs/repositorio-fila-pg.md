# Etapa 4 — RepositorioDeFilaPg

O adaptador recebe o `pg.Pool` existente. Não altera schema, serviço, interface,
cadastro de operadores ou montagem da aplicação.

## Operações

- `listar()`: carrega todos os estados com uma única consulta. O serviço continua
  filtrando e ordenando por prioridade/abertura. Protocolo fornece ordem estável
  ao repositório, inclusive para empates na ordenação do serviço.
- `obterPorId(protocolo)`: usa parâmetro SQL, retorna Ticket ou null. A consulta
  inclui conversa, cliente, responsável e todas as mensagens, mesmo pendentes,
  anteriores à abertura ou pertencentes a tickets encerrados.
- `atribuirSeAguardando(protocolo, atendente)`: usa um único PoolClient e uma
  transação; bloqueia o ticket com FOR UPDATE, verifica o estado no banco, confere
  a identidade do atendente com FOR SHARE e faz UPDATE condicional. Duas conexões
  disputando a mesma linha permitem só um vencedor.

Ticket inexistente/indisponível retorna false, sem consultar/modificar o cadastro.
O método não muda disponibilidade do atendente nem estado da conversa.

**Precondição:** o atendente deve estar cadastrado com o mesmo ID, nome e e-mail.
Ausência gera `AtendenteNaoCadastradoError`; divergência gera
`IdentidadeAtendenteDivergenteError`. Não há atualização automática do cadastro.
Essa verificação não autentica o operador; autenticação permanece na camada chamadora.

Erros de conexão, SQL e integridade são propagados. Após adquirir a conexão,
falhas tentam ROLLBACK; finally libera o cliente. Se o rollback também falhar,
a conexão é descartada e o erro original é preservado.

## Reconstituição e contratos

Fábricas `reconstituir` em Ticket, Conversa e Mensagem restauram dados sem chamar
atribuir/fechar/encerrar/transferir, gerar protocolos ou substituir datas pelo relógio.
Datas e arrays são copiados. A associação conversa-ticket é recomposta sem mudar
o estado da conversa. Os construtores posicionais e transições normais mantêm
o comportamento anterior; as sobrecargas de estado são usadas pelas fábricas.

Contratos de leitura que passam a admitir null:

| Entidade | Getters |
|---|---|
| Conversa | getCanal(), getDataInicio(), getStatus() |
| Mensagem | getConteudo(), getRemetente(), getIntencaoDetectada() |
| Cliente | getNome(), getEmail() |

Usuario tem parâmetro genérico com padrão string: Atendente mantém nome/e-mail
estaticamente completos. Cliente admite a variante histórica string ou null.
A busca dos consumidores em src encontrou uso do conteúdo no resumo de Conversa
e comparações nos testes; o resumo agora inclui somente conteúdos conhecidos.
ServicoDeFila usa datas de mensagens e tickets, que continuam obrigatórias.
Nenhum teste anterior foi alterado.

Campos ausentes:

- Canal, início/fim da conversa e chatbot ficam null. atualizado_em, data do
  ticket ou primeira mensagem não são tratados como datas reais da conversa.
- O cliente conserva seu ID e nome disponível; e-mail fica null. Não se criam
  endereços fictícios nem se usa telefone como nome.
- Entrada identifica o cliente vinculado à conversa. Saídas ficam com remetente
  null: não se presume bot nem responsável atual do ticket.
- Texto SQL NULL é distinto de texto vazio. Mensagem mantém o ID e a direção
  originais, acessíveis pelos novos getters getId()/getDirecao().
- Intenção vem do evento real mais recente do tipo resposta, da mesma conversa,
  associado por dados.mensagemId (desempate por eventos.id). Eventos sintéticos
  são ignorados. Ausência ou classificação nula produz null, sem substituição por "".
  A associação existe para mensagens de entrada; não é inferida para saídas.
- Estado BOT é traduzido para COM_BOT. Estados reconhecidos são mantidos.
  Estado desconhecido produz getStatus() = null e permanece integralmente em
  getEstadoPersistido(). Não se infere estado da conversa pelo ticket.
- Datas conhecidas usam Date, com a precisão de milissegundos do JavaScript.

O carregamento usa uma única instrução SQL, portanto relações e histórico vêm do
mesmo snapshot. Mensagens são ordenadas por criado_em e id. O JOIN LATERAL evita
duplicar mensagens quando há múltiplos eventos. Em filas muito grandes, a consulta
ainda carrega todos os históricos: paginação/resumos exigiriam outro contrato.
A associação a eventos em JSONB também pode exigir otimização futura do schema.

## Testes

`npm test` executa os testes existentes e os novos testes de reconstituição.
A suíte de integração fica explicitamente ignorada quando FILA_PG_TEST não é 1.

Para habilitar a integração, configure externamente as variáveis abaixo, sem
carregar .env nem versionar credenciais:

- FILA_PG_TEST=1
- FILA_PG_TEST_DATABASE=wxn_fila_teste (qualquer outro banco é recusado)
- FILA_PG_TEST_HOST / FILA_PG_TEST_PORT (padrões: 127.0.0.1 e 5432)
- FILA_PG_TEST_USER / FILA_PG_TEST_PASSWORD: identidade de teste autorizada

O usuário precisa criar/remover seus próprios schemas no banco de testes.
Cada caso cria um schema fila_pg_test_<UUID>, instala o schema SQL somente nele
e o remove ao terminar. Nenhuma tabela public, banco ou volume é apagado.
Se o processo for interrompido, um schema de teste pode permanecer; identifique
sua propriedade e o UUID antes de qualquer limpeza manual.

Execute na raiz:

```powershell
npm test
npm run typecheck
```

A integração testa todos os estados, ausências históricas, protocolo textual,
histórico/intenções, ordenação do serviço, cadastro divergente, persistência entre
instâncias, erros e rollback. A corrida usa dois backends distintos, retidos por
uma terceira conexão até ambos disputarem o bloqueio; não depende apenas da
velocidade de duas promises. Falha de integridade após UPDATE é injetada por
trigger exclusivamente no schema descartável.

## Riscos e decisões pendentes

- Consumidores futuros dos getters históricos precisam tratar null.
- Não há mecanismo de salvar alterações feitas nos objetos retornados; só a
  atribuição solicitada ao repositório é persistida nesta etapa.
- Cadastro/IDs, autenticação, disponibilidade dos atendentes, criação/fechamento
  de tickets e sincronização da conversa continuam sob responsabilidade da equipe.
- Uma conversa encerrada pode ter dataFim desconhecida; null sozinho não indica
  que a conversa continua aberta.
- Metadados que nunca foram persistidos não podem ser recuperados por este adaptador.
- O repositório ainda não foi conectado ao app.ts; a integração de produção deve
  respeitar essas precondições e o pool compartilhado.
