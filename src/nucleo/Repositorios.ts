/**
 * O que o núcleo precisa do armazenamento, sem saber que existe SQL, Postgres ou o pacote pg.
 *
 * As interfaces moram no NÚCLEO (quem precisa define o contrato); as classes que falam
 * com o Postgres moram em repositorios/ e as implementam. Nos testes, basta uma classe (ou
 * um objeto) em memória que cumpra a mesma interface.
 */

export interface RepositorioDeClientes {
  /** Devolve o id do cliente com esse identificador (telefone, ou LID quando não há telefone); cria se não existir. */
  obterOuCriar(identificador: string, origem: string): Promise<number>;
}

export interface RepositorioDeConversas {
  /** Devolve o id da conversa em andamento do cliente; cria se não existir. */
  obterOuCriarAtual(clienteId: number): Promise<number>;
}

export interface RepositorioDeMensagens {
  /**
   * Grava a mensagem recebida e devolve o id da linha a processar.
   * Devolve null se essa mensagem já foi processada (respondida e gravada): duplicata.
   * Se ela já existe mas NÃO foi processada, devolve o id que já existe: é para reprocessar.
   */
  registrarEntrada(conversaId: number, idExterno: string, texto: string): Promise<number | null>;
  registrarSaida(conversaId: number, idExterno: string, texto: string): Promise<void>;
  marcarProcessada(id: number): Promise<void>;
}

export interface NovoEvento {
  conversaId: number;
  tipo: string;
  origem: string;
  /** Caminho usado (1 a 5). null = menu exibido. */
  caminho: number | null;
  intencao: string | null;
  usouLlm: boolean;
  dados: Record<string, unknown>;
}

export interface RepositorioDeEventos {
  registrar(evento: NovoEvento): Promise<void>;
}
