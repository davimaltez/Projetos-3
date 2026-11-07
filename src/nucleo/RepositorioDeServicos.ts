/**
 * Serviços contratados pelo cliente (história 1.3), no mesmo padrão de Repositorios.ts:
 * a interface mora no núcleo e a classe que fala com o Postgres mora em repositorios/.
 */

/** Situação do serviço, igual ao CHECK de servicos_contratados.status. */
export type StatusServico = "EM_DIA" | "PENDENTE" | "SUSPENSO";

export interface ServicoContratado {
  readonly nome: string;
  readonly descricao: string | null;
  readonly status: StatusServico;
  readonly dataInicio: Date;
}

export interface RepositorioDeServicos {
  /** Serviços ativos do cliente dono da conversa, do mais antigo para o mais recente. Vazio se não houver. */
  listarAtivosDaConversa(conversaId: number): Promise<ServicoContratado[]>;
}
