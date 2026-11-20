import nodemailer, { type Transporter } from "nodemailer";
import type { EnviadorDeEmail } from "../nucleo/EnviadorDeEmail.js";

export interface ConfiguracaoSmtp {
  readonly host: string;
  readonly porta: number;
  /** true = TLS direto (porta 465); false = STARTTLS (porta 587). */
  readonly seguro: boolean;
  readonly usuario: string | undefined;
  readonly senha: string | undefined;
  /** Endereço que aparece como remetente, ex.: "Chatbot WXN <nao-responda@wxn.com.br>". */
  readonly remetente: string;
}

/** Envio real por SMTP (Gmail, Outlook, provedor da WXN...). */
export class EnviadorDeEmailSmtp implements EnviadorDeEmail {
  readonly nome = "smtp";
  private readonly transporte: Transporter;

  constructor(private readonly config: ConfiguracaoSmtp) {
    this.transporte = nodemailer.createTransport({
      host: config.host,
      port: config.porta,
      secure: config.seguro,
      auth: config.usuario ? { user: config.usuario, pass: config.senha ?? "" } : undefined,
      // Sem isso, um servidor que não responde seguraria o gestor esperando por minutos.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  async enviar(para: string, assunto: string, texto: string): Promise<void> {
    await this.transporte.sendMail({ from: this.config.remetente, to: para, subject: assunto, text: texto });
  }
}

/**
 * SOMENTE DESENVOLVIMENTO: escreve o e-mail no terminal em vez de enviar. Assim dá para testar o
 * relatório sem servidor SMTP. Quem lê o log vê o código, por isso exige EMAIL_MODO=console explícito.
 */
export class EnviadorDeEmailNoConsole implements EnviadorDeEmail {
  readonly nome = "console";

  async enviar(para: string, assunto: string, texto: string): Promise<void> {
    console.log(`[email:console] para ${para} | ${assunto}\n${texto}`);
  }
}
