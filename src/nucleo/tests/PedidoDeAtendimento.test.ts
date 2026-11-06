import { test } from "node:test";
import assert from "node:assert/strict";
import { PEDIDO_PADRAO, validarPedido, type PedidoDeAtendimento } from "../PedidoDeAtendimento.js";
import { MotivoDaTransferencia, PrioridadeTicket } from "../entidades/Enums.js";

const valido: PedidoDeAtendimento = {
  assunto: "  Dúvida sobre o sistema ",
  prioridade: PrioridadeTicket.MEDIA,
  motivo: MotivoDaTransferencia.PERGUNTA_SEM_RESPOSTA,
  dados: { topico: "operacao_sistema", ultimaPergunta: "como emito nota fiscal?" },
};

test("o pedido padrão é o pedido explícito do cliente, como era antes", () => {
  assert.equal(PEDIDO_PADRAO.assunto, "Atendimento humano");
  assert.equal(PEDIDO_PADRAO.prioridade, PrioridadeTicket.MEDIA);
  assert.equal(PEDIDO_PADRAO.motivo, MotivoDaTransferencia.PEDIDO_DO_CLIENTE);
  assert.deepEqual(PEDIDO_PADRAO.dados, {});
  assert.doesNotThrow(() => validarPedido(PEDIDO_PADRAO));
});

test("validarPedido tira os espaços do assunto e devolve uma cópia dos dados", () => {
  const ok = validarPedido(valido);
  assert.equal(ok.assunto, "Dúvida sobre o sistema");
  assert.deepEqual(ok.dados, valido.dados);
  assert.notEqual(ok.dados, valido.dados);
});

test("aceita cada motivo e cada prioridade", () => {
  for (const motivo of Object.values(MotivoDaTransferencia)) {
    for (const prioridade of Object.values(PrioridadeTicket)) {
      assert.doesNotThrow(() => validarPedido({ ...valido, motivo, prioridade }));
    }
  }
});

test("recusa assunto vazio ou grande demais", () => {
  assert.throws(() => validarPedido({ ...valido, assunto: "   " }), /assunto/);
  assert.throws(() => validarPedido({ ...valido, assunto: "a".repeat(121) }), /assunto/);
});

test("recusa prioridade e motivo que não existem", () => {
  assert.throws(() => validarPedido({ ...valido, prioridade: "ENORME" as PrioridadeTicket }), /Prioridade/);
  assert.throws(() => validarPedido({ ...valido, motivo: "PORQUE_SIM" as MotivoDaTransferencia }), /Motivo/);
});

test("recusa dados que não são um objeto, não viram JSON ou são grandes demais", () => {
  assert.throws(() => validarPedido({ ...valido, dados: [] as unknown as Record<string, unknown> }), /objeto/);
  const circular: Record<string, unknown> = {};
  circular.eu = circular;
  assert.throws(() => validarPedido({ ...valido, dados: circular }), /JSON/);
  assert.throws(() => validarPedido({ ...valido, dados: { texto: "x".repeat(4_001) } }), /passam de/);
});