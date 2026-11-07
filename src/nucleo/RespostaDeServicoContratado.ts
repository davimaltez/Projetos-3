import type { Menu } from "./Menu.js";
import type { RepositorioDeServicos, ServicoContratado, StatusServico } from "./RepositorioDeServicos.js";

/**
 * Resposta que depende do cliente (e não só do tópico). O Atendimento recebe isto pelo
 * construtor e chama quando o tópico decidido é `servico_contratado`.
 * null = sem resposta própria: o Atendimento usa o texto provisório do tópico.
 */
export interface ResolvedorDeResposta {
  responder(conversaId: number): Promise<string | null>;
}

const TEXTO_SEM_SERVICO =
  "Não encontrei nenhum serviço ativo no seu cadastro. Se achar que é um engano, fale com a nossa equipe.";
const CABECALHO = "Estes são os serviços ativos no seu cadastro:";
const RODAPE = "Se tiver outra dúvida, é só mandar.";

/** História 1.6: situação em palavras simples, sem os códigos do banco. */
const SITUACAO: Record<StatusServico, string> = {
  EM_DIA: "em dia",
  PENDENTE: "com pendência",
  SUSPENSO: "suspenso",
};

/**
 * História 1.3: responde com os serviços do próprio cliente. Só mostra o que veio do
 * repositório; sem serviço cadastrado, diz isso e mostra o menu (nada é inventado).
 * Erros do repositório seguem adiante: quem chama decide o texto de reserva.
 */
export class RespostaDeServicoContratado implements ResolvedorDeResposta {
  constructor(
    private readonly servicos: RepositorioDeServicos,
    private readonly menu: Menu
  ) {}

  async responder(conversaId: number): Promise<string> {
    const servicos = await this.servicos.listarAtivosDaConversa(conversaId);
    if (servicos.length === 0) return `${TEXTO_SEM_SERVICO}\n\n${this.menu.texto()}`;
    return [CABECALHO, ...servicos.map(descrever), RODAPE].join("\n\n");
  }
}

function descrever(servico: ServicoContratado): string {
  const linhas = [`*${servico.nome}*`];
  if (servico.descricao) linhas.push(servico.descricao);
  linhas.push(`Situação: ${SITUACAO[servico.status] ?? "a confirmar com a nossa equipe"}`);
  linhas.push(`Desde: ${formatarData(servico.dataInicio)}`);
  return linhas.join("\n");
}

/** dd/mm/aaaa. O pg entrega DATE como meia-noite no fuso local, então lê os campos locais. */
function formatarData(data: Date): string {
  const dd = String(data.getDate()).padStart(2, "0");
  const mm = String(data.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${data.getFullYear()}`;
}
