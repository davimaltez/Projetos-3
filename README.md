# Projeto WXN Tecnologia

Projeto desenvolvido na disciplina de Projetos 3 da CESAR School, para o cliente WXN Tecnologia.

## Instituição

CESAR School

## Disciplina

Projetos 3 — Cliente: WXN Tecnologia

## Membros

- Ana Beatriz
- Brenno Dornelas
- Davi Maltez
- Gabriel Orrico
- Letícia Siqueira
- Luis Alves
- Luiz Lins
- Sofia Villela


## Entregáveis: 

[Docs](https://drive.google.com/drive/folders/1ykquLBLwWrdx76Ox1qSv1GSkKwa95A3F?usp=drive_link)

## Site: 

[Google Site](https://sites.google.com/view/g11projetos3/in%C3%ADcio)


---

# wxn-chatbot — esqueleto andante (WhatsApp via Baileys)

Grupo 11 · CESAR School x WXN Tecnologia · Projetos 3

Critério desta fatia: a mensagem recebida pelo WhatsApp é gravada, classificada
por IA (Gemini) em um dos tópicos de atendimento e respondida pelo caminho do
tópico — ou com o menu de opções, quando a IA não tem segurança. Continua de pé a entrega anterior:
`/` mostra a página "Hello World" (`interface/index.html`), `/status.html` a página de
status e `/estou-vivo` devolve o texto puro `estou vivo`.

## ⚠️ Leia antes de conectar qualquer número

O WhatsApp é conectado por [Baileys](https://github.com/WhiskeySockets/Baileys),
uma biblioteca **não oficial** que reimplementa o WhatsApp Web por engenharia
reversa. Os Termos de Serviço do WhatsApp proíbem clientes não oficiais e
automação: **o risco é o número ser banido**, sem aviso e sem recurso.

- **Nunca** conecte o número comercial da WXN nem o número pessoal de alguém do grupo.
- Use um **chip pré-pago novo, só para o bot** (ver "Qual número usar" abaixo).
- Isto serve para prototipar e demonstrar. Produção com a WXN — principalmente
  disparo de promoções — deve ir pela **Cloud API oficial**. O código já está
  preparado para essa troca (ver "Arquitetura").

## Qual número usar

| Papel | Número | Por quê |
|---|---|---|
| **Bot** (conectado via QR) | Chip pré-pago novo, dedicado | Se for banido, perde-se só um chip de ~R$10–20 |
| **Testador** (manda "oi") | Qualquer número pessoal do grupo | Conversar *com* o bot não coloca o seu número em risco |

Preparação do número do bot:

1. Coloque o chip num celular (pode ser um aparelho velho) e instale o
   **WhatsApp Business** (grátis) — perfil comercial, nome "Chatbot WXN (teste)".
2. **Aqueça o número por alguns dias** antes de conectar o bot: converse
   normalmente com 3–5 pessoas do grupo, entre e saia de conversas. Número
   recém-ativado que começa a responder automaticamente é o perfil que mais cai.
3. Defina **quem do grupo guarda o aparelho**. Só essa pessoa consegue
   escanear o QR de novo se a sessão cair.
4. O celular **não precisa ficar ligado o tempo todo** (o WhatsApp multi-aparelho
   mantém a sessão), mas precisa abrir o WhatsApp **pelo menos a cada ~14 dias**,
   senão os aparelhos conectados são desconectados automaticamente.

## Como a mensagem é decidida (IA + menu)

```
mensagem ──► é só um número? ──sim──► opção válida? ──sim──► caminho do tópico (sem IA)
                 │                         └──não──► "Não encontrei essa opção" + menu de novo (sem IA)
                 └──não──► Gemini classifica ──► tópico com confiança ≥ IA_CONFIANCA_MINIMA? ──sim──► caminho do tópico
                                   │                                    └──não / indefinido──► menu
                                   └── erro / timeout / sem chave ──────────────────────────► menu
```

- O Gemini **só escolhe o tópico** numa lista fechada (saída JSON com `enum`).
  Ele **não escreve a resposta ao cliente**: isso limita alucinação e injeção de prompt.
- Os tópicos ficam em `src/nucleo/Topicos.ts`. Tópicos 3 e 4 estão desligados
  (`ativo: false`) até a WXN informar as perguntas frequentes. O relatório (caminho 5)
  não aparece no menu do cliente (`somenteAdmin: true`).
- Os logs não mostram o telefone inteiro nem o texto completo: o número sai mascarado
  (`5581***99`) e do texto só saem os 40 primeiros caracteres, mais o tamanho.
- Toda resposta gera uma linha em `eventos` com o caminho, a origem da decisão
  (`menu`, `menu_invalido`, `ia`, `ia_incerta`, `ia_falhou`, `sem_ia`) e a confiança.
- Sem `GEMINI_API_KEY`, o bot funciona normalmente, só que sempre com o menu.
- Cada remetente pode mandar até `LIMITE_MENSAGENS_POR_MINUTO` mensagens por minuto (padrão 10;
  `0` desliga). Passou disso, o bot avisa **uma vez por minuto** (*"Recebi muitas mensagens em
  pouco tempo. Aguarde um momento e tente de novo."*) e ignora o resto, sem gravar nem chamar a IA.
  Isso protege a cota do Gemini e evita loop entre dois robôs.
- A mensagem é gravada **antes** de ser processada. Se algo cair no meio (WhatsApp ou banco), a
  entrada fica com `processado = f`; quando a mesma mensagem chegar de novo, ela é **reprocessada**.
  Risco aceito: se a queda vier depois do envio, a resposta pode sair repetida.
- Se o banco falhar antes de a mensagem ser gravada, o cliente recebe *"Estamos com instabilidade.
  Tente de novo em alguns minutos."*, no máximo 1 vez por minuto para cada remetente.

### Chave do Gemini

1. Crie a chave (grátis) em <https://aistudio.google.com/apikey>.
2. Coloque em `GEMINI_API_KEY` no `.env` e reinicie o bot (`npm run dev:bot`).
3. O log deve mostrar `[app] IA ativa: gemini:gemini-3.5-flash-lite`.

⚠️ **Dados de clientes:** no plano gratuito da API, o Google pode usar o conteúdo
enviado para melhorar seus produtos. Para testes com o grupo, tudo bem; antes de
usar com conversas reais de clientes da WXN, confirmem isso com o professor/cliente.

## "Digitando..." e linguagem (história 1.6)

- Assim que a mensagem é gravada, o bot mostra **"digitando..."** e mantém até a resposta sair.
- A duração acompanha o tamanho da resposta (~0,8 s + 25 ms por caractere, ±15% de variação),
  limitada por `DIGITANDO_MIN_MS` (1,5 s) e `DIGITANDO_MAX_MS` (4 s). O tempo gasto pelo
  Gemini já conta: se a IA levou 3 s, o bot não espera mais 3 s em cima.
- Resposta instantânea e sempre no mesmo tempo é um dos padrões que mais denunciam
  automação; o atraso variável também reduz o risco de banimento.
- Se o indicador falhar, a resposta sai do mesmo jeito (ele é só visual).
- `DIGITANDO_MIN_MS=0` e `DIGITANDO_MAX_MS=0` desligam indicador e atraso.
- Todos os textos para o cliente (`respostaProvisoria` em `Topicos.ts`, menu em `Menu.ts`)
  seguem a regra da história: linguagem simples, sem jargão técnico e sem gíria.

## Pré-requisitos

- Node.js **24** (o `.nvmrc` fixa; mínimo 22.12 — o Baileys é só ESM)
- Docker (apenas para o Postgres de desenvolvimento)
- O celular com o chip do bot, para escanear o QR

Não precisa de conta na Meta, token, webhook, ngrok nem HTTPS: o Baileys abre
uma conexão **de saída** com o WhatsApp.

## Rodando local

```bash
nvm use                 # Node 24
npm install
cp .env.example .env    # os valores padrão já servem para dev
npm run db:up           # sobe o Postgres e aplica db/schema.sql automaticamente
npm run dev:bot         # sobe o bot SEM reiniciar sozinho (ver a nota abaixo)
```

Um QR aparece no terminal. No celular do bot:
**WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho**.
Deve aparecer `[whatsapp] conectado com sucesso`. A sessão fica salva em
`auth_baileys/` e nas próximas vezes conecta sem QR.

> **`dev:bot` e não `dev`.** O `npm run dev` usa `tsx watch`: reinicia o programa a cada arquivo
> salvo, e cada reinício **reconecta o número ao WhatsApp**. Reconexões repetidas são um sinal
> ruim para banimento. Com o número real conectado, use `npm run dev:bot`; deixe o `dev` para
> quando estiver mexendo no código e aceitar reconectar a cada mudança.

## Teste de ponta a ponta

Do número **testador**, mande "oi" para o número do bot:

1. Mande "oi": deve voltar o **menu** (saudação é classificada como indefinida).
2. Mande "1": resposta do caminho 1, **sem** chamar a IA.
3. Mande "qual o andamento da minha demanda 42?": com a chave configurada, o log mostra
   `→ status_demanda (ia, confiança 0.9x)` e volta a resposta do caminho 1.
3. No banco:
   ```bash
   docker compose exec postgres psql -U postgres -d wxn \
     -c "SELECT id, direcao, texto, processado FROM mensagens ORDER BY id DESC LIMIT 5;"
   ```
   Cada mensagem gera uma `entrada` e uma `saida`, ambas `processado = t`. Para ver as decisões:
   ```bash
   docker compose exec postgres psql -U postgres -d wxn \
     -c "SELECT origem, fluxo, intencao, dados->>'confianca' AS conf FROM eventos ORDER BY id DESC LIMIT 5;"
   ```
4. `http://localhost:3000/status` → `{"whatsapp":true,"banco":true,"ia":true}`.

## Arquitetura

```
src/
├── app.ts                          # monta as classes e liga tudo (o único que escolhe implementações concretas)
├── config/Config.ts                # lê e valida o .env na subida
├── http/ServidorHttp.ts            # Express: /estou-vivo, /status e os arquivos estáticos
├── canais/
│   ├── RitmoDeDigitacao.ts         # quanto tempo dura o "digitando..." antes de cada resposta
│   └── whatsapp-baileys/
│       ├── CanalWhatsAppBaileys.ts # única classe que conhece o Baileys
│       └── PoliticaDeReconexao.ts  # quando tentar reconectar (10 rápidas, depois 1 a cada 10 min)
├── nucleo/                         # regra do bot + as INTERFACES de que ele precisa; não importa nada de fora
│   ├── Atendimento.ts              # regra do bot: menu → IA → caminho do tópico
│   ├── Topicos.ts                  # os 5 caminhos (ativos, rótulos, descrições para a IA)
│   ├── Menu.ts                     # texto do menu e leitura do número digitado
│   ├── LimitadorDeTaxa.ts          # "no máximo N por janela de tempo" para cada remetente
│   ├── PrivacidadeDeLog.ts         # telefone mascarado e texto resumido nos logs
│   ├── CanalMensagens.ts           # INTERFACE: o que qualquer canal precisa saber fazer
│   ├── ClassificadorDeIntencao.ts  # INTERFACE: o que o núcleo precisa de uma IA
│   └── Repositorios.ts             # INTERFACES: o que o núcleo precisa do armazenamento
├── ia/
│   └── ClassificadorGemini.ts      # única classe que conhece o Gemini
└── repositorios/                   # todo SQL mora aqui; cada classe implementa uma interface de nucleo/Repositorios.ts
    ├── BancoDeDados.ts             # dono do pool de conexões (com prazos)
    ├── ClienteRepositorio.ts
    ├── ConversaRepositorio.ts
    ├── MensagemRepositorio.ts
    └── EventoRepositorio.ts        # uma linha por resposta, base do relatório
```

Fora de `src/`, o `ServidorHttp` serve duas pastas com `express.static`: `interface/`
na raiz (`/` → `index.html`, `/status.html`, `/style.css`) e `assets/` em `/assets`. As rotas
explícitas (`/estou-vivo`, `/status`) são registradas **antes** dos estáticos, então nenhum
arquivo dessas pastas consegue substituí-las.

Dependências apontam para dentro: o `nucleo` define as interfaces de que precisa
(`CanalMensagens`, `ClassificadorDeIntencao` e os `RepositorioDe...` de `Repositorios.ts`) e **não
importa nada de fora dele**: nem Baileys, Gemini, Express ou `pg`, nem as pastas `canais/`, `ia/`,
`repositorios/`, `http/` e `config/`. São essas pastas que importam o núcleo e implementam suas
interfaces. Para migrar para a Cloud API oficial, cria-se
`canais/whatsapp-cloud/CanalWhatsAppCloud.ts` implementando `CanalMensagens` e troca-se **uma
linha** em `app.ts`.

Conceitos de POO usados: interface (`CanalMensagens`, `ClassificadorDeIntencao`,
`RepositorioDeMensagens` e as demais), polimorfismo (o `Atendimento` funciona com qualquer
implementação, inclusive uma em memória nos testes), encapsulamento (estado da conexão privado no
canal; a política de reconexão isolada em `PoliticaDeReconexao`), injeção de dependência pelo
construtor (até o `Menu` chega pronto ao `Atendimento`).

## Na VM (produção do MVP)

- Postgres **nativo** (sem Docker), porta 5432 só em `localhost`.
- `WHATSAPP_PASTA_SESSAO` apontando para fora da pasta do código
  (ex.: `/var/lib/wxn-chatbot/auth`), com permissão só para o usuário do serviço.
- `npm ci && npm run build && npm start` sob **pm2** ou **systemd** (reinicia se cair).
- O primeiro QR é escaneado olhando o log do serviço (`pm2 logs` / `journalctl -u ...`).
- Rode **uma única instância** com a mesma sessão. Duas instâncias com a mesma
  pasta de sessão derrubam uma à outra.
- Nginx + HTTPS **não são necessários para o WhatsApp** com Baileys; só se quiserem
  expor `/estou-vivo` com domínio e HTTPS. Atrás do nginx, use `HTTP_HOST=127.0.0.1` no `.env`:
  assim o servidor só aceita conexões da própria máquina (o padrão, `0.0.0.0`, aceita de qualquer
  lugar, o que expõe `/status` a quem alcançar a porta).

**Não rode o bot no Render Free:** o serviço hiberna após ~15 min sem acesso HTTP
(o WhatsApp desconecta e ninguém é respondido) e o disco é apagado a cada deploy
(a sessão some e exige novo QR).

## Erros comuns

| Sintoma | Causa provável |
|---|---|
| `Postgres não respondeu` na subida | `npm run db:up` não rodou, ou porta 5432 ocupada. O bot espera no máximo 5 s para conectar e 10 s por consulta; passou disso, a consulta falha em vez de travar |
| Cliente recebe *"Recebi muitas mensagens em pouco tempo"* | Ele passou de `LIMITE_MENSAGENS_POR_MINUTO`. Ajuste o valor no `.env` (ou `0` para desligar) |
| `Porta 3000 já está em uso` | Outro programa (ou outra cópia do bot) usa a porta. Feche-o ou mude `PORT` no `.env` |
| Erro de `.env` na subida (`PORT deve ser...`) | Uma variável tem valor fora do permitido; a mensagem diz qual e o que se espera |
| QR não aparece / sessão corrompida | `rm -rf auth_baileys && npm run dev:bot` |
| `sessão encerrada pelo celular` | Alguém removeu o aparelho no celular: apague `auth_baileys/` e escaneie de novo |
| `sessão aberta em outro lugar` | Outra instância rodando com a mesma sessão (VM + notebook). Deixe só uma |
| Reconectando várias vezes | O bot tenta de novo com espera crescente (2 s até 60 s, com variação) nas primeiras 10 tentativas. Se a conexão não voltar, o log avisa `modo lento` e ele passa a tentar **uma vez a cada ~10 minutos, sem parar**, até a conexão voltar (não precisa reiniciar). Se o número estiver limitado, **pare o bot** e espere; insistir piora |
| `acesso negado pelo WhatsApp (403)` | Número restrito ou banido. O bot **não** reconecta: confira o número no celular e espere antes de tentar de novo |
| `sessão inválida (500)` ou `incompatibilidade de multi-aparelho (411)` | Sessão corrompida. O bot não reconecta: apague `auth_baileys/` e escaneie o QR de novo |
| `classificador falhou, exibindo menu` | Chave inválida, sem internet, limite do plano gratuito ou timeout: o bot degrada para o menu |
| IA escolhe tópico errado | Ajuste a `descricao` do tópico em `Topicos.ts` ou suba `IA_CONFIANCA_MINIMA` |
| Mensagem chega mas não responde | Mensagem de grupo, status, canal, áudio, imagem, figurinha ou só com espaços — ignoradas de propósito no MVP (texto em conversas com mensagens temporárias **é** respondido) |
| Mudou `db/schema.sql` e nada mudou | O schema só roda com volume vazio: `npm run db:reset` (apaga dados de dev) |
