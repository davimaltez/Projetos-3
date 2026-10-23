import { StatusAtendente, TipoRemetente } from "./Enums.js";
import type { Remetente } from "./Remetente.js";
import type { Ticket } from "./Ticket.js";
import { Usuario } from "./Usuario.js";

/**
 * Operador da WXN que assume tickets da fila (diagrama: Atendente 0..1 —atende— 0..* Ticket).
 *
 * status e especialidade são opcionais no construtor para que o cadastro existente
 * (new Atendente(id, nome, email)) continue valendo; o padrão OFFLINE é o mesmo da
 * coluna atendentes.status.
 */
export class Atendente extends Usuario implements Remetente {
  #status: StatusAtendente;
  readonly #especialidade: string | null;

  constructor(
    id: number | string,
    nome: string,
    email: string,
    status: StatusAtendente = StatusAtendente.OFFLINE,
    especialidade: string | null = null
  ) {
    super(id, nome, email);
    this.#status = status;
    this.#especialidade = especialidade;
  }

  getStatus(): StatusAtendente {
    return this.#status;
  }

  /** O próprio atendente muda a disponibilidade (ex.: entra ou sai do turno). */
  setStatus(s: StatusAtendente): void {
    this.#status = s;
  }

  getEspecialidade(): string | null {
    return this.#especialidade;
  }

  /**
   * Regra de domínio: só um atendente DISPONIVEL assume um ticket, e passa a OCUPADO.
   * O ticket valida o próprio estado (precisa estar AGUARDANDO); se ele recusar,
   * o status do atendente não muda.
   *
   * Observação: a fila persistida usa ServicoDeFila.assumirTicket, que garante a
   * atribuição atômica no banco. Este método é a regra do objeto em memória.
   */
  assumirTicket(t: Ticket): void {
    if (this.#status !== StatusAtendente.DISPONIVEL) {
      throw new Error("O atendente precisa estar DISPONIVEL para assumir um ticket.");
    }
    t.atribuir(this);
    this.#status = StatusAtendente.OCUPADO;
  }

  /** Só quem assumiu o ticket pode encerrá-lo; depois disso o atendente volta a DISPONIVEL. */
  encerrarTicket(t: Ticket): void {
    const responsavel = t.getAtendente();
    if (responsavel === null || responsavel.getId() !== this.getId()) {
      throw new Error("Só o atendente responsável pode encerrar o ticket.");
    }
    t.fechar();
    this.#status = StatusAtendente.DISPONIVEL;
  }

  getTipo(): TipoRemetente {
    return TipoRemetente.ATENDENTE;
  }

  getIdentificacao(): string {
    return `atendente:${this.getId()}`;
  }
}
