import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Atendimento } from "../Atendimento.js";
import type { CanalMensagens, MensagemRecebida } from "../CanalMensagens.js";
import type { Classificacao, ClassificadorDeIntencao } from "../ClassificadorDeIntencao.js";
import { LimitadorDeTaxa } from "../LimitadorDeTaxa.js";
import { Menu } from "../Menu.js";
import type { RepositorioDeServicos, ServicoContratado } from "../RepositorioDeServicos.js";
import { RespostaDeServicoContratado, type ResolvedorDeResposta } from "../RespostaDeServicoContratado.js";
import { TOPICOS, topicosDoMenu } from "../Topicos.js";

// Dados fictícios: nenhuma configuração, credencial ou serviço externo é usado.
const CONVERSA = 10;
const menu = new Menu(topicosDoMenu());
const provisoria = TOPICOS.find((t) => t.id === "servico_contratado")!.respostaProvisoria;
const numeroNoMenu = String(topicosDoMenu().findIndex((t) => t.id === "servico_contratado") + 1);

const suporte: ServicoContratado = {
  nome: "Suporte Mensal",
  descricao: "Atendimento técnico por telefone e WhatsApp.",
  status: "EM_DIA",
  dataInicio: new Date(2025, 2, 10),
};
const hospedagem: ServicoContratado = {
  nome: "Hospedagem",
  descricao: null,
  status: "SUSPENSO",
  dataInicio: new Date(2026, 0, 2),
};

/** Repositório em memória: serviços por conversa. `falhar` simula o banco fora do ar. */
class RepositorioDeServicosEmMemoria implements RepositorioDeServicos {
  consultas = 0;
  constructor(
    private readonly porConversa: ReadonlyMap<number, readonly ServicoContratado[]>,
    private readonly falhar = false
  ) {}

  async listarAtivosDaConversa(conversaId: number): Promise<ServicoContratado[]> {
    this.consultas++;
    if (this.falhar) throw new Error("banco indisponível");
    return [...(this.porConversa.get(conversaId) ?? [])];
  }
}

function repositorio(servicos: readonly ServicoContratado[], falhar = false): RepositorioDeServicosEmMemoria {
  return new RepositorioDeServicosEmMemoria(new Map([[CONVERSA, servicos]]), falhar);
}

describe("RespostaDeServicoContratado", () => {
  test("cliente com 1 serviço: nome, descrição, situação e data em linguagem simples", async () => {
    const texto = await new RespostaDeServicoContratado(repositorio([suporte]), menu).responder(CONVERSA);
    assert.match(texto, /^Estes são os serviços ativos no seu cadastro:/);
    assert.match(texto, /\*Suporte Mensal\*\nAtendimento técnico por telefone e WhatsApp\.\nSituação: em dia\nDesde: 10\/03\/2025/);
    assert.doesNotMatch(texto, /EM_DIA/);
  });

  test("cliente com vários serviços: lista todos, na ordem do repositório", async () => {
    const texto = await new RespostaDeServicoContratado(repositorio([suporte, hospedagem]), menu).responder(CONVERSA);
    assert.ok(texto.indexOf("*Suporte Mensal*") < texto.indexOf("*Hospedagem*"));
    // Sem descrição: a linha não aparece (nada é inventado).
    assert.match(texto, /\*Hospedagem\*\nSituação: suspenso\nDesde: 02\/01\/2026/);
  });

  test("cliente sem serviço: diz isso claramente e oferece o menu", async () => {
    const texto = await new RespostaDeServicoContratado(repositorio([]), menu).responder(CONVERSA);
    assert.match(texto, /^Não encontrei nenhum serviço ativo no seu cadastro\./);
    assert.ok(texto.endsWith(menu.texto()));
  });

  test("falha do repositório segue adiante (quem chama decide o texto de reserva)", async () => {
    await assert.rejects(new RespostaDeServicoContratado(repositorio([], true), menu).responder(CONVERSA), /banco indisponível/);
  });
});

// ---------- Atendimento com fakes em memória ----------

class CanalFalso implements CanalMensagens {
  readonly nome = "teste";
  readonly enviados: string[] = [];
  async iniciar(): Promise<void> {}
  async indicarDigitando(): Promise<void> {}
  async enviarTexto(_endereco: string, texto: string): Promise<string> {
    this.enviados.push(texto);
    return `saida-${this.enviados.length}`;
  }
  estaConectado(): boolean {
    return true;
  }
  async encerrar(): Promise<void> {}
}

function classificadorQueResponde(classificacao: Classificacao): ClassificadorDeIntencao {
  return { nome: "falso", classificar: async () => classificacao };
}

function criarAtendimento(servicos: RepositorioDeServicos | ResolvedorDeResposta, classificador: ClassificadorDeIntencao | null = null) {
  const canal = new CanalFalso();
  let proximaEntrada = 1;
  const atendimento = new Atendimento(
    canal,
    { obterOuCriar: async () => 1 },
    { obterOuCriarAtual: async () => CONVERSA },
    { registrarEntrada: async () => proximaEntrada++, registrarSaida: async () => {}, marcarProcessada: async () => {} },
    { registrar: async () => {} },
    { obterCaminho: async () => [], salvarCaminho: async () => {} },
    classificador,
    menu,
    {
      confiancaMinima: 0.6,
      avisosDeInstabilidade: new LimitadorDeTaxa(1, 60_000),
      avisosDeExcesso: new LimitadorDeTaxa(1, 60_000),
      limiteDeMensagens: null,
    },
    "responder" in servicos ? servicos : new RespostaDeServicoContratado(servicos, menu)
  );
  return { atendimento, canal };
}

let sequencia = 0;
function mensagem(texto: string): MensagemRecebida {
  sequencia++;
  return { idExterno: `msg-${sequencia}`, remetente: "5581999990001", enderecoResposta: "5581999990001", texto };
}

describe("Atendimento com o tópico servico_contratado", () => {
  test("o tópico está ativo e aparece no menu do cliente", () => {
    assert.notEqual(numeroNoMenu, "0");
    assert.match(menu.texto(), new RegExp(`${numeroNoMenu} - Meu serviço contratado`));
  });

  test("via número do menu: responde com os serviços do cliente, sem chamar a IA", async () => {
    let chamouIa = false;
    const ia: ClassificadorDeIntencao = {
      nome: "falso",
      classificar: async () => {
        chamouIa = true;
        return { topico: null, confianca: 0 };
      },
    };
    const { atendimento, canal } = criarAtendimento(repositorio([suporte]), ia);
    await atendimento.processar(mensagem(numeroNoMenu));
    assert.equal(chamouIa, false);
    assert.equal(canal.enviados.length, 1);
    assert.match(canal.enviados[0], /\*Suporte Mensal\*/);
  });

  test("via IA: pergunta em texto livre responde com os serviços do cliente", async () => {
    const ia = classificadorQueResponde({ topico: "servico_contratado", confianca: 0.9 });
    const { atendimento, canal } = criarAtendimento(repositorio([suporte, hospedagem]), ia);
    await atendimento.processar(mensagem("qual é o meu plano?"));
    assert.equal(canal.enviados.length, 1);
    assert.match(canal.enviados[0], /\*Suporte Mensal\*[\s\S]*\*Hospedagem\*/);
  });

  test("falha do repositório: cliente recebe o texto provisório (nunca fica sem resposta)", async () => {
    for (const [texto, ia] of [
      [numeroNoMenu, null],
      ["qual é o meu plano?", classificadorQueResponde({ topico: "servico_contratado", confianca: 0.9 })],
    ] as const) {
      const { atendimento, canal } = criarAtendimento(repositorio([suporte], true), ia);
      await atendimento.processar(mensagem(texto));
      assert.deepEqual(canal.enviados, [provisoria]);
    }
  });

  test("resolvedor que devolve null: cliente recebe o texto provisório", async () => {
    const { atendimento, canal } = criarAtendimento({ responder: async () => null });
    await atendimento.processar(mensagem(numeroNoMenu));
    assert.deepEqual(canal.enviados, [provisoria]);
  });

  test("outros tópicos não consultam os serviços", async () => {
    const servicos = repositorio([suporte]);
    const ia = classificadorQueResponde({ topico: "status_demanda", confianca: 0.9 });
    const { atendimento, canal } = criarAtendimento(servicos, ia);
    await atendimento.processar(mensagem("cadê meu pedido?"));
    assert.equal(servicos.consultas, 0);
    assert.doesNotMatch(canal.enviados[0], /Suporte Mensal/);
  });
});
