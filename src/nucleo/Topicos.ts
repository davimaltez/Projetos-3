/**
 * Os tópicos (caminhos) de atendimento, como definidos no backlog (história 1.2).
 *
 * `caminho` é o número fixo gravado no banco (1 a 5), usado pelo relatório.
 * O número que o usuário digita no menu é outro: a posição entre os tópicos ATIVOS.
 * Assim, desligar um tópico não deixa buracos no menu ("1, 2, 5").
 */
export type IdTopico =
  | "status_demanda"
  | "operacao_sistema"
  | "topico_3"
  | "topico_4"
  | "relatorio_admin";

export interface Topico {
  readonly id: IdTopico;
  readonly caminho: 1 | 2 | 3 | 4 | 5;
  /** Texto curto exibido no menu. */
  readonly rotulo: string;
  /** Descrição usada pela IA para decidir. Quanto mais concreta, melhor a classificação. */
  readonly descricao: string;
  /**
   * Resposta enquanto o caminho real não está implementado.
   * História 1.6: linguagem simples, sem jargão técnico ("API", "caminho", "base
   * de conhecimento") e sem gíria. Escreva como se falasse com qualquer cliente.
   */
  readonly respostaProvisoria: string;
  /** Tópicos inativos não aparecem no menu nem são oferecidos à IA. */
  readonly ativo: boolean;
  /** Não aparece no menu do cliente (a IA ainda pode reconhecer o pedido). */
  readonly somenteAdmin: boolean;
}

export const TOPICOS: readonly Topico[] = [
  {
    id: "status_demanda",
    caminho: 1,
    rotulo: "Status de uma demanda",
    descricao:
      "O usuário quer saber o andamento, situação, prazo ou previsão de entrega de uma demanda, pedido, chamado ou solicitação que já fez.",
    respostaProvisoria:
      "Entendi: você quer saber o andamento de uma demanda. Essa consulta ainda está sendo preparada e em breve estará disponível por aqui.",
    ativo: true,
    somenteAdmin: false,
  },
  {
    id: "operacao_sistema",
    caminho: 2,
    rotulo: "Dúvida sobre como usar o sistema",
    descricao:
      "O usuário quer saber como usar uma funcionalidade do sistema: como fazer algo, onde fica uma opção, como cadastrar, acessar ou configurar.",
    respostaProvisoria:
      "Entendi: você tem uma dúvida sobre como usar o sistema. As respostas para esse tipo de dúvida ainda estão sendo preparadas e em breve estarão disponíveis por aqui.",
    ativo: true,
    somenteAdmin: false,
  },
  {
    id: "topico_3",
    caminho: 3,
    rotulo: "Tópico 3",
    descricao: "A definir: depende das perguntas frequentes que a WXN ainda vai informar.",
    respostaProvisoria: "Esse assunto ainda não está disponível por aqui.",
    ativo: false,
    somenteAdmin: false,
  },
  {
    id: "topico_4",
    caminho: 4,
    rotulo: "Tópico 4",
    descricao: "A definir: depende das perguntas frequentes que a WXN ainda vai informar.",
    respostaProvisoria: "Esse assunto ainda não está disponível por aqui.",
    ativo: false,
    somenteAdmin: false,
  },
  {
    id: "relatorio_admin",
    caminho: 5,
    rotulo: "Relatório de atendimentos (administradores)",
    descricao:
      "Um administrador pede números da operação do chatbot: total de atendimentos, satisfação, volume por dia ou horário, tópicos mais perguntados.",
    respostaProvisoria:
      "Recebi seu pedido de relatório. Essa função ainda está sendo preparada e em breve estará disponível por aqui.",
    ativo: true,
    somenteAdmin: true,
  },
];

export function topicosAtivos(): readonly Topico[] {
  return TOPICOS.filter((t) => t.ativo);
}

/** O que aparece no menu do cliente: ativos e não restritos a administradores. */
export function topicosDoMenu(): readonly Topico[] {
  return topicosAtivos().filter((t) => !t.somenteAdmin);
}
