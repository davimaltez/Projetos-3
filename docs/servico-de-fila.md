# Serviço de fila de atendimento humano

O `ServicoDeFila` implementa as regras de consulta e assunção dos tickets das
histórias 3.1 e 3.2. Recebe `RepositorioDeFila` pelo construtor e não acessa banco,
WhatsApp, Gemini ou variáveis de ambiente.

## Operações

- `listarFila(): Promise<Ticket[]>`: retorna somente tickets `AGUARDANDO`, na
  ordem `URGENTE`, `ALTA`, `MEDIA`, `BAIXA`. Dentro de cada prioridade, a data de abertura
  mais antiga vem primeiro. Em empate de prioridade e data, preserva a ordem
  fornecida pelo repositório.
- `assumirTicket(ticketId, atendente): Promise<void>`: usa o protocolo como ID
  (`Ticket.getId()`), chama `RepositorioDeFila.atribuirAtendente(ticketId, atendente.getId())`,
  atribui o atendente e muda o ticket para `EM_ATENDIMENTO`. Uma segunda tentativa
  gera `TicketIndisponivelError`, inclusive pelo mesmo atendente. Tickets
  encerrados também são recusados; o responsável anterior é preservado.
- `obterHistoricoDoTicket(ticketId): Promise<Mensagem[]>`: retorna todas as
  mensagens da conversa associada em ordem cronológica, mantendo remetentes,
  datas e intenções. Não se limita ao resumo do bot. Uma conversa sem mensagens
  retorna `[]`; tickets encerrados continuam consultáveis.

As operações por ID lançam `TicketNaoEncontradoError` quando o protocolo não
existe. Autenticar o operador é responsabilidade da camada que chama o serviço.

## Armazenamento e concorrência

`RepositorioDeFilaEmMemoria` recebe os tickets iniciais e os atendentes cadastrados
no construtor, guarda-os em arrays e recusa protocolos duplicados.
`listarAguardando()` filtra e ordena como o repositório PostgreSQL. As listas são copiadas, mas as
entidades são compartilhadas por referência, como objetos de domínio mutáveis.
Cada nova instância inicia com os tickets fornecidos; não há persistência em disco.

O contrato exige que `atribuirAtendente` verifique o status e faça a atribuição
como uma operação indivisível. Na implementação em memória não há `await` entre
essas etapas, protegendo chamadas concorrentes ao mesmo repositório no processo.
Uma futura implementação PostgreSQL deve garantir a condição no próprio banco,
por exemplo com atualização condicional ou transação com bloqueio.

## Entidades de apoio

`Usuario` (abstrata) define identidade com id em texto, nome e e-mail. `Cliente`,
`Atendente` e `Chatbot` são classes que implementam `Remetente`
(`getId()`, `getNome()`, `getTipo()`, `getIdentificacao()`). Os enums estão em
`entidades/Enums.ts` (`PrioridadeTicket` inclui `URGENTE`; `Prioridade` é o nome
antigo do mesmo enum). Erros da fila: `ErrosDaFila.ts`; ordem da fila: `OrdemDaFila.ts`.

Esta entrega não conecta a fila ao fluxo de produção: cadastro de tickets no
armazenamento real, sincronização do estado da conversa, comandos do operador
no WhatsApp e avisos de posição/tempo de espera ainda precisam ser integrados.

## Validação

Com Node.js 24 e as dependências instaladas:

```bash
npm test
npm run typecheck
npm run build
```

Os testes usam datas fixas, identidades fictícias e armazenamento em memória.
Não precisam de `.env`, PostgreSQL ou sessão de WhatsApp. `npm test` também
executa os testes de menu existentes.
