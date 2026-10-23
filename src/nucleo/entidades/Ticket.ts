
import type { Atendente } from "./Atendente.js";
import type { Conversa } from "./Conversa.js";
import { PrioridadeTicket, StatusTicket } from "./Enums.js";

/**
 * Ticket de atendimento humano (plano da Dupla 2: id, conversa, atendente, status,
 * prioridade, dataAbertura, getStatus, getPrioridade e atribuirAtendente).
 * O id é o protocolo mostrado ao cliente (diagrama): getId() e getProtocolo() devolvem o mesmo valor.
 */
export class Ticket {
    private id: string;
    private assunto: string;
    private prioridade: PrioridadeTicket;
    private status: StatusTicket;
    private dataAbertura: Date;
    private dataFechamento: Date | null;
    private resumoBot: string;

    // Associacoes representadas no UML
    private conversa: Conversa;
    private atendente: Atendente | null;

    constructor(
        id: string,
        assunto: string,
        prioridade: PrioridadeTicket,
        dataAbertura: Date,
        resumoBot: string,
        conversa: Conversa
    ) {
        this.id = id;
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
        id: string;
        assunto: string;
        prioridade: PrioridadeTicket;
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
            || !Object.values(PrioridadeTicket).includes(dados.prioridade)) {
            throw new Error("Estado do ticket persistido inconsistente.");
        }
        for (const data of [dados.dataAbertura, dados.dataFechamento]) {
            if (data !== null && !Number.isFinite(data.getTime())) {
                throw new Error("Data do ticket persistido inválida.");
            }
        }
        const ticket = new Ticket(dados.id, dados.assunto, dados.prioridade,
            dados.dataAbertura, dados.resumoBot, dados.conversa);
        ticket.status = dados.status;
        ticket.dataFechamento = dados.dataFechamento === null
            ? null : new Date(dados.dataFechamento.getTime());
        ticket.atendente = dados.atendente;
        dados.conversa.vincularTicketReconstituido(ticket);
        return ticket;
    }

    public getId(): string {
        return this.id;
    }

    /** Nome do diagrama para o mesmo identificador. */
    public getProtocolo(): string {
        return this.id;
    }

    public getAssunto(): string {
        return this.assunto;
    }

    public getPrioridade(): PrioridadeTicket {
        return this.prioridade;
    }

    public setPrioridade(p: PrioridadeTicket): void {
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

    /** Plano: atribui o atendente e muda o status para EM_ATENDIMENTO. */
    public atribuirAtendente(atendente: Atendente): void {
        if (this.status !== StatusTicket.AGUARDANDO) {
            throw new Error(
                "Este ticket nao esta aguardando atendimento."
            );
        }

        this.atendente = atendente;
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
