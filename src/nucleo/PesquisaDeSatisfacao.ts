import type { CanalMensagens } from "./CanalMensagens.js";
import type { RepositorioDeAvaliacoes } from "./Repositorios.js";

export const TEXTO_AGRADECIMENTO_AVALIACAO =
  "Obrigado pela sua avaliação! Se precisar de algo, é só mandar uma mensagem.";

export function textoDoPedidoDeNota(protocolo: string): string {
  return `Seu atendimento (protocolo ${protocolo}) foi encerrado. Obrigado pelo contato!\n\n` +
    "De 1 a 5, que nota você dá para este atendimento? (1 = muito ruim, 5 = excelente). Responda só com o número.";
}

/** "4", "nota 4", "4 estrelas" → 4. Qualquer outra coisa → null (o cliente quer outro assunto). */
export function lerNota(texto: string): number | null {
  const normalizado = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const encontrado = /^(?:nota )?([1-5])(?: estrelas?)?$/.exec(normalizado);
  return encontrado ? Number(encontrado[1]) : null;
}

/**
 * Pede a nota de satisfação ao cliente quando o operador encerra o atendimento (história 3.3).
 * A resposta é recebida pelo Atendimento, que consulta a avaliação pendente do cliente.
 */
export class PesquisaDeSatisfacao {
  constructor(
    private readonly canal: CanalMensagens,
    private readonly avaliacoes: RepositorioDeAvaliacoes,
  ) {}

  /** Grava a pendência antes de perguntar: uma resposta rápida do cliente já encontra a avaliação. */
  async pedirNota(protocolo: string, enderecoDoCliente: string): Promise<void> {
    await this.avaliacoes.solicitar(protocolo);
    try {
      await this.canal.enviarTexto(enderecoDoCliente, textoDoPedidoDeNota(protocolo));
    } catch (erro) {
      // A pergunta não chegou: o próximo "3" do cliente não pode virar nota por engano.
      await this.avaliacoes.descartar(protocolo).catch(() => {});
      throw erro;
    }
  }
}
