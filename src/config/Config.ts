import "dotenv/config";

interface LimitesNumericos {
  minimo?: number;
  maximo?: number;
  inteiro?: boolean;
}

/**
 * Lê e valida as variáveis de ambiente UMA vez, na subida.
 * Falhar aqui (com mensagem clara) é melhor do que descobrir
 * a variável faltando, ou com valor absurdo, só quando a primeira mensagem chegar.
 */
export class Config {
  readonly porta: number;
  /** Endereço em que o servidor HTTP escuta. "0.0.0.0" = todas as interfaces. */
  readonly httpHost: string;
  readonly databaseUrl: string;
  readonly pastaSessaoWhatsApp: string;
  /** undefined = sem IA: o bot funciona só com o menu. */
  readonly geminiApiKey: string | undefined;
  readonly geminiModelo: string;
  readonly geminiTimeoutMs: number;
  readonly iaConfiancaMinima: number;
  /** Mensagens aceitas por minuto de cada remetente; 0 = sem limite. */
  readonly limiteMensagensPorMinuto: number;
  readonly digitandoMinimoMs: number;
  readonly digitandoMaximoMs: number;

  private constructor(env: NodeJS.ProcessEnv) {
    this.digitandoMinimoMs = Config.numero(env, "DIGITANDO_MIN_MS", 1_500, { minimo: 0 });
    this.digitandoMaximoMs = Config.numero(env, "DIGITANDO_MAX_MS", 4_000, { minimo: 0 });
    if (this.digitandoMaximoMs < this.digitandoMinimoMs) {
      throw new Error("DIGITANDO_MAX_MS deve ser maior ou igual a DIGITANDO_MIN_MS.");
    }
    this.porta = Config.numero(env, "PORT", 3000, { minimo: 1, maximo: 65_535, inteiro: true });
    this.httpHost = env.HTTP_HOST?.trim() || "0.0.0.0";
    this.databaseUrl = Config.obrigatoria(env, "DATABASE_URL");
    this.pastaSessaoWhatsApp = env.WHATSAPP_PASTA_SESSAO?.trim() || "./auth_baileys";
    this.geminiApiKey = env.GEMINI_API_KEY?.trim() || undefined;
    this.geminiModelo = env.GEMINI_MODELO?.trim() || "gemini-3.5-flash-lite";
    this.geminiTimeoutMs = Config.numero(env, "GEMINI_TIMEOUT_MS", 8_000, { minimo: 1, inteiro: true });
    this.iaConfiancaMinima = Config.numero(env, "IA_CONFIANCA_MINIMA", 0.6, { minimo: 0, maximo: 1 });
    this.limiteMensagensPorMinuto = Config.numero(env, "LIMITE_MENSAGENS_POR_MINUTO", 10, { minimo: 0, inteiro: true });
  }

  static carregar(env: NodeJS.ProcessEnv = process.env): Config {
    return new Config(env);
  }

  private static obrigatoria(env: NodeJS.ProcessEnv, nome: string): string {
    const valor = env[nome];
    if (!valor) {
      throw new Error(`Variável de ambiente ${nome} não definida. Copie .env.example para .env.`);
    }
    return valor;
  }

  /** Vazia ou ausente = padrão. Preenchida com algo fora do que faz sentido = erro na subida. */
  private static numero(env: NodeJS.ProcessEnv, nome: string, padrao: number, limites: LimitesNumericos = {}): number {
    const bruto = env[nome];
    if (bruto === undefined || bruto.trim() === "") return padrao;

    const valor = Number(bruto);
    if (!Number.isFinite(valor)) throw new Error(`${nome} deve ser um número (recebido: "${bruto}").`);
    if (limites.inteiro && !Number.isInteger(valor)) {
      throw new Error(`${nome} deve ser um número inteiro (recebido: "${bruto}").`);
    }

    const { minimo, maximo } = limites;
    if ((minimo !== undefined && valor < minimo) || (maximo !== undefined && valor > maximo)) {
      const faixa =
        minimo !== undefined && maximo !== undefined
          ? `um valor entre ${minimo} e ${maximo}`
          : minimo !== undefined
            ? `maior ou igual a ${minimo}`
            : `menor ou igual a ${maximo}`;
      throw new Error(`${nome} deve ser ${faixa} (recebido: "${bruto}").`);
    }
    return valor;
  }
}
