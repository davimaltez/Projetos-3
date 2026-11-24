import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export interface OpcoesDosCodigos {
  /** Quanto tempo o código vale depois de emitido. */
  readonly validadeMs: number;
  /** Tentativas erradas aceitas antes de o código ser invalidado. */
  readonly maximoDeTentativas: number;
  /** Intervalo mínimo entre duas emissões para a mesma pessoa (evita encher a caixa de e-mail). */
  readonly intervaloEntreEmissoesMs: number;
}

export const OPCOES_PADRAO_DOS_CODIGOS: OpcoesDosCodigos = {
  validadeMs: 10 * 60_000,
  maximoDeTentativas: 5,
  intervaloEntreEmissoesMs: 60_000,
};

export const DIGITOS_DO_CODIGO = 6;

export type ResultadoDaEmissao =
  | { readonly tipo: "emitido"; readonly codigo: string }
  | { readonly tipo: "aguarde"; readonly segundos: number };

export type ResultadoDaVerificacao =
  | { readonly tipo: "valido" }
  | { readonly tipo: "incorreto"; readonly tentativasRestantes: number }
  /** Errou a última tentativa permitida: o código foi invalidado. */
  | { readonly tipo: "bloqueado" }
  | { readonly tipo: "expirado" }
  | { readonly tipo: "inexistente" };

interface CodigoPendente {
  readonly hash: Buffer;
  readonly expiraEm: number;
  tentativas: number;
}

function hashDo(codigo: string): Buffer {
  return createHash("sha256").update(codigo).digest();
}

/**
 * Códigos numéricos de uso único, um por pessoa (chave = telefone do gestor).
 * Ficam só na memória e só como hash: reiniciar o bot invalida os códigos pendentes,
 * o que é aceitável para um código que vale poucos minutos.
 */
export class CodigosDeUsoUnico {
  private readonly pendentes = new Map<string, CodigoPendente>();
  /**
   * Separado dos pendentes de propósito: um código bloqueado ou já usado sai de `pendentes`,
   * mas o intervalo entre emissões continua valendo (senão errar 5 vezes e pedir outro na hora
   * daria tentativas ilimitadas).
   */
  private readonly ultimaEmissao = new Map<string, number>();

  constructor(
    private readonly opcoes: OpcoesDosCodigos = OPCOES_PADRAO_DOS_CODIGOS,
    private readonly agora: () => number = Date.now,
    private readonly sortear: () => string =
      () => String(randomInt(0, 10 ** DIGITOS_DO_CODIGO)).padStart(DIGITOS_DO_CODIGO, "0"),
  ) {}

  get validadeEmMinutos(): number {
    return Math.round(this.opcoes.validadeMs / 60_000);
  }

  /** Gera um novo código (substitui o anterior) e devolve-o em claro só para o envio por e-mail. */
  emitir(chave: string): ResultadoDaEmissao {
    const agora = this.agora();
    const anterior = this.ultimaEmissao.get(chave);
    if (anterior !== undefined && agora - anterior < this.opcoes.intervaloEntreEmissoesMs) {
      return { tipo: "aguarde", segundos: Math.ceil((anterior + this.opcoes.intervaloEntreEmissoesMs - agora) / 1000) };
    }
    const codigo = this.sortear();
    this.ultimaEmissao.set(chave, agora);
    this.pendentes.set(chave, { hash: hashDo(codigo), expiraEm: agora + this.opcoes.validadeMs, tentativas: 0 });
    return { tipo: "emitido", codigo };
  }

  /** Um código válido só funciona uma vez: é apagado assim que confere. */
  verificar(chave: string, codigo: string): ResultadoDaVerificacao {
    const pendente = this.pendentes.get(chave);
    if (!pendente) return { tipo: "inexistente" };
    if (this.agora() >= pendente.expiraEm) {
      this.pendentes.delete(chave);
      return { tipo: "expirado" };
    }
    if (timingSafeEqual(pendente.hash, hashDo(codigo))) {
      this.pendentes.delete(chave);
      return { tipo: "valido" };
    }
    pendente.tentativas++;
    const restantes = this.opcoes.maximoDeTentativas - pendente.tentativas;
    if (restantes <= 0) {
      this.pendentes.delete(chave);
      return { tipo: "bloqueado" };
    }
    return { tipo: "incorreto", tentativasRestantes: restantes };
  }

  /** Há um código esperando resposta (expirado conta até ser verificado ou descartado). */
  temPendente(chave: string): boolean {
    return this.pendentes.has(chave);
  }

  descartar(chave: string): void {
    this.pendentes.delete(chave);
  }
}
