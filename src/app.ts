import { Config } from "./config/Config.js";
import { CanalWhatsAppBaileys } from "./canais/whatsapp-baileys/CanalWhatsAppBaileys.js";
import { PoliticaDeReconexao } from "./canais/whatsapp-baileys/PoliticaDeReconexao.js";
import type { CanalMensagens } from "./nucleo/CanalMensagens.js";
import { RitmoDeDigitacao } from "./canais/RitmoDeDigitacao.js";
import { Atendimento } from "./nucleo/Atendimento.js";
import { LimitadorDeTaxa } from "./nucleo/LimitadorDeTaxa.js";
import { Menu } from "./nucleo/Menu.js";
import { topicosDoMenu } from "./nucleo/Topicos.js";
import { BancoDeDados } from "./repositorios/BancoDeDados.js";
import { ClienteRepositorio } from "./repositorios/ClienteRepositorio.js";
import { ConversaRepositorio } from "./repositorios/ConversaRepositorio.js";
import { MensagemRepositorio } from "./repositorios/MensagemRepositorio.js";
import { EventoRepositorio } from "./repositorios/EventoRepositorio.js";
import type { ClassificadorDeIntencao } from "./nucleo/ClassificadorDeIntencao.js";
import { ClassificadorGemini } from "./ia/ClassificadorGemini.js";
import { ServidorHttp } from "./http/ServidorHttp.js";
import { ContextoMenuRepositorio } from "./repositorios/ContextoMenuRepositorio.js";
import type { GeradorDeResposta } from "./nucleo/GeradorDeResposta.js";
import { carregarManual } from "./ia/CarregadorDeManual.js";
import { GeradorGemini } from "./ia/GeradorGemini.js";

const UM_MINUTO_MS = 60_000;

/**
 * Ponto de montagem (composition root): o ÚNICO arquivo que cria as classes do sistema e
 * escolhe as implementações concretas. Todo o resto recebe dependências pelo construtor.
 * (Cada adaptador ainda cria o cliente da própria biblioteca, como o pg.Pool e o GoogleGenAI.)
 */
async function main(): Promise<void> {
  const config = Config.carregar();

  const banco = new BancoDeDados(config.databaseUrl);
  if (!(await banco.verificar())) {
    throw new Error("Postgres não respondeu. Rodou `npm run db:up`? DATABASE_URL está certa?");
  }

  // Migrar para a Cloud API oficial = trocar esta linha por outra implementação de CanalMensagens.
  const ritmo = new RitmoDeDigitacao(config.digitandoMinimoMs, config.digitandoMaximoMs);
  const canal: CanalMensagens = new CanalWhatsAppBaileys(config.pastaSessaoWhatsApp, ritmo, new PoliticaDeReconexao());

  // Sem chave: o bot continua funcionando, só que sempre responde com o menu.
  const classificador: ClassificadorDeIntencao | null = config.geminiApiKey
    ? new ClassificadorGemini(config.geminiApiKey, config.geminiModelo, config.geminiTimeoutMs)
    : null;
  console.log(
    classificador
      ? `[app] IA ativa: ${classificador.nome} (confiança mínima ${config.iaConfiancaMinima})`
      : "[app] GEMINI_API_KEY vazia: rodando sem IA, só com o menu"
  );

    // Gerador de respostas (opção "Outra dúvida"): precisa da chave do Gemini E do arquivo do manual.
  // Sem um dos dois, fica desligado e o bot segue só com menu e classificação.
  let gerador: GeradorDeResposta | null = null;
  if (config.geminiApiKey) {
    try {
      const manual = carregarManual(config.manualCaminho);
      gerador = new GeradorGemini(config.geminiApiKey, config.geradorModelo, config.geradorTimeoutMs, manual);
      console.log(`[app] gerador de respostas ativo: ${gerador.nome} (manual com ${manual.length} caracteres)`);
    } catch (erro) {
      console.warn("[app] gerador de respostas desligado:", erro instanceof Error ? erro.message : erro);
    }
  } else {
    console.log("[app] sem GEMINI_API_KEY: gerador de respostas desligado");
  }

  const atendimento = new Atendimento(
    canal,
    new ClienteRepositorio(banco.pool),
    new ConversaRepositorio(banco.pool),
    new MensagemRepositorio(banco.pool),
    new EventoRepositorio(banco.pool),
    new ContextoMenuRepositorio(banco.pool),   
    classificador,
    gerador,
    new Menu(topicosDoMenu()),
    {
      confiancaMinima: config.iaConfiancaMinima,
      // Avisos ("instabilidade", "muitas mensagens"): no máximo 1 por minuto para cada remetente.
      avisosDeInstabilidade: new LimitadorDeTaxa(1, UM_MINUTO_MS),
      avisosDeExcesso: new LimitadorDeTaxa(1, UM_MINUTO_MS),
      // 0 = sem limite de mensagens por remetente.
      limiteDeMensagens:
        config.limiteMensagensPorMinuto > 0 ? new LimitadorDeTaxa(config.limiteMensagensPorMinuto, UM_MINUTO_MS) : null,
    }
  );
  console.log(
    config.limiteMensagensPorMinuto > 0
      ? `[app] limite de ${config.limiteMensagensPorMinuto} mensagens por minuto para cada remetente`
      : "[app] sem limite de mensagens por remetente"
  );



  const http = new ServidorHttp(config.porta, config.httpHost, canal, banco, classificador !== null);
  await http.iniciar(); // porta ocupada = erro claro AQUI, antes de conectar o WhatsApp
  await canal.iniciar((mensagem) => atendimento.processar(mensagem));

  // Desligamento limpo (Ctrl+C, restart do pm2/systemd): fecha o WhatsApp
  // sem deslogar e devolve as conexões do banco.
  const encerrar = async (sinal: string) => {
    console.log(`\n[app] ${sinal} recebido, encerrando...`);
    await canal.encerrar();
    await http.encerrar();
    await banco.encerrar();
    process.exit(0);
  };
  process.once("SIGINT", () => void encerrar("SIGINT"));
  process.once("SIGTERM", () => void encerrar("SIGTERM"));
}

main().catch((erro) => {
  console.error("[app] falha na inicialização:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
