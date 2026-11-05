import express, { type Express } from "express";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CanalMensagens } from "../nucleo/CanalMensagens.js";
import type { BancoDeDados } from "../repositorios/BancoDeDados.js";
import type { ServicoDeFila } from "../nucleo/ServicoDeFila.js";
import type { AutenticadorDeOperador } from "./AutenticadorDeOperador.js";
import { rotasDaFila } from "./RotasDaFila.js";

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
    private readonly canal: Pick<CanalMensagens, "estaConectado">,
    private readonly banco: Pick<BancoDeDados, "verificar">,
    private readonly iaConfigurada: boolean,
    private readonly fila: ServicoDeFila,
    private readonly autenticador: AutenticadorDeOperador
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

    // Mantém a autenticação restrita às rotas do operador; diagnósticos seguem públicos.
    this.app.use(rotasDaFila(this.fila, this.autenticador));

    // Páginas e imagens da entrega anterior: / (index.html), /status.html, /style.css, /assets/...
    this.app.use(express.static(PASTA_INTERFACE));
    this.app.use("/assets", express.static(PASTA_ASSETS));
  }

  get portaEmUso(): number | undefined {
    const endereco = this.servidor?.address();
    return endereco && typeof endereco === "object" ? endereco.port : undefined;
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
        console.log(`Servidor rodando em http://${this.host === "0.0.0.0" ? "localhost" : this.host}:${this.portaEmUso}`);
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
