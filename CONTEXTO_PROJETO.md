# 🤖 Contexto Técnico do Projeto para IA

Aqui está o documento de **Contexto Técnico para IA**, estruturado para servir como base de conhecimento e continuidade do desenvolvimento.

---

# 📄 Contexto Técnico de Arquitetura: Chatbot WhatsApp & Fila de Atendimento

## 🎯 1. Estado Atual do Sistema (System Context)

O sistema é uma plataforma de atendimento conversacional híbrido (Chatbot automatizado com suporte a transbordo para Atendimento Humano via Fila), construído em **Node.js/TypeScript**, integrado à API **WhatsApp (via Baileys)**, com classificação semântica de intenções utilizando o **Google Gemini** e persistência transacional em **PostgreSQL**.

### Funcionalidades Principais Ativas e Integradas:
1. **Conector WhatsApp (Baileys):**
   - Gestão de conexões com política de reconexão (`PoliticaDeReconexao`).
   - Simulação de digitação humana (`RitmoDeDigitacao`).
   - Rate limiting de mensagens recebidas (`LimitadorDeTaxa`) e conformidade com privacidade de logs (`PrivacidadeDeLog`).
2. **Motor de Atendimento & Classificação de Intenções:**
   - Navegação por menus e tópicos com persistência de estado/sessão (`ContextoMenuRepositorio`).
   - Classificação com IA via Google Gemini (`ClassificadorGemini`).
3. **Fila de Atendimento Humano (Clean Architecture / DDD Lite):**
   - Transbordo do bot para ticket humano ordenado por prioridade (`URGENTE` > `ALTA` > `MEDIA` > `BAIXA`) e tempo de espera (FIFO dentro da mesma prioridade).
   - Ordenação e filtragem delegadas diretamente ao banco de dados SQL (PostgreSQL) para escalabilidade.
   - Entidades ricas com validações: `Ticket`, `Conversa`, `Mensagem`, `Cliente`, `Atendente` e `Chatbot`, unificadas sob o contrato `Remetente`.
   - Implementação de dupla persistência: `RepositorioDeFilaPg` (PostgreSQL) e `RepositorioDeFilaEmMemoria` (para testes unitários rápidos).
   - Suíte de 115 testes automatizados (unitários e integração com Postgres) passando com 100% de sucesso.
4. **Interface Web de Monitoramento:**
   - Servidor HTTP Express servindo páginas estáticas para conferência de status da aplicação (`interface/index.html`, `interface/status.html`).

---

## 🛠️ Módulos e Arquivos Impactados

### `src/nucleo/` (Regras de Domínio e Casos de Uso)
- **`entidades/`**:
  - `Remetente.ts`: Interface base exigindo `getId(): string`, `getNome(): string`, `getTipo(): TipoRemetente` e `getIdentificacao()`.
  - `Usuario.ts`: Classe abstrata com validações de nome e e-mail.
  - `Cliente.ts`, `Atendente.ts`, `Chatbot.ts`: Implementações concretas de `Remetente` e extensões de `Usuario`.
  - `Conversa.ts`, `Mensagem.ts`: Gestão de histórico, timestamps (`dataEnvio`, `dataCriacao`), IDs tipados como string e flag de processamento.
  - `Ticket.ts`: Atribuição de atendentes, ciclo de vida e priorização.
  - `Enums.ts`: `TipoRemetente`, `PrioridadeTicket` (com `URGENTE`), `StatusAtendente`, `TipoAtendimento`, `StatusConversa`.
- **Serviços e Regras da Fila**:
  - `ServicoDeFila.ts`: Orquestração de entrada, atribuição e saída da fila.
  - `OrdemDaFila.ts` e `ErrosDaFila.ts`: Regras de ordenação desacopladas e exceções de domínio.
  - `RepositorioDeFila.ts`: Interface/Porta para persistência (`listarAguardando`, `buscarPorId`, `atribuirAtendente`).
- **Navegação & Segurança**:
  - `Atendimento.ts`, `Menu.ts`, `Topicos.ts`: Fluxos de conversa e menus navegáveis.
  - `LimitadorDeTaxa.ts`, `PrivacidadeDeLog.ts`: Proteção contra abusos e mascaramento de dados sensíveis.

### `src/canais/` (Infraestrutura de Mensageria)
- `whatsapp-baileys/CanalWhatsAppBaileys.ts`: Implementação do canal usando `@whiskeysockets/baileys`.
- `whatsapp-baileys/PoliticaDeReconexao.ts`: Backoff exponencial e recuperação de sessão.
- `RitmoDeDigitacao.ts`: Delay humanizado antes de despachar mensagens.

### `src/ia/` (Inteligência Artificial)
- `ClassificadorGemini.ts`: Integração com API Google Gemini para desvio automático de intenções não tratadas no menu fixo.

### `src/repositorios/` (Acesso a Dados / Adapters)
- `BancoDeDados.ts`: Pool de conexão Postgres (`pg`).
- `RepositorioDeFilaPg.ts`: Implementação SQL com joins complexos, ordenação condicional e reconstrução das entidades de domínio.
- `RepositorioDeFilaEmMemoria.ts`: Implementação em memória para testes e fallback.
- `ContextoMenuRepositorio.ts`: Cache/persistência do estado de navegação do menu por cliente.
- `ClienteRepositorio.ts`, `ConversaRepositorio.ts`, `MensagemRepositorio.ts`, `EventoRepositorio.ts`: CRUDs auxiliares.

### `db/` (Migrações e Schemas)
- `schema.sql`: Definição base de tabelas.
- `migrations/001_fila_atendimento_humano.sql`: Criação das tabelas de fila, tickets e atendentes.
- `migrations/002_fila_conforme_plano.sql`: Ajustes finos: `tickets.id` e `conversas.id` como texto, enum com `URGENTE`, coluna `criado_em`.
- `tests/fila.sql`: Scripts SQL puros para validação de integridade relacional.

### `interface/` & `src/http/` (Web/Status)
- `ServidorHttp.ts`: Servidor Express para health check e interface estática.
- `interface/index.html`, `interface/status.html`, `interface/style.css`, `assets/robozinho.png`.

---

## 👤 Histórico Técnico por Desenvolvedor

### **Luis Henrique Alves (brncluis)**
- **WhatsApp & Infra**: Implementou o canal Baileys completo com política de reconexão resiliente, ritmo de digitação e a integração do Google Gemini para NLP.
- **Refatoração do Domínio (Duplas 1 a 4)**: Alinhou as entidades (`Remetente`, `Usuario`, `Chatbot`, `Atendente`, `Cliente`) padronizando IDs como `string` e nomes sempre em texto.
- **Engine da Fila**: Implementou `OrdemDaFila`, `ErrosDaFila`, migração `002_fila_conforme_plano.sql` e ajustou `RepositorioDeFilaPg` para ordenação estrita em SQL, elevando a suíte para 115 testes funcionais.

### **Gabriel Orrico (Gabrielorrico)**
- **Persistência Relacional**: Criou a migração inicial `001_fila_atendimento_humano.sql` e a infraestrutura do `RepositorioDeFilaPg`.
- **Testes de Integração**: Desenvolveu testes de reconstituição de domínio a partir de dados relacionais (`ReconstituicaoDaFila.test.ts` e `RepositorioDeFilaPg.test.ts`) e o script `db/tests/fila.sql`.

### **Brenno Dornelas (BrennoDornelasMF)**
- **Contratos e Memória**: Definiu os contratos das entidades de atendimento humano e enums iniciais.
- **Serviço de Fila & Concorrência**: Criou a primeira versão do `ServicoDeFila.ts` e `RepositorioDeFilaEmMemoria.ts`, além de testes exaustivos cobrindo ordenação por prioridade, cenários de concorrência e histórico em memória.

### **Davi Maltez**
- **Gestão de Sessão do Bot**: Desenvolveu o `ContextoMenuRepositorio` e adaptou `Atendimento.ts`, `Menu.ts` e `Topicos.ts` para persistir o estado do usuário durante a árvore de decisão do bot.
- **DevOps/Scaffolding**: Criou as definições iniciais de entidades, scripts de automação de relatórios (`gerar-resumo.ts`, `PROGRESS.md`) e atuou na integração de branches via PRs.

### **Leticia Siqueira**
- **Entidades Centrais**: Implementou a estrutura base de classes de negócio em `Conversa.ts`, `Mensagem.ts` e `Ticket.ts`, definindo o fluxo de criação e associação de mensagens às conversas.

### **Sofia Villela**
- **Frontend / Status UI**: Estruturou o dashboard estático de status (`status.html`, `index.html`, estilização CSS e roteamento estático no Express em `src/app.ts`).

### **Luiz Costa**
- **Code Review**: Revisão e aprovação da camada de serviço de fila e testes unitários.

---

## ⚡ Bloco de Contexto Rápido para Prompts (Copy-Paste for LLM)

```yaml
PROJETO: Chatbot WhatsApp com Fila de Atendimento Humano
STACK: TypeScript (Node.js strict), Baileys (@whiskeysockets/baileys), PostgreSQL (pg), Gemini AI, Express, Jest.
ARQUITETURA: Clean Architecture / DDD Lite
  - src/nucleo: Entidades ricas, Serviços de Domínio (ServicoDeFila, Atendimento, Menu, Topicos), Casos de Uso.
  - src/repositorios: RepositorioDeFilaPg (Postgres com SQL otimizado), RepositorioDeFilaEmMemoria, ContextoMenuRepositorio.
  - src/canais: WhatsApp Baileys, RitmoDeDigitacao, PoliticaDeReconexao.
  - src/ia: ClassificadorGemini (intenções desconhecidas).

REGRAS DE DOMÍNIO CRÍTICAS:
  1. Identificadores: IDs de Conversa, Mensagem, Ticket, Remetente e Usuário são SEMPRE strings (UUIDs ou WhatsApp JIDs).
  2. Hierarquia de Remetentes: Chatbot, Atendente e Cliente implementam a interface Remetente (getId(), getNome(), getTipo(), getIdentificacao()).
  3. Fila de Transbordo:
     - Prioridades: URGENTE > ALTA > MEDIA > BAIXA.
     - Critério de Desempate: dataCriacao mais antiga (FIFO).
     - A ordenação e filtro são feitos a nível de banco (SQL ORDER BY no RepositorioDeFilaPg) e em memória via OrdemDaFila.ts.
  4. Atendimento Humano: Ao atribuir um atendente, o status do ticket muda para 'EM_ATENDIMENTO' e o atendente para 'OCUPADO'.

ESTADO DO BANCO (Migrations):
  - 001_fila_atendimento_humano.sql: Criação inicial das tabelas fila/atendimento.
  - 002_fila_conforme_plano.sql: Ajustes de tipagem texto para IDs, prioridade URGENTE e conversas.criado_em.

PRÓXIMOS PASSOS / DÍVIDAS TÉCNICAS:
  - Ligar o evento do Baileys diretamente ao gatilho de transbordo (transição Bot -> Fila Humana em runtime).
  - Webhook/Sockets ou endpoint para o atendente humano responder mensagens do WhatsApp via interface web.
  - Finalizar testes ponta a ponta (E2E) unindo CanalWhatsAppBaileys -> Menu -> Fila -> RepositorioDeFilaPg.
```