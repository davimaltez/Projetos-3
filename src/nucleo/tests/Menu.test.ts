import { test } from "node:test";
import assert from "node:assert/strict";
import { Menu } from "../Menu.js";
import type { SubTopico, Topico } from "../Topicos.js";

function topico(id: Topico["id"], caminho: Topico["caminho"], rotulo: string, filhos?: readonly SubTopico[]): Topico {
  return { id, caminho, rotulo, descricao: "x", respostaProvisoria: `resposta de ${rotulo}`, ativo: true, somenteAdmin: false, filhos };
}

const menu = new Menu([
  topico("status_demanda", 1, "Status"),
  topico("operacao_sistema", 2, "Operação", [
    { id: "acesso", rotulo: "Entrar", resposta: "Use seu e-mail." },
    { id: "problemas", rotulo: "Problemas", filhos: [{ id: "senha", rotulo: "Senha", resposta: "Toque em Esqueci." }] },
  ]),
]);

test("menu principal numera os tópicos", () => {
  assert.match(menu.texto(), /1 - Status\n2 - Operação/);
});

test("lerNumero aceita '2)' e ' 3 ' e recusa texto", () => {
  assert.equal(menu.lerNumero("2)"), 2);
  assert.equal(menu.lerNumero(" 3 "), 3);
  assert.equal(menu.lerNumero("oi"), null);
});

test("texto livre vira 'livre' (vai para a IA)", () => {
  assert.equal(menu.interpretar("cadê meu pedido?").tipo, "livre");
});

test("tópico sem filhos responde direto", () => {
  const r = menu.interpretar("1");
  assert.equal(r.tipo, "opcao");
  if (r.tipo === "opcao") assert.equal(r.texto, "resposta de Status");
});

test("tópico com filhos abre o sub-menu e guarda o caminho", () => {
  const r = menu.interpretar("2");
  assert.equal(r.tipo, "navegacao");
  if (r.tipo === "navegacao") {
    assert.deepEqual(r.novoCaminho, ["operacao_sistema"]);
    assert.match(r.texto, /0 - Voltar/);
  }
});

test("desce dois níveis, responde a folha e volta com 0", () => {
  const n2 = menu.interpretar("2", ["operacao_sistema"]);
  assert.equal(n2.tipo === "navegacao" && n2.novoCaminho.join("/"), "operacao_sistema/problemas");
  const folha = menu.interpretar("1", ["operacao_sistema", "problemas"]);
  assert.equal(folha.tipo === "opcao" && folha.texto, "Toque em Esqueci.");
  const voltar = menu.interpretar("0", ["operacao_sistema", "problemas"]);
  assert.equal(voltar.tipo === "navegacao" && voltar.novoCaminho.join("/"), "operacao_sistema");
});

test("número inválido reexibe o nível atual com o aviso", () => {
  const r = menu.interpretar("9", ["operacao_sistema"]);
  assert.equal(r.tipo, "invalida");
  if (r.tipo === "invalida") {
    assert.match(r.texto, /^Não encontrei essa opção\./);
    assert.match(r.texto, /1 - Entrar/);
    assert.deepEqual(r.novoCaminho, ["operacao_sistema"]);
  }
});

test("0 no menu principal é inválido; caminho obsoleto cai no principal", () => {
  assert.equal(menu.interpretar("0").tipo, "invalida");
  assert.equal(menu.interpretar("1", ["nao_existe"]).tipo, "opcao");
});

test("abrirTopico só abre quem tem filhos", () => {
  assert.equal(menu.abrirTopico(topico("status_demanda", 1, "Status")), null);
  assert.deepEqual(menu.abrirTopico(topico("operacao_sistema", 2, "Operação", [{ id: "a", rotulo: "A", resposta: "x" }]))?.novoCaminho, ["operacao_sistema"]);
});