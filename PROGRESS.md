# 🚀 Relatório Automático de Progresso do Projeto

Aqui está a análise detalhada e estruturada do histórico de commits do repositório:

---

# Relatório de Evolução do Projeto: Chatbot

## 1. Resumo Geral
O projeto passou por uma evolução significativa dividida em quatro fases principais:
1. **Configuração e Interface Básica (Setembro/2026):** Criação do esqueleto da aplicação, documentação inicial e desenvolvimento do frontend (páginas estáticas, estilos e status).
2. **Integração de Comunicação e IA (Final de Setembro/2026):** Conexão com o WhatsApp via Baileys e integração com a API do Google Gemini para classificação de mensagens e simulação de digitação.
3. **Modelagem de Domínio e Entidades (Outubro/2026):** Definição robusta do núcleo do sistema com entidades para tickets, usuários, conversas, mensagens e contexto de menus.
4. **Fila de Atendimento Humano e Persistência (Outubro/2026):** Implementação de fila de atendimento (ordenação por prioridades, concorrência, histórico), inicialmente em memória com suíte de testes e posteriormente persistida em banco de dados PostgreSQL.

---

## 2. Atividades por Desenvolvedor

### **Brenno Dornelas (`BrennoDornelasMF`)**
* **Regras de Negócio e Fila de Atendimento:**
  * Definição dos contratos de entidades para suporte ao atendimento humano.
  * Implementação da lógica de fila em memória (atribuição, ordenação de tickets e histórico).
  * Criação de testes unitários cobrindo cenários de prioridade, concorrência e histórico sem dependência de banco.
* **Manutenção:** Exclusão de arquivos/documentos locais do versionamento (`.gitignore`).

### **brncluis**
* **Setup e Integrações Externas:**
  * Criação do esqueleto inicial do repositório.
  * Implementação da integração com WhatsApp via **Baileys**, classificação de mensagens via **Gemini** e feedback de digitação.
* **Modelagem:** Implementação das entidades `Remetente`, enums e classes `Cliente`, `Atendente` e `Chatbot`.

### **Davi Maltez**
* **Setup e Repositório:** Inicialização do repositório e adição de documentação (links de entregáveis).
* **Modelagem de Domínio:** Criação das entidades estruturais (`Chatbot`, `Cliente`, `Conversa`, `Evento`, `Mensagem`, `Remetente`, `Ticket`, `Usuario`).
* **Navegação e Menus:** Implementação do gerenciamento de contexto de menus através do `ContextoMenuRepositorio` e contratos associados.

### **Gabriel Orrico (`Gabrielorrico`)**
* **Banco de Dados e Persistência:** Implementação da persistência dos dados da fila de atendimento no **PostgreSQL**.

### **Letícia Siqueira**
* **Documentação:** Atualizações na documentação inicial (`README.md`).
* **Modelagem:** Implementação e estruturação das classes centrais `Mensagem`, `Ticket` e `Conversa`.

### **Luis Henrique Alves**
* **Documentação & DevOps:** Inclusão de instruções de implantação (*deployment*) e especificações no `README.md`.
* **Integração/Revisão:** Gerenciamento e aprovação de merges das principais branches (integração WhatsApp/Gemini e persistência da fila no Postgres).

### **Luiz Costa**
* **Revisão de Código:** Validação/aprovação de alterações de código (*LGTM*).

### **Sofia Villela**
* **Frontend / Interface do Usuário:**
  * Criação da página inicial e da página de status do chatbot.
  * Configuração dos estilos visuais (CSS/assets).
  * Refatoração para remover HTML *inline*, padronizando o servidor para arquivos estáticos e estruturando o diretório de `assets`.

---

## 3. Principais Destaques / Funcionalidades

### 💬 Mensageria e Inteligência Artificial
* Integração com a API do **WhatsApp via Baileys**.
* Classificação inteligente de intenções utilizando o **Google Gemini**.
* Simulação de digitação para melhorar a experiência do usuário.

### 🏛️ Arquitetura e Modelagem do Domínio
* Estruturação de entidades ricas: `Cliente`, `Atendente`, `Chatbot`, `Ticket`, `Conversa`, `Mensagem` e `Evento`.
* Mecanismo de persistência e repositórios para **controle de contexto de navegação por menus** (`ContextoMenuRepositorio`).

### 👥 Fila de Atendimento Humano
* **Lógica de Fila:** Atribuição dinâmica, ordenação por prioridades e histórico.
* **Cobertura de Testes:** Validações de condições de corrida/concorrência e cenários de fila sem dependência de infraestrutura externa.
* **Persistência Relacional:** Transição da fila em memória para armazenamento confiável em **PostgreSQL**.

### 🖥️ Interface e Usabilidade
* UI estática independente para monitoramento e apresentação (Landing Page e Página de Status).
* Organização modular de assets públicos.