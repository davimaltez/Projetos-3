
import { randomUUID } from "node:crypto";

import type { Cliente } from "./Cliente.js";
import type { Chatbot } from "./Chatbot.js";
import { Mensagem } from "./Mensagem.js";
import { Ticket } from "./Ticket.js";

import {
    StatusConversa,
    Prioridade
} from "./Enums.js";

export class Conversa {
    private id: number;
    private canal: string;
    private dataInicio: Date;
    private dataFim: Date | null;
    private status: StatusConversa;
    private mensagens: Mensagem[];

    // Associacoes do UML
    private cliente: Cliente;
    private chatbot: Chatbot;

    // Evita criar mais de um ticket na mesma transferencia
    private ticket: Ticket | null;

    constructor(
        id: number,
        canal: string,
        cliente: Cliente,
        chatbot: Chatbot,
        dataInicio: Date = new Date()
    ) {
        this.id = id;
        this.canal = canal;
        this.dataInicio = new Date(dataInicio.getTime());
        this.dataFim = null;
        this.status = StatusConversa.COM_BOT;
        this.mensagens = [];

        this.cliente = cliente;
        this.chatbot = chatbot;
        this.ticket = null;
    }

    public getId(): number {
        return this.id;
    }

    public getCanal(): string {
        return this.canal;
    }

    public getDataInicio(): Date {
        return new Date(this.dataInicio.getTime());
    }

    public getDataFim(): Date | null {
        return this.dataFim === null
            ? null
            : new Date(this.dataFim.getTime());
    }

    public getStatus(): StatusConversa {
        return this.status;
    }

    public getHistorico(): Mensagem[] {
        return [...this.mensagens];
    }

    public adicionarMensagem(m: Mensagem): void {
        if (this.status === StatusConversa.ENCERRADA) {
            throw new Error(
                "Nao e possivel adicionar mensagens a uma conversa encerrada."
            );
        }

        this.mensagens.push(m);
    }

    public transferirParaHumano(): Ticket {
        if (this.status === StatusConversa.ENCERRADA) {
            throw new Error(
                "Nao e possivel transferir uma conversa encerrada."
            );
        }

        if (this.ticket !== null) {
            return this.ticket;
        }

        const protocolo = randomUUID();
        const assunto = "Atendimento humano";

        const resumoBot = this.mensagens
            .map(m => m.getConteudo())
            .join("\n");

        const ticket = new Ticket(
            protocolo,
            assunto,
            Prioridade.MEDIA,
            new Date(),
            resumoBot,
            this
        );

        this.ticket = ticket;
        this.status = StatusConversa.AGUARDANDO_ATENDENTE;

        return ticket;
    }

    public encerrar(): void {
        if (this.status === StatusConversa.ENCERRADA) {
            return;
        }

        this.status = StatusConversa.ENCERRADA;
        this.dataFim = new Date();
    }
}
