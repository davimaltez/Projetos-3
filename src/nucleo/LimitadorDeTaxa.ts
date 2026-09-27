/**
 * Deixa passar no máximo `maximo` pedidos por chave dentro de uma janela de tempo que desliza.
 *
 * Serve para não repetir o mesmo aviso ao mesmo remetente ("no máximo 1 por minuto")
 * e para limitar quantas mensagens um remetente pode mandar por minuto.
 *
 * Classe pura: o relógio é injetado, então dá para testar sem esperar o tempo passar.
 */
export class LimitadorDeTaxa {
  /** Acima disso, chaves antigas são varridas para o mapa não crescer para sempre. */
  private static readonly LIMITE_DE_CHAVES = 1_000;

  private readonly usosPorChave = new Map<string, number[]>();
  private proximaVarredura = 0;

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
    private readonly agora: () => number = Date.now
  ) {
    if (!Number.isInteger(maximo) || maximo < 1) {
      throw new Error("Limitador: o máximo deve ser um número inteiro maior ou igual a 1.");
    }
    if (!Number.isFinite(janelaMs) || janelaMs <= 0) {
      throw new Error("Limitador: a janela de tempo deve ser maior que zero.");
    }
  }

  /** true = pode seguir (e isso conta como um uso); false = passou do limite, nada é contado. */
  tentar(chave: string): boolean {
    const agora = this.agora();
    this.varrerSeNecessario(agora);

    const recentes = (this.usosPorChave.get(chave) ?? []).filter((instante) => instante > agora - this.janelaMs);
    const liberado = recentes.length < this.maximo;
    if (liberado) recentes.push(agora);
    this.usosPorChave.set(chave, recentes);
    return liberado;
  }

  private varrerSeNecessario(agora: number): void {
    if (this.usosPorChave.size < LimitadorDeTaxa.LIMITE_DE_CHAVES || agora < this.proximaVarredura) return;
    for (const [chave, usos] of this.usosPorChave) {
      if (usos.length === 0 || usos[usos.length - 1] <= agora - this.janelaMs) this.usosPorChave.delete(chave);
    }
    this.proximaVarredura = agora + this.janelaMs;
  }
}
