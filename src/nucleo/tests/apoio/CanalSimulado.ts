import type { CanalMensagens, ManipuladorDeMensagem } from "../../CanalMensagens.js";

export class CanalSimulado implements CanalMensagens {
  readonly nome = "simulado";
  readonly enviadas: { endereco: string; texto: string }[] = [];
  falharProximoEnvio = false;
  conectado = true;
  digitando = 0;
  async iniciar(_manipulador: ManipuladorDeMensagem): Promise<void> {}
  async indicarDigitando(): Promise<void> { this.digitando++; }
  async enviarTexto(endereco: string, texto: string): Promise<string> {
    if (this.falharProximoEnvio) {
      this.falharProximoEnvio = false;
      throw new Error("Falha simulada de envio");
    }
    this.enviadas.push({ endereco, texto });
    return `saida-${this.enviadas.length}`;
  }
  estaConectado(): boolean { return this.conectado; }
  async encerrar(): Promise<void> { this.conectado = false; }
}
