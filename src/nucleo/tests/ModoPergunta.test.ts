
import assert from "node:assert/strict";
import { test } from "node:test";

import { Atendimento } from "../Atendimento.js";
import type { GeradorDeResposta } from "../GeradorDeResposta.js";
import { LimitadorDeTaxa } from "../LimitadorDeTaxa.js";
import { Menu } from "../Menu.js";
import type { EstadoDoMenu, NovoEvento } from "../Repositorios.js";
import { ServicoDeFila } from "../ServicoDeFila.js";
import { topicosDoMenu } from "../Topicos.js";

import { Atendente } from "../entidades/Atendente.js";
import { Chatbot } from "../entidades/Chatbot.js";
import { Cliente } from "../entidades/Cliente.js";
import { Conversa } from "../entidades/Conversa.js";
import { Mensagem } from "../entidades/Mensagem.js";

import { RepositorioDeFilaEmMemoria } from "../../repositorios/RepositorioDeFilaEmMemoria.js";
import { CanalSimulado } from "./apoio/CanalSimulado.js";

function cenario(gerador: GeradorDeResposta) {
    const cliente = new Cliente(
        1,
        "Cliente",
        "cliente@example.com",
        "5581999999999"
    );

    const bot = new Chatbot("wxn", "Bot", "simples", 2, true);

    const conversa = new Conversa(
        1,
        "simulado",
        cliente,
        bot
    );

    const repositorio = new RepositorioDeFilaEmMemoria(
        [],
        [new Atendente(2, "Operador", "operador@example.com")],
        [conversa]
    );

    const fila = new ServicoDeFila(repositorio);
    const canal = new CanalSimulado();

    const eventos: NovoEvento[] = [];

    const entradas = new Map<
        string,
        { id: number; processada: boolean }
    >();

    let estado: EstadoDoMenu = {
        caminho: [],
        perguntando: false,
        historico: [],
        falhasSeguidas: 0,
        transferenciaPendente: null
    };

    let contador = 0;

    const atendimento = new Atendimento(
        canal,

        {
            obterOuCriar: async () => 1,
            obterPorId: async () => ({
                nome: "Cliente",
                empresa: "Empresa Teste",
                telefone: "5581999999999"
            })
        },

        {
            obterOuCriarAtual: async () => 1
        },

        {
            registrarEntrada: async (
                _conversaId,
                idExterno,
                texto
            ) => {
                const anterior = entradas.get(idExterno);

                if (anterior) {
                    return anterior.processada ? null : anterior.id;
                }

                const id = entradas.size + 1;

                entradas.set(idExterno, {
                    id,
                    processada: false
                });

                conversa.adicionarMensagem(
                    new Mensagem(texto, new Date(), cliente)
                );

                return id;
            },

            registrarSaida: async (
                _conversaId,
                _idExterno,
                texto
            ) => {
                conversa.adicionarMensagem(
                    new Mensagem(texto, new Date(), bot)
                );
            },

            marcarProcessada: async (id) => {
                const entrada = [...entradas.values()].find(
                    (item) => item.id === id
                );

                if (!entrada) {
                    throw new Error("Entrada nao encontrada no teste");
                }

                entrada.processada = true;
            }
        },

        {
            registrar: async (evento) => {
                eventos.push(evento);
            }
        },

        {
            obter: async () => estado,

            salvar: async (_id, novo) => {
                estado = {
                    caminho: [...novo.caminho],
                    perguntando: novo.perguntando,
                    historico: [...novo.historico],
                    falhasSeguidas: novo.falhasSeguidas ?? 0,
                    transferenciaPendente:
                        novo.transferenciaPendente ?? null
                };
            }
        },

        null,

        new Menu(topicosDoMenu()),

        {
            confiancaMinima: 0.6,
            limiteDeMensagens: null,
            avisosDeInstabilidade: new LimitadorDeTaxa(
                1,
                60_000
            ),
            avisosDeExcesso: new LimitadorDeTaxa(
                1,
                60_000
            )
        },

        fila,

        gerador
    );

    const enviar = (texto: string) =>
        atendimento.processar({
            texto,
            idExterno: `modo-pergunta-${++contador}`,
            remetente: "cliente-simulado",
            enderecoResposta: "endereco-simulado"
        });

    const entrarNoModo = async () => {
        await enviar("2");
        await enviar("3");

        assert.equal(estado.perguntando, true);
    };

    return {
        enviar,
        entrarNoModo,
        canal,
        eventos,
        fila,
        getEstado: () => estado
    };
}

test(
    "modo pergunta: entra e sai com 0 sem chamar gerador",
    async () => {
        let chamadas = 0;

        const c = cenario({
            nome: "mock",
            gerar: async () => {
                chamadas++;
                return {
                    encontrou: true,
                    texto: "Resposta"
                };
            }
        });

        await c.entrarNoModo();
        await c.enviar("0");

        assert.equal(c.getEstado().perguntando, false);
        assert.equal(chamadas, 0);

        assert.match(
            c.canal.enviadas.at(-1)!.texto,
            /Escolha uma opção/
        );

        assert.equal(c.eventos.at(-1)?.origem, "menu");
    }
);

test(
    "modo pergunta: pergunta sem resposta oferece atendimento humano",
    async () => {
        const c = cenario({
            nome: "mock",
            gerar: async () => ({
                encontrou: false,
                texto: "CONTEUDO_NAO_AUTORIZADO"
            })
        });

        await c.entrarNoModo();

        await c.enviar(
            "Como exportar um relatório especial?"
        );

        const resposta = c.canal.enviadas.at(-1)!.texto;

        assert.match(
            resposta,
            /Deseja falar com um atendente humano/
        );

        assert.doesNotMatch(
            resposta,
            /CONTEUDO_NAO_AUTORIZADO/
        );

        assert.equal(
            c.eventos.at(-1)?.origem,
            "ia_sem_resposta"
        );

        assert.ok(
            c.getEstado().transferenciaPendente
        );

        // A oferta ainda nao deve criar um ticket.
        const tickets = await c.fila.listarFila();
        assert.equal(tickets.length, 0);
    }
);

test(
    "modo pergunta: falha do gerador apresenta resposta segura",
    async () => {
        const c = cenario({
            nome: "mock",
            gerar: async () => {
                throw new Error("gerador indisponível");
            }
        });

        await c.entrarNoModo();

        await c.enviar(
            "Como altero minhas configurações?"
        );

        assert.match(
            c.canal.enviadas.at(-1)!.texto,
            /Não consegui responder agora/
        );

        assert.equal(
            c.eventos.at(-1)?.origem,
            "ia_gerada_falhou"
        );

        assert.equal(c.getEstado().perguntando, true);
    }
);

test(
    "modo pergunta: pedido explícito de atendente nao chama gerador",
    async () => {
        let chamadas = 0;

        const c = cenario({
            nome: "mock",
            gerar: async () => {
                chamadas++;

                return {
                    encontrou: true,
                    texto: "Indevido"
                };
            }
        });

        await c.entrarNoModo();
        await c.enviar("atendente");

        const tickets = await c.fila.listarFila();

        assert.equal(tickets.length, 1);
        assert.equal(chamadas, 0);

        assert.match(
            c.canal.enviadas.at(-1)!.texto,
            /Protocolo:/
        );

        assert.equal(
            c.eventos.at(-1)?.origem,
            "menu"
        );

        assert.equal(
            c.getEstado().perguntando,
            false
        );
    }
);

test(
    "modo pergunta: resposta coberta mantém histórico",
    async () => {
        const historicos: number[] = [];

        const c = cenario({
            nome: "mock",

            gerar: async (_pergunta, historico) => {
                historicos.push(historico.length);

                return {
                    encontrou: true,
                    texto: "Resposta do manual"
                };
            }
        });

        await c.entrarNoModo();

        await c.enviar(
            "Como cadastrar um usuário?"
        );

        await c.enviar(
            "E como editar esse usuário?"
        );

        assert.deepEqual(
            historicos,
            [0, 1]
        );

        assert.equal(
            c.getEstado().historico.length,
            2
        );

        assert.equal(
            c.eventos.at(-1)?.origem,
            "ia_gerada"
        );
    }
);

test(
    "modo pergunta: cliente confirma e cria ticket",
    async () => {
        const c = cenario({
            nome: "mock",
            gerar: async () => ({
                encontrou: false,
                texto: ""
            })
        });

        await c.entrarNoModo();

        await c.enviar(
            "Preciso de uma informação fora do manual"
        );

        assert.equal(
            (await c.fila.listarFila()).length,
            0
        );

        await c.enviar("sim");

        const tickets = await c.fila.listarFila();

        assert.equal(tickets.length, 1);

        assert.match(
            c.canal.enviadas.at(-1)!.texto,
            /Protocolo:/
        );

        assert.equal(
            c.getEstado().transferenciaPendente,
            null
        );
    }
);

test(
    "modo pergunta: cliente recusa e nao cria ticket",
    async () => {
        const c = cenario({
            nome: "mock",
            gerar: async () => ({
                encontrou: false,
                texto: ""
            })
        });

        await c.entrarNoModo();

        await c.enviar(
            "Pergunta sem resposta no manual"
        );

        await c.enviar("não");

        assert.equal(
            (await c.fila.listarFila()).length,
            0
        );

        assert.equal(
            c.getEstado().transferenciaPendente,
            null
        );

        assert.match(
            c.canal.enviadas.at(-1)!.texto,
            /Vamos continuar por aqui/
        );
    }
);
