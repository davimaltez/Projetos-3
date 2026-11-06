import type { CanalMensagens, MensagemRecebida } from "./CanalMensagens.js";
import type { ServicoDeFila } from "./ServicoDeFila.js";
import type { Atendente } from "./entidades/Atendente.js";

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
 * Primeira fatia do fluxo do operador: reconhecimento por telefone cadastrado e comando "fila".
 * O serviço de domínio continua independente do WhatsApp, e a autenticação HTTP existente é preservada.
 */
export class FluxoDoOperador {
    private readonly porTelefone = new Map<string, Atendente>();

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

    /** Retorna true quando a mensagem pertence ao canal de operadores. */
    async processarSeOperador(mensagem: MensagemRecebida): Promise<boolean> {
        const telefone = normalizarTelefone(mensagem.remetente);
        if (!telefone || !this.porTelefone.has(telefone)) return false;

        const comando = mensagem.texto.trim().toLocaleLowerCase("pt-BR");
        if (comando !== "fila") {
            await this.canal.enviarTexto(mensagem.enderecoResposta, 'Comando do operador: envie "fila" para consultar os atendimentos pendentes.');
            return true;
        }

        const tickets = await this.fila.listarFila();
        if (tickets.length === 0) {
            await this.canal.enviarTexto(mensagem.enderecoResposta, "Não há atendimentos aguardando no momento.");
            return true;
        }
        const linhas = tickets.map((t, i) =>
            `${i + 1}. Protocolo: ${t.getProtocolo()} | ${t.getAssunto()} | Prioridade: ${t.getPrioridade()}`
        );
        await this.canal.enviarTexto(mensagem.enderecoResposta,
            `Fila de atendimentos (${tickets.length}):\n${linhas.join("\n")}\n\nA opção de assumir pelo número será habilitada na próxima etapa.`);
        return true;
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
