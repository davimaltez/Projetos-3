import type { CanalMensagens, MensagemRecebida } from "./CanalMensagens.js";
import type { ServicoDeFila } from "./ServicoDeFila.js";
import type { Atendente } from "./entidades/Atendente.js";
import { MotivoDaTransferencia } from "./entidades/Enums.js";
import type { Ticket } from "./entidades/Ticket.js";
import { TicketIndisponivelError, TicketNaoEncontradoError } from "./ErrosDaFila.js";

/** Como o motivo do escalonamento aparece para o operador (história 2.1). */
export const ROTULO_DO_MOTIVO: Readonly<Record<MotivoDaTransferencia, string>> = {
    [MotivoDaTransferencia.PEDIDO_DO_CLIENTE]: "pedido do cliente",
    [MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA]: "pergunta sem resposta",
    [MotivoDaTransferencia.FALHAS_SEGUIDAS]: "falhas seguidas de entendimento",
    [MotivoDaTransferencia.DEMANDA_NAO_ENCONTRADA]: "demanda não encontrada",
};

/** Tempo de espera legível: "0 min", "45 min", "2h", "1h15min". */
export function formatarEspera(desde: Date, agora: Date): string {
    const minutos = Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / 60_000));
    if (minutos < 60) return `${minutos} min`;
    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, "0")}min`;
}

function textoDosDados(dados: Record<string, unknown>, chave: string): string | null {
    const valor = dados[chave];
    return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/** "Nome (telefone)", ou só o telefone quando o cliente ainda não tem nome cadastrado. */
function identificarCliente(ticket: Ticket): string {
    const cliente = ticket.getConversa().getCliente();
    const telefone = cliente.getTelefone();
    const nome = cliente.getNome() !== telefone ? cliente.getNome() : textoDosDados(ticket.getDados(), "clienteNome");
    return nome && nome !== telefone ? `${nome} (${telefone})` : telefone;
}

function empresaDoCliente(ticket: Ticket): string {
    return textoDosDados(ticket.getDados(), "empresa")
        ?? ticket.getConversa().getCliente().getEmpresa()
        ?? "não informada";
}

/** Cadastro explícito: nunca deduz permissão a partir de um nome ou de uma mensagem. */
export interface VinculoOperadorWhatsApp {
    readonly id: number;
    readonly telefone: string;
}

function normalizarTelefone(entrada: string): string | null {
    // Recusa LID e identificadores de outros canais; não confunde um ID anônimo com telefone.
    const texto = entrada.replace(/@s\.whatsapp\.net$/, "");
    const numero = texto.startsWith("+") ? texto.slice(1) : texto;
    return /^\d{10,15}$/.test(numero) ? numero : null;
}

/**
 * Fluxo do operador: reconhecimento, listagem e assunção pelo número exibido.
 * O serviço de domínio continua independente do WhatsApp, e a autenticação HTTP existente é preservada.
 */
export class FluxoDoOperador {
    private readonly porTelefone = new Map<string, Atendente>();
    /** Cada operador seleciona sobre a última lista que ele próprio recebeu. */
    private readonly selecoes = new Map<string, readonly string[]>();
    private readonly ativos = new Map<string, string>();
    private readonly sequencias = new Map<string, Promise<void>>();
    private readonly processadas = new Set<string>();

    constructor(
        private readonly canal: CanalMensagens,
        private readonly fila: ServicoDeFila,
        atendentes: readonly Atendente[],
        vinculos: readonly VinculoOperadorWhatsApp[],
        /** Relógio do tempo de espera; os testes passam um horário fixo. */
        private readonly agora: () => Date = () => new Date(),
    ) {
        const porId = new Map(atendentes.map(a => [Number(a.getId()), a]));
        for (const vinculo of vinculos) {
            const telefone = normalizarTelefone(vinculo.telefone);
            const atendente = porId.get(vinculo.id);
            if (!telefone || !atendente || this.porTelefone.has(telefone)) {
                throw new Error("OPERADORES_WHATSAPP_JSON contém telefone duplicado, inválido ou operador não cadastrado.");
            }
            this.porTelefone.set(telefone, atendente);
        }
    }

    /** Serializa comandos por operador e ignora reentregas já concluídas nesta execução. */
    async processarSeOperador(mensagem: MensagemRecebida): Promise<boolean> {
        const telefone = normalizarTelefone(mensagem.remetente);
        if (!telefone) return false;
        const atendente = this.porTelefone.get(telefone);
        if (!atendente) return false;
        const chave = `${telefone}:${mensagem.idExterno}`;
        const anterior = this.sequencias.get(telefone) ?? Promise.resolve();
        const atual = anterior.catch(() => {}).then(async () => {
            if (this.processadas.has(chave)) return;
            await this.processarAutorizado(mensagem, telefone, atendente);
            // Evita retenção ilimitada de mensagens durante longas sessões do bot.
            if (this.processadas.size >= 1000) this.processadas.clear();
            this.processadas.add(chave);
        });
        this.sequencias.set(telefone, atual);
        try { await atual; } finally {
            if (this.sequencias.get(telefone) === atual) this.sequencias.delete(telefone);
        }
        return true;
    }

    private async processarAutorizado(
        mensagem: MensagemRecebida, telefone: string, atendente: Atendente
    ): Promise<void> {
        let ativo = this.ativos.get(telefone);
        if (!ativo) {
            const ticket = await this.fila.obterTicketAtivo(atendente);
            ativo = ticket?.getProtocolo();
            if (ativo) this.ativos.set(telefone, ativo);
        }

        const comando = mensagem.texto.trim().toLocaleLowerCase("pt-BR");
        if (comando === "encerrar") {
            if (!ativo) {
                await this.canal.enviarTexto(mensagem.enderecoResposta, 'Você não possui atendimento ativo. Envie "fila".');
                return;
            }
            try {
                await this.fila.encerrarAtendimento(ativo, atendente);
            } catch (erro) {
                if (!(erro instanceof TicketIndisponivelError || erro instanceof TicketNaoEncontradoError)) throw erro;
                await this.canal.enviarTexto(mensagem.enderecoResposta,
                    'Este atendimento já foi encerrado ou não pertence a você.');
                this.ativos.delete(telefone);
                return;
            }
            this.ativos.delete(telefone);
            this.selecoes.delete(telefone);
            await this.canal.enviarTexto(mensagem.enderecoResposta,
                `Atendimento ${ativo} encerrado. Envie "fila" para consultar novos casos.`);
            return;
        }

        if (ativo) {
            if (comando === "fila") {
                await this.canal.enviarTexto(mensagem.enderecoResposta,
                    `Você está atendendo o protocolo ${ativo}. Responda ao cliente ou envie "encerrar".`);
                return;
            }
            try {
                await this.fila.responderCliente(ativo, atendente, mensagem.texto,
                    (destino, texto) => this.canal.enviarTexto(destino, texto));
            } catch (erro) {
                if (erro instanceof TicketIndisponivelError || erro instanceof TicketNaoEncontradoError) {
                    this.ativos.delete(telefone);
                    await this.canal.enviarTexto(mensagem.enderecoResposta,
                        'Este atendimento não está mais ativo para você. Envie "fila".');
                    return;
                }
                if (erro instanceof Error && erro.message.startsWith('Endereço de resposta')) {
                    await this.canal.enviarTexto(mensagem.enderecoResposta, erro.message);
                    return;
                }
                throw erro;
            }
            await this.canal.enviarTexto(mensagem.enderecoResposta,
                `Resposta enviada ao cliente e registrada no histórico (${ativo}).`);
            return;
        }

        if (comando === "fila") {
            // Apaga lista anterior mesmo em fila vazia; números antigos deixam de ser aceitos.
            this.selecoes.delete(telefone);
            const tickets = await this.fila.listarFila();
            if (tickets.length === 0) {
                await this.canal.enviarTexto(mensagem.enderecoResposta, "Não há atendimentos aguardando no momento.");
                return;
            }
            this.selecoes.set(telefone, tickets.map(t => t.getProtocolo()));
            const agora = this.agora();
            const linhas = tickets.map((t, i) =>
                `${i + 1}. Protocolo: ${t.getProtocolo()} | Prioridade: ${t.getPrioridade()}\n` +
                `   Cliente: ${identificarCliente(t)} | Assunto: ${t.getAssunto()}\n` +
                `   Motivo: ${ROTULO_DO_MOTIVO[t.getMotivo()]} | Aguardando há ${formatarEspera(t.getDataAbertura(), agora)}`
            );
            await this.canal.enviarTexto(mensagem.enderecoResposta,
                `Fila de atendimentos (${tickets.length}):\n${linhas.join("\n\n")}\n\nResponda com o número do atendimento que deseja assumir.`);
            return;
        }

        if (/^[1-9]\d*$/.test(comando)) {
            const protocolos = this.selecoes.get(telefone);
            const indice = Number(comando) - 1;
            if (!protocolos) {
                await this.canal.enviarTexto(mensagem.enderecoResposta, 'Envie "fila" antes de escolher um atendimento.');
                return;
            }
            if (!Number.isSafeInteger(indice) || indice < 0 || indice >= protocolos.length) {
                await this.canal.enviarTexto(mensagem.enderecoResposta, 'Número inválido. Escolha uma opção da lista ou envie "fila" novamente.');
                return;
            }

            // Consome a seleção para não assumir outro ticket com o mesmo comando repetido.
            this.selecoes.delete(telefone);
            const protocolo = protocolos[indice];
            try {
                await this.fila.assumirTicket(protocolo, atendente);
            } catch (erro) {
                if (erro instanceof TicketIndisponivelError) {
                    await this.canal.enviarTexto(mensagem.enderecoResposta,
                        'Essa conversa já foi assumida por outra pessoa da equipe. Envie "fila" para atualizar a lista.');
                    return;
                }
                if (erro instanceof TicketNaoEncontradoError) {
                    await this.canal.enviarTexto(mensagem.enderecoResposta,
                        'Esse atendimento não está mais disponível. Envie "fila" para atualizar a lista.');
                    return;
                }
                throw erro;
            }

            // Marca como ativo antes da leitura do histórico: se a leitura falhar, o ticket continua recuperável.
            this.ativos.set(telefone, protocolo);
            // Ticket e histórico são recuperados após a atribuição persistida: nada depende de uma cópia antiga da fila.
            const ticket = await this.fila.obterTicket(protocolo);
            const historico = await this.fila.obterHistoricoDoTicket(protocolo);
            const linhas = historico.map(m => {
                const nome = m.getRemetente().getIdentificacao();
                return `[${m.getDataEnvio().toLocaleString("pt-BR")}] ${nome}: ${m.getTexto()}`;
            });
            await this.canal.enviarTexto(mensagem.enderecoResposta,
                `Novo atendimento — protocolo ${protocolo}\n\n` +
                `${this.dadosInformados(ticket)}\n\n` +
                (linhas.length ? `Histórico da conversa:\n${linhas.join("\n")}` : 'A conversa ainda não possui mensagens registradas.'));
            return;
        }

        await this.canal.enviarTexto(mensagem.enderecoResposta,
            'Comando do operador: envie "fila" para consultar atendimentos, selecione o número, responda ao cliente e use "encerrar" ao terminar.');
        return;
    }

    /** O que o cliente e o bot já levantaram: o operador lê isso antes do histórico e não pergunta de novo. */
    private dadosInformados(ticket: Ticket): string {
        const dados = ticket.getDados();
        const linhas = [
            "Dados já informados pelo cliente:",
            `• Cliente: ${identificarCliente(ticket)}`,
            `• Empresa: ${empresaDoCliente(ticket)}`,
            `• Assunto: ${ticket.getAssunto()}`,
            `• Motivo: ${ROTULO_DO_MOTIVO[ticket.getMotivo()]}`,
            `• Prioridade: ${ticket.getPrioridade()}`,
        ];
        const pergunta = textoDosDados(dados, "ultimaPergunta");
        if (pergunta) linhas.push(`• Pergunta sem resposta: "${pergunta}"`);
        const tentativa = textoDosDados(dados, "ultimaTentativa");
        if (tentativa) linhas.push(`• Última tentativa não entendida: "${tentativa}"`);
        linhas.push(`• Aguardou: ${formatarEspera(ticket.getDataAbertura(), this.agora())}`);
        return linhas.join("\n");
    }
}

/** Valida a configuração antes de iniciar o canal. */
export function lerVinculosOperadoresWhatsApp(json: string): VinculoOperadorWhatsApp[] {
    let valor: unknown;
    try { valor = JSON.parse(json); } catch { throw new Error("OPERADORES_WHATSAPP_JSON deve ser JSON válido."); }
    if (!Array.isArray(valor)) throw new Error("OPERADORES_WHATSAPP_JSON deve ser uma lista.");
    return valor.map((item: unknown) => {
        if (typeof item !== "object" || item === null) throw new Error("Vínculo de operador inválido.");
        const { id, telefone } = item as Record<string, unknown>;
        if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || typeof telefone !== "string") {
            throw new Error("Vínculo de operador inválido: informe id numérico e telefone como string.");
        }
        return { id, telefone };
    });
}
