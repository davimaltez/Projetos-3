import type { Remetente } from "./Remetente.js";

export interface DadosMensagemReconstituida {
    conteudo: string | null;
    dataHora: Date;
    remetente: Remetente | null;
    intencaoDetectada: string | null;
    id: number;
    direcao: string;
}

export class Mensagem {
    private conteudo: string | null;
    private dataHora: Date;
    private remetente: Remetente | null;
    private intencaoDetectada: string | null;
    private id: number | null;
    private direcao: string | null;

    constructor(conteudo: string, dataHora: Date, remetente: Remetente, intencaoDetectada?: string);
    /** Sobrecarga de estado usada por reconstituir; não executa uma nova ação de domínio. */
    constructor(dados: DadosMensagemReconstituida);
    constructor(...args:
        [string, Date, Remetente, string?] | [DadosMensagemReconstituida]
    ) {
        if (args.length === 1) {
            const dados = args[0];
            this.conteudo = dados.conteudo;
            this.dataHora = new Date(dados.dataHora.getTime());
            this.remetente = dados.remetente;
            this.intencaoDetectada = dados.intencaoDetectada;
            this.id = dados.id;
            this.direcao = dados.direcao;
        } else {
            const [conteudo, dataHora, remetente, intencaoDetectada = ""] = args;
            this.conteudo = conteudo;
            this.dataHora = new Date(dataHora.getTime());
            this.remetente = remetente;
            this.intencaoDetectada = intencaoDetectada;
            this.id = null;
            this.direcao = null;
        }
    }

    static reconstituir(dados: DadosMensagemReconstituida): Mensagem {
        if (!Number.isFinite(dados.dataHora.getTime())) {
            throw new Error("Data da mensagem persistida inválida.");
        }
        return new Mensagem(dados);
    }

    public getConteudo(): string | null {
        return this.conteudo;
    }

    public getDataHora(): Date {
        return new Date(this.dataHora.getTime());
    }

    public getRemetente(): Remetente | null {
        return this.remetente;
    }

    public getIntencaoDetectada(): string | null {
        return this.intencaoDetectada;
    }

    public setIntencaoDetectada(i: string): void {
        this.intencaoDetectada = i;
    }
    public getId(): number | null { return this.id; }
    public getDirecao(): string | null { return this.direcao; }
}
