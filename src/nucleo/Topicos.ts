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
  | "servico_contratado"
  | "topico_4"
  | "relatorio_admin";

/**
 * Nó de uma sub-árvore do menu (história 1.1). O id é livre (string) de propósito:
 * sub-tópicos NÃO entram no enum do Gemini, que continua vendo só os tópicos de primeiro nível.
 */
export interface SubTopico {
  readonly id: string;
  /** Texto da opção no menu. */
  readonly rotulo: string;
  /** Folha: texto enviado ao cliente (linguagem simples, história 1.6). */
  readonly resposta?: string;
  /** Com filhos, a opção abre um sub-menu em vez de responder. */
  readonly filhos?: readonly SubTopico[];
}

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
  /**
   * Sub-árvore de opções (história 1.1). Se existir (e não for vazia), escolher este tópico
   * abre um sub-menu em vez de enviar respostaProvisoria. Os filhos não são vistos pela IA.
   */
  readonly filhos?: readonly SubTopico[];
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
    // EXEMPLO de sub-menu (textos ilustrativos, trocar quando a WXN enviar o manual).
    filhos: [
      {
        id: "acesso",
        rotulo: "Entrar no sistema",
        resposta: "Para entrar, use o seu e-mail e a sua senha na tela inicial.",
      },
      {
        id: "problemas",
        rotulo: "Estou com um problema",
        filhos: [
          {
            id: "senha",
            rotulo: "Esqueci minha senha",
            resposta: 'Na tela de entrada, toque em "Esqueci minha senha".',
          },
          {
            id: "lento",
            rotulo: "O sistema está lento",
            resposta: "Feche e abra o sistema de novo. Se continuar, avise a gente.",
          },
        ],
      },
    ],
  },
  {
    id: "servico_contratado",
    caminho: 3,
    rotulo: "Meu serviço contratado",
    descricao:
      "O cliente quer saber sobre o serviço que contratou com a empresa: qual é o serviço ou plano, o que está incluído, desde quando tem, se está em dia ou suspenso.",
    respostaProvisoria:
      "Entendi: você quer saber sobre o seu serviço contratado. No momento não consegui consultar o seu cadastro. Tente de novo em alguns minutos.",
    ativo: true,
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