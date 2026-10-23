import { randomUUID } from "node:crypto";

import type { Remetente } from "./Remetente.js";

export interface DadosMensagemReconstituida {
    /** Id da linha no banco (SERIAL); vira texto na entidade. */
    id: number | string;
    /** A coluna mensagens.texto aceita NULL em dados antigos; na entidade vira "". */
    texto: string | null;
    dataEnvio: Date;
    remetente: Remetente;
    processado: boolean;
    intencaoDetectada: string | null;
    direcao: string;
}

/**
 * Mensagem da conversa (plano da Dupla 2). A mensagem TEM um remetente associado;
 * ela não É um remetente.
 *
 * Sem setter para id e dataEnvio. intencaoDetectada (diagrama) usa null para "sem intenção".
 */
export class Mensagem {
    private readonly id: string;
    private readonly texto: string;
    private readonly dataEnvio: Date;
    private readonly remetente: Remetente;
    private processado: boolean;
    private intencaoDetectada: string | null;
    /** "entrada" ou "saida" quando veio do banco; null em mensagem criada agora. */
    private direcao: string | null;

    constructor(
        texto: string,
        dataEnvio: Date,
        remetente: Remetente,
        intencaoDetectada: string | null = null,
        id: string = randomUUID()
    ) {
        if (!Number.isFinite(dataEnvio.getTime())) {
            throw new Error("Data de envio da mensagem inválida.");
        }
        this.id = id;
        this.texto = texto;
        this.dataEnvio = new Date(dataEnvio.getTime());
        this.remetente = remetente;
        this.processado = false;
        this.intencaoDetectada = intencaoDetectada;
        this.direcao = null;
    }

    /** Restaura a mensagem gravada no banco, sem executar uma nova ação de domínio. */
    static reconstituir(dados: DadosMensagemReconstituida): Mensagem {
        if (!Number.isFinite(dados.dataEnvio.getTime())) {
            throw new Error("Data da mensagem persistida inválida.");
        }
        const mensagem = new Mensagem(
            dados.texto ?? "", dados.dataEnvio, dados.remetente, dados.intencaoDetectada, String(dados.id)
        );
        mensagem.processado = dados.processado;
        mensagem.direcao = dados.direcao;
        return mensagem;
    }

    public getId(): string {
        return this.id;
    }

    public getTexto(): string {
        return this.texto;
    }

    public getDataEnvio(): Date {
        return new Date(this.dataEnvio.getTime());
    }

    public getRemetente(): Remetente {
        return this.remetente;
    }

    public isProcessado(): boolean {
        return this.processado;
    }

    public setProcessado(processado: boolean): void {
        this.processado = processado;
    }

    public getIntencaoDetectada(): string | null {
        return this.intencaoDetectada;
    }

    public setIntencaoDetectada(i: string | null): void {
        this.intencaoDetectada = i;
    }

    public getDirecao(): string | null {
        return this.direcao;
    }
}
