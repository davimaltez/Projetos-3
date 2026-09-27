import type pg from "pg";
import type { RepositorioDeMensagens } from "../nucleo/Repositorios.js";

export class MensagemRepositorio implements RepositorioDeMensagens {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Grava a mensagem recebida e devolve o id da linha a processar, ou null se essa
   * mensagem já foi processada (respondida e gravada): duplicata, não responder de novo.
   *
   * Se o idExterno já existe com processado = false, a tentativa anterior morreu no meio
   * (queda do WhatsApp ou do banco): devolve o id que já existe para a mensagem ser
   * reprocessada. Custo aceito: se a queda vier DEPOIS do envio, a resposta pode sair
   * repetida. Em troca, o cliente não fica sem resposta.
   */
  async registrarEntrada(conversaId: number, idExterno: string, texto: string): Promise<number | null> {
    const { rows } = await this.pool.query<{ id: number }>(
      `INSERT INTO mensagens (conversa_id, wamid, direcao, texto, processado)
       VALUES ($1, $2, 'entrada', $3, false)
       ON CONFLICT (wamid) DO UPDATE SET texto = EXCLUDED.texto
         WHERE mensagens.direcao = 'entrada' AND mensagens.processado = false
       RETURNING id`,
      [conversaId, idExterno, texto]
    );
    return rows[0]?.id ?? null;
  }

  async registrarSaida(conversaId: number, idExterno: string, texto: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO mensagens (conversa_id, wamid, direcao, texto, processado)
       VALUES ($1, $2, 'saida', $3, true)`,
      [conversaId, idExterno, texto]
    );
  }

  async marcarProcessada(id: number): Promise<void> {
    await this.pool.query("UPDATE mensagens SET processado = true WHERE id = $1", [id]);
  }
}
