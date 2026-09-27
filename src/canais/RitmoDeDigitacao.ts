/**
 * Quanto tempo o "digitando..." deve durar antes de uma resposta.
 *
 * Pessoas não respondem em 50 ms, e resposta instantânea com tempo sempre
 * igual é um dos padrões que mais denunciam automação no WhatsApp.
 * Regra: tempo proporcional ao tamanho do texto, com uma variação aleatória,
 * limitado entre um mínimo e um máximo.
 *
 * Classe pura (sem WhatsApp, sem relógio): fácil de testar e reaproveitar
 * em qualquer canal.
 */
export class RitmoDeDigitacao {
  /** Tempo "de reação" antes de começar a digitar. */
  private static readonly BASE_MS = 800;
  /** ~40 caracteres por segundo: rápido para uma pessoa, mas perceptível. */
  private static readonly MS_POR_CARACTERE = 25;
  /** ±15% de variação, para o tempo não ser sempre idêntico. */
  private static readonly VARIACAO = 0.15;

  constructor(
    private readonly minimoMs: number,
    private readonly maximoMs: number,
    private readonly aleatorio: () => number = Math.random
  ) {
    if (minimoMs < 0 || maximoMs < minimoMs) {
      throw new Error("Ritmo de digitação: use 0 ≤ mínimo ≤ máximo.");
    }
  }

  /** Mínimo e máximo em 0 desligam o atraso (útil em testes). */
  get desligado(): boolean {
    return this.maximoMs === 0;
  }

  duracaoMs(texto: string): number {
    if (this.desligado) return 0;
    const bruto = RitmoDeDigitacao.BASE_MS + texto.length * RitmoDeDigitacao.MS_POR_CARACTERE;
    const fator = 1 + (this.aleatorio() * 2 - 1) * RitmoDeDigitacao.VARIACAO;
    return Math.round(Math.min(Math.max(bruto * fator, this.minimoMs), this.maximoMs));
  }
}
