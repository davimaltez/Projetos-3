import express, { type Express } from "express";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CanalMensagens } from "../nucleo/CanalMensagens.js";
import type { BancoDeDados } from "../repositorios/BancoDeDados.js";

// src/http/ (dev, tsx) e dist/http/ (build) ficam a dois níveis da raiz do projeto.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PASTA_INTERFACE = path.join(RAIZ, "interface");
const PASTA_ASSETS = path.join(RAIZ, "assets");

export class ServidorHttp {
  private readonly app: Express = express();
  private servidor?: Server;

  constructor(
    private readonly porta: number,
    private readonly host: string,
    private readonly canal: CanalMensagens,
    private readonly banco: BancoDeDados,
    private readonly iaConfigurada: boolean
  ) {
    this.registrarRotas();
  }

  private registrarRotas(): void {
    // Não anuncia "Express" em cada resposta: é informação de graça para quem procura falhas.
    this.app.disable("x-powered-by");

    // Critério da entrega: texto puro "estou vivo". NÃO trocar por JSON.
    // Vem ANTES dos estáticos: nenhum arquivo de interface/ pode sobrescrevê-la.
    this.app.get("/estou-vivo", (_req, res) => {
      res.type("text/plain").send("estou vivo");
    });

    // Diagnóstico rápido na VM sem precisar de SSH: o bot está conectado? o banco responde?
    this.app.get("/status", async (_req, res) => {
      const banco = await this.banco.verificar();
      const whatsapp = this.canal.estaConectado();
      // "ia" é informativo: sem IA o bot funciona (só com menu), então não derruba o status.
      res.status(banco && whatsapp ? 200 : 503).json({ whatsapp, banco, ia: this.iaConfigurada });
    });

    // Páginas e imagens da entrega anterior: / (index.html), /status.html, /style.css, /assets/...
    this.app.use(express.static(PASTA_INTERFACE));
    this.app.use("/assets", express.static(PASTA_ASSETS));
  }

  /** Resolve quando o servidor está escutando; rejeita com mensagem clara se não conseguir (porta ocupada etc.). */
  iniciar(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const servidor = this.app.listen(this.porta, this.host);
      this.servidor = servidor;

      servidor.once("error", (erro: NodeJS.ErrnoException) => {
        reject(
          new Error(
            erro.code === "EADDRINUSE"
              ? `Porta ${this.porta} já está em uso. Feche o outro programa ou mude PORT no .env.`
              : `Não consegui abrir o servidor HTTP em ${this.host}:${this.porta}: ${erro.message}`
          )
        );
      });
      servidor.once("listening", () => {
        console.log(`Servidor rodando em http://${this.host === "0.0.0.0" ? "localhost" : this.host}:${this.porta}`);
        // Depois de subir, um erro solto não pode derrubar o processo sem explicação.
        servidor.on("error", (erro) => console.error("[http] erro no servidor:", erro));
        resolve();
      });
    });
  }

  async encerrar(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.servidor) return resolve();
      this.servidor.close(() => resolve());
    });
  }
}
