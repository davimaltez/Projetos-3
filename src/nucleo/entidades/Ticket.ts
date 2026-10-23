
import type { Atendente } from "./Atendente.js";
import type { Conversa } from "./Conversa.js";
import { Prioridade, StatusTicket } from "./Enums.js";

export class Ticket {
    private protocolo: string;
    private assunto: string;
    private prioridade: Prioridade;
    private status: StatusTicket;
    private dataAbertura: Date;
    private dataFechamento: Date | null;
    private resumoBot: string;

    // Associacoes representadas no UML
    private conversa: Conversa;
    private atendente: Atendente | null;

    constructor(
        protocolo: string,
        assunto: string,
        prioridade: Prioridade,
        dataAbertura: Date,
        resumoBot: string,
        conversa: Conversa
    ) {
        this.protocolo = protocolo;
        this.assunto = assunto;
        this.prioridade = prioridade;
        this.status = StatusTicket.AGUARDANDO;
        this.dataAbertura = new Date(dataAbertura.getTime());
        this.dataFechamento = null;
        this.resumoBot = resumoBot;
        this.conversa = conversa;
        this.atendente = null;
    }


    /** Restaura o registro sem atribuir/fechar novamente nem substituir datas históricas. */
    public static reconstituir(dados: {
        protocolo: string;
        assunto: string;
        prioridade: Prioridade;
        status: StatusTicket;
        dataAbertura: Date;
        dataFechamento: Date | null;
        resumoBot: string;
        conversa: Conversa;
        atendente: Atendente | null;
    }): Ticket {
        const aguardando = dados.status === StatusTicket.AGUARDANDO
            && dados.atendente === null && dados.dataFechamento === null;
        const emAtendimento = dados.status === StatusTicket.EM_ATENDIMENTO
            && dados.atendente !== null && dados.dataFechamento === null;
        const encerrado = dados.status === StatusTicket.ENCERRADO
            && dados.atendente !== null && dados.dataFechamento !== null;
        if (!(aguardando || emAtendimento || encerrado)
            || !Object.values(Prioridade).includes(dados.prioridade)) {
            throw new Error("Estado do ticket persistido inconsistente.");
        }
        for (const data of [dados.dataAbertura, dados.dataFechamento]) {
            if (data !== null && !Number.isFinite(data.getTime())) {
                throw new Error("Data do ticket persistido inválida.");
            }
        }
        const ticket = new Ticket(dados.protocolo, dados.assunto, dados.prioridade,
            dados.dataAbertura, dados.resumoBot, dados.conversa);
        ticket.status = dados.status;
        ticket.dataFechamento = dados.dataFechamento === null
            ? null : new Date(dados.dataFechamento.getTime());
        ticket.atendente = dados.atendente;
        dados.conversa.vincularTicketReconstituido(ticket);
        return ticket;
    }

    public getProtocolo(): string {
        return this.protocolo;
    }

    public getAssunto(): string {
        return this.assunto;
    }

    public getPrioridade(): Prioridade {
        return this.prioridade;
    }

    public setPrioridade(p: Prioridade): void {
        this.prioridade = p;
    }

    public getStatus(): StatusTicket {
        return this.status;
    }

    public getDataAbertura(): Date {
        return new Date(this.dataAbertura.getTime());
    }

    public getDataFechamento(): Date | null {
        return this.dataFechamento === null
            ? null
            : new Date(this.dataFechamento.getTime());
    }

    public getResumoBot(): string {
        return this.resumoBot;
    }

    public getConversa(): Conversa {
        return this.conversa;
    }

    public getAtendente(): Atendente | null {
        return this.atendente;
    }

    public atribuir(a: Atendente): void {
        if (this.status !== StatusTicket.AGUARDANDO) {
            throw new Error(
                "Este ticket nao esta aguardando atendimento."
            );
        }

        this.atendente = a;
        this.status = StatusTicket.EM_ATENDIMENTO;
    }

    public fechar(): void {
        if (this.status !== StatusTicket.EM_ATENDIMENTO) {
            throw new Error(
                "O ticket precisa estar em atendimento."
            );
        }

        this.status = StatusTicket.ENCERRADO;
        this.dataFechamento = new Date();
    }
}
