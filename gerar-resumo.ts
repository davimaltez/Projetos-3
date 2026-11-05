import { execSync } from 'node:child_process';
import fs from 'node:fs';
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('❌ ERRO CRÍTICO: GEMINI_API_KEY não encontrada no .env ou no ambiente!');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

// Função utilitária para aguardar entre tentativas
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function obterHistoricoGitDetalhado(limite = 25): string {
  try {
    return execSync(
      `git log -n ${limite} --stat --pretty=format:"---%nCOMMIT: %h%nAUTOR: %an <%ae>%nDATA: %ad%nMENSAGEM: %s%nDETALHES: %b" --date=short`,
      { encoding: 'utf-8' }
    );
  } catch (error) {
    console.error('❌ Erro ao ler o histórico do Git:', error);
    return '';
  }
}

async function gerarResumoIA(historicoGit: string): Promise<string> {
  const prompt = `
Você é um Arquiteto de Software Sênior analisando o progresso de um chatbot (TypeScript, Baileys/WhatsApp, Postgres).

Sua tarefa é ler o histórico detalhado de commits abaixo e gerar um documento de **Contexto Técnico para IA**. Esse documento será usado como contexto (system prompt ou memória) em futuras conversas com LLMs para continuarem o desenvolvimento do projeto.

---

### Estrutura Obrigatória do Documento de Saída (Markdown):

1. **🎯 Estado Atual do Sistema (System Context)**
   - Resumo técnico do estado do projeto até o momento.
   - Funcionalidades principais ativas e integradas.

2. **🛠️ Módulos e Arquivos Impactados**
   - Agrupe por área (ex: \`src/bot\`, \`src/database\`, \`src/routes\`, configurações, etc.) indicando o que foi criado, modificado ou refatorado com base nos commits e arquivos afetados.

3. **👤 Histórico Técnico por Desenvolvedor**
   - Nome do Desenvolvedor
   - Tarefas implementadas (detalhando aspectos técnicos como endpoints, esquemas de banco, tratamento de erros, eventos do Baileys, etc.)

4. **⚡ Bloco de Contexto Rápido para Prompts (Copy-Paste for LLM)**
   - Crie um bloco compacto e estruturado resumindo as regras de negócio já implementadas, dependências recentes e dívidas técnicas ou próximos passos implícitos nos commits.

---

Histórico Detalhado do Git:
${historicoGit}
`;

  const modelo = 'gemini-3.8-flash';
  const maxTentativas = 4;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      console.log(`🤖 Gerando contexto com '${modelo}' (Tentativa ${tentativa}/${maxTentativas})...`);
      const response = await ai.models.generateContent({
        model: modelo,
        contents: prompt,
      });

      if (response.text) {
        return response.text;
      }
    } catch (err: any) {
      const codigoErro = err?.status || err?.error?.code;
      const mensagemErro = err?.message || JSON.stringify(err);

      // Se for instabilidade de alta demanda (503), aguarda e tenta novamente
      if (codigoErro === 503 || mensagemErro.includes('high demand') || mensagemErro.includes('UNAVAILABLE')) {
        console.warn(`⏳ Servidor ocupado (503). Aguardando 3 segundos para tentar novamente...`);
        await sleep(3000);
      } else {
        console.error(`❌ Erro no modelo '${modelo}': ${mensagemErro}`);
        break; // Erros não-temporários param a execução
      }
    }
  }

  throw new Error('Serviço temporariamente indisponível após várias tentativas. Tente novamente em alguns instantes.');
}

async function main() {
  console.log('🔍 Lendo histórico de commits e arquivos alterados do Git...');
  const historico = obterHistoricoGitDetalhado(25);

  if (!historico) {
    console.log('Nenhum commit encontrado no repositório.');
    return;
  }

  try {
    const resumo = await gerarResumoIA(historico);
    fs.writeFileSync('CONTEXTO_PROJETO.md', `# 🤖 Contexto Técnico do Projeto para IA\n\n${resumo}`);
    console.log('\n✅ SUCESSO! O arquivo CONTEXTO_PROJETO.md foi gerado na raiz do projeto!');
  } catch (error: any) {
    console.error('\n💥 Erro final:', error.message);
  }
}

main();