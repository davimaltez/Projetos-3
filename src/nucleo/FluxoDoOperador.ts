import type { CanalMensagens, MensagemRecebida } from "./CanalMensagens.js";
import type { ServicoDeFila } from "./ServicoDeFila.js";
import type { Atendente } from "./entidades/Atendente.js";
import { TicketIndisponivelError, TicketNaoEncontradoError } from "./ErrosDaFila.js";

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
            const linhas = tickets.map((t, i) =>
                `${i + 1}. Protocolo: ${t.getProtocolo()} | ${t.getAssunto()} | Prioridade: ${t.getPrioridade()}`
            );
            await this.canal.enviarTexto(mensagem.enderecoResposta,
                `Fila de atendimentos (${tickets.length}):\n${linhas.join("\n")}\n\nResponda com o número do atendimento que deseja assumir.`);
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
            // Histórico é recuperado após a atribuição persistida: nada depende de uma cópia antiga da fila.
            const historico = await this.fila.obterHistoricoDoTicket(protocolo);
            const linhas = historico.map(m => {
                const nome = m.getRemetente().getIdentificacao();
                return `[${m.getDataEnvio().toLocaleString("pt-BR")}] ${nome}: ${m.getTexto()}`;
            });
            await this.canal.enviarTexto(mensagem.enderecoResposta,
                `Novo atendimento — protocolo ${protocolo}\n` +
                (linhas.length ? `Histórico da conversa:\n${linhas.join("\n")}` : 'A conversa ainda não possui mensagens registradas.'));
            return;
        }

        await this.canal.enviarTexto(mensagem.enderecoResposta,
            'Comando do operador: envie "fila" para consultar atendimentos, selecione o número, responda ao cliente e use "encerrar" ao terminar.');
        return;
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
