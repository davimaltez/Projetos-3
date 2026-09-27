/**
 * Fronteira entre "de onde a mensagem vem" e "o que o bot faz com ela".
 *
 * O núcleo (nucleo/) só conhece esta interface. Trocar Baileys pela
 * Cloud API oficial da Meta = escrever outra classe que implementa
 * CanalMensagens e trocar UMA linha em app.ts. Nada no núcleo,
 * nos repositórios ou no banco muda.
 */

/** Mensagem já traduzida para o formato interno, sem nada específico do canal. */
export interface MensagemRecebida {
  /** Id da mensagem no canal (no WhatsApp, o wamid). Usado para não processar duas vezes. */
  readonly idExterno: string;
  /**
   * Identificador estável do remetente, usado como chave do cliente no banco.
   * Normalmente o telefone ("5581999999999"). Se o WhatsApp só entregar o
   * identificador anônimo (LID), vem o LID ("123456789@lid").
   */
  readonly remetente: string;
  /** Endereço opaco para responder. O núcleo não interpreta, só devolve ao canal. */
  readonly enderecoResposta: string;
  readonly texto: string;
}

export type ManipuladorDeMensagem = (mensagem: MensagemRecebida) => Promise<void>;

export interface CanalMensagens {
  /** Nome curto do canal, gravado em clientes.origem. */
  readonly nome: string;
  /** Conecta e passa a entregar cada mensagem nova ao manipulador. */
  iniciar(aoReceber: ManipuladorDeMensagem): Promise<void>;
  /**
   * Mostra ao usuário que a resposta está sendo preparada ("digitando...").
   * Deve ser chamado assim que o processamento começa. Nunca lança erro:
   * se o indicador falhar, a resposta segue normalmente.
   */
  indicarDigitando(enderecoResposta: string): Promise<void>;
  /**
   * Envia texto e devolve o id da mensagem enviada. O canal pode segurar o
   * envio por alguns segundos para simular digitação (ver RitmoDeDigitacao).
   */
  enviarTexto(enderecoResposta: string, texto: string): Promise<string>;
  estaConectado(): boolean;
  encerrar(): Promise<void>;
}
