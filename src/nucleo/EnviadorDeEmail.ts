/** Envio de e-mail visto pelo núcleo. A implementação SMTP fica em src/email/. */
export interface EnviadorDeEmail {
  readonly nome: string;
  enviar(para: string, assunto: string, texto: string): Promise<void>;
}
