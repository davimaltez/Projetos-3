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

function obterHistoricoGit(limite = 30): string {
  try {
    return execSync(
      `git log -n ${limite} --pretty=format:"Commit: %h | Autor: %an | Data: %ad | Mensagem: %s" --date=short`,
      { encoding: 'utf-8' }
    );
  } catch (error) {
    console.error('❌ Erro ao ler o histórico do Git:', error);
    return '';
  }
}

async function gerarResumoIA(historicoGit: string): Promise<string> {
  const prompt = `
Você é um assistente de documentação de projetos de software.
Abaixo está o histórico recente de commits de um repositório de desenvolvimento de um chatbot.

Analise as mensagens, os autores e agrupe as alterações de forma clara e profissional em formato Markdown.

Estruture a resposta da seguinte forma:
1. **Resumo Geral**: Uma breve visão geral do que evoluiu no projeto.
2. **Atividades por Desenvolvedor**: Tópicos com o nome de cada pessoa e o que ela realizou.
3. **Principais Destaques/Funcionalidades**: Novas features, correções de bugs ou melhorias de infraestrutura/documentação.

Histórico de Commits:
${historicoGit}
`;

  // Modelo indicado explicitamente pelo retorno da API
  const candidatos = ['gemini-3.8-flash', 'gemini-2.5-flash'];

  for (const modelo of candidatos) {
    try {
      console.log(`🤖 Gerando resumo com o modelo '${modelo}'...`);
      const response = await ai.models.generateContent({
        model: modelo,
        contents: prompt,
      });

      if (response.text) {
        console.log(`✨ Sucesso usando o modelo '${modelo}'!`);
        return response.text;
      }
    } catch (err: any) {
      const mensagemErro = err?.message || JSON.stringify(err);
      console.error(`❌ Falha no modelo '${modelo}': ${mensagemErro}`);
    }
  }

  throw new Error('Não foi possível gerar com os modelos testados.');
}

async function main() {
  console.log('🔍 Lendo histórico de commits do Git...');
  const historico = obterHistoricoGit(30);

  if (!historico) {
    console.log('Nenhum commit encontrado no repositório.');
    return;
  }

  try {
    const resumo = await gerarResumoIA(historico);
    fs.writeFileSync('PROGRESSO.md', `# 🚀 Relatório Automático de Progresso do Projeto\n\n${resumo}`);
    console.log('\n✅ SUCESSO! O arquivo PROGRESSO.md foi gerado na raiz do projeto!');
  } catch (error: any) {
    console.error('\n💥 Erro final:', error.message);
  }
}

main();