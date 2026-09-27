/**
 * Quando tentar reconectar ao WhatsApp depois de uma queda. Duas fases:
 *
 *  - Rápida: as primeiras `tentativasRapidas` (10) tentativas, com espera que dobra a cada
 *    uma (2 s, 4 s, 8 s... até 60 s). Cobre as quedas curtas.
 *  - Lenta: depois disso, uma tentativa a cada `intervaloLentoMs` (10 min), sem limite. Uma
 *    queda longa de internet não deixa o bot parado até alguém reiniciar, e o intervalo grande
 *    não martela o WhatsApp (insistir com um número limitado piora).
 *
 * Nas duas fases a espera recebe uma variação aleatória: reconectar sempre nos mesmos instantes
 * é padrão de robô, e várias instâncias caídas juntas não devem bater no WhatsApp ao mesmo tempo.
 *
 * Quedas em que reconectar nunca adianta (sessão encerrada, número banido...) não passam por
 * aqui: o canal para de vez (ver MOTIVOS_FATAIS no CanalWhatsAppBaileys).
 *
 * Classe pura (sem Baileys, sem relógio): o sorteio é injetado, então é fácil de testar.
 */
export class PoliticaDeReconexao {
  constructor(
    /** Quantas tentativas rápidas (espera crescente) antes de passar para o modo lento. */
    readonly tentativasRapidas: number = 10,
    private readonly atrasoInicialMs: number = 2_000,
    private readonly atrasoMaximoMs: number = 60_000,
    /** 0,25 = a espera varia até 25% para mais ou para menos. */
    private readonly variacao: number = 0.25,
    private readonly aleatorio: () => number = Math.random,
    /** No modo lento: uma tentativa a cada tanto tempo (10 min). */
    readonly intervaloLentoMs: number = 600_000
  ) {
    if (!Number.isInteger(tentativasRapidas) || tentativasRapidas < 1) {
      throw new Error("Reconexão: o número de tentativas rápidas deve ser um inteiro maior ou igual a 1.");
    }
    if (atrasoInicialMs <= 0 || atrasoMaximoMs < atrasoInicialMs) {
      throw new Error("Reconexão: use 0 < atraso inicial ≤ atraso máximo.");
    }
    if (variacao < 0 || variacao >= 1) {
      throw new Error("Reconexão: a variação deve estar entre 0 e 1 (exclusive).");
    }
    if (!Number.isFinite(intervaloLentoMs) || intervaloLentoMs < atrasoMaximoMs) {
      throw new Error("Reconexão: o intervalo do modo lento deve ser maior ou igual ao atraso máximo.");
    }
  }

  /** true quando as tentativas rápidas acabaram (`tentativasFeitas` conta as anteriores). */
  emModoLento(tentativasFeitas: number): boolean {
    return tentativasFeitas >= this.tentativasRapidas;
  }

  /**
   * Espera antes da próxima tentativa, em ms. Na fase rápida dobra a cada tentativa e nunca passa
   * do atraso máximo; na fase lenta é sempre em torno do intervalo lento, não importa quantas
   * tentativas já foram feitas.
   */
  atrasoMs(tentativasFeitas: number): number {
    const fator = 1 + (this.aleatorio() * 2 - 1) * this.variacao;
    if (this.emModoLento(tentativasFeitas)) return Math.round(this.intervaloLentoMs * fator);

    const base = Math.min(this.atrasoInicialMs * 2 ** tentativasFeitas, this.atrasoMaximoMs);
    return Math.round(Math.min(base * fator, this.atrasoMaximoMs));
  }
}
