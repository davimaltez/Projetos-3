
import type { Remetente } from "./Remetente.js";

export class Mensagem {
    private conteudo: string;
    private dataHora: Date;
    private remetente: Remetente;
    private intencaoDetectada: string;

    constructor(
        conteudo: string,
        dataHora: Date,
        remetente: Remetente,
        intencaoDetectada: string = ""
    ) {
        this.conteudo = conteudo;
        this.dataHora = new Date(dataHora.getTime());
        this.remetente = remetente;
        this.intencaoDetectada = intencaoDetectada;
    }

    public getConteudo(): string {
        return this.conteudo;
    }

    public getDataHora(): Date {
        return new Date(this.dataHora.getTime());
    }

    public getRemetente(): Remetente {
        return this.remetente;
    }

    public getIntencaoDetectada(): string {
        return this.intencaoDetectada;
    }

    public setIntencaoDetectada(i: string): void {
        this.intencaoDetectada = i;
    }
}
