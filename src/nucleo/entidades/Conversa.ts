import { randomUUID } from "node:crypto";

import type { Cliente } from "./Cliente.js";
import type { Chatbot } from "./Chatbot.js";
import type { Mensagem } from "./Mensagem.js";
import { Ticket } from "./Ticket.js";
import { StatusConversa, Prioridade } from "./Enums.js";

export interface DadosConversaReconstituida {
    /** Id da linha no banco (SERIAL); vira texto na entidade. */
    id: number | string;
    canal: string | null;
    cliente: Cliente;
    chatbot: Chatbot | null;
    dataCriacao: Date;
    dataFim: Date | null;
    status: StatusConversa | null;
    /** Mantém o valor legado mesmo quando não corresponde a um enum conhecido. */
    estadoPersistido: string;
    mensagens: readonly Mensagem[];
}

/**
 * Conversa entre um cliente e o atendimento (plano da Dupla 2: id, cliente, mensagens,
 * dataCriacao, adicionarMensagem e getHistorico). Os demais atributos vêm do diagrama.
 */
export class Conversa {
    private id: string;
    private canal: string | null;
    private dataCriacao: Date;
    private dataFim: Date | null;
    private status: StatusConversa | null;
    private mensagens: Mensagem[];
    private cliente: Cliente;
    private chatbot: Chatbot | null;
    private ticket: Ticket | null;
    private estadoPersistido: string | null;

    constructor(id: number | string, canal: string, cliente: Cliente, chatbot: Chatbot, dataCriacao?: Date);
    /** Sobrecarga de estado usada por reconstituir; admite ausências históricas. */
    constructor(dados: DadosConversaReconstituida);
    constructor(...args:
        [number | string, string, Cliente, Chatbot, Date?] | [DadosConversaReconstituida]
    ) {
        if (args.length === 1) {
            const dados = args[0];
            this.id = String(dados.id);
            this.canal = dados.canal;
            this.cliente = dados.cliente;
            this.chatbot = dados.chatbot;
            this.dataCriacao = new Date(dados.dataCriacao.getTime());
            this.dataFim = dados.dataFim === null ? null : new Date(dados.dataFim.getTime());
            this.status = dados.status;
            this.estadoPersistido = dados.estadoPersistido;
            this.mensagens = [...dados.mensagens];
        } else {
            const [id, canal, cliente, chatbot, dataCriacao = new Date()] = args;
            this.id = String(id);
            this.canal = canal;
            this.cliente = cliente;
            this.chatbot = chatbot;
            this.dataCriacao = new Date(dataCriacao.getTime());
            this.dataFim = null;
            this.status = StatusConversa.COM_BOT;
            this.estadoPersistido = null;
            this.mensagens = [];
        }
        this.ticket = null;
    }

    static reconstituir(dados: DadosConversaReconstituida): Conversa {
        for (const data of [dados.dataCriacao, dados.dataFim]) {
            if (data !== null && !Number.isFinite(data.getTime())) {
                throw new Error("Data da conversa persistida inválida.");
            }
        }
        return new Conversa(dados);
    }

    /** Recompõe somente a associação, sem transferir, gerar protocolo ou mudar estado. */
    public vincularTicketReconstituido(ticket: Ticket): void {
        if (ticket.getConversa() !== this || (this.ticket !== null && this.ticket !== ticket)) {
            throw new Error("Ticket incompatível com a conversa reconstituída.");
        }
        this.ticket = ticket;
    }

    public getId(): string {
        return this.id;
    }

    public getCanal(): string | null {
        return this.canal;
    }

    public getDataCriacao(): Date {
        return new Date(this.dataCriacao.getTime());
    }

    public getDataFim(): Date | null {
        return this.dataFim === null
            ? null
            : new Date(this.dataFim.getTime());
    }

    public getStatus(): StatusConversa | null {
        return this.status;
    }

    public getEstadoPersistido(): string | null { return this.estadoPersistido; }
    public getCliente(): Cliente { return this.cliente; }
    public getChatbot(): Chatbot | null { return this.chatbot; }

    public getHistorico(): Mensagem[] {
        return [...this.mensagens];
    }

    public adicionarMensagem(msg: Mensagem): void {
        if (this.status === StatusConversa.ENCERRADA) {
            throw new Error(
                "Nao e possivel adicionar mensagens a uma conversa encerrada."
            );
        }

        this.mensagens.push(msg);
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
            .map(m => m.getTexto())
            .filter((texto) => texto !== "")
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
