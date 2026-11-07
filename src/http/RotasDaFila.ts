import { Router, type ErrorRequestHandler } from "express";
import { ServicoDeFila, TicketIndisponivelError, TicketNaoEncontradoError } from "../nucleo/ServicoDeFila.js";
import type { Atendente } from "../nucleo/entidades/Atendente.js";
import type { AutenticadorDeOperador } from "./AutenticadorDeOperador.js";
import { AtendenteNaoCadastradoError } from "../nucleo/ErrosDaFila.js";

export function rotasDaFila(fila: ServicoDeFila, autenticador: AutenticadorDeOperador): Router {
  const router = Router();
  router.use(["/fila", "/tickets"], (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!autenticador.configurado) {
      res.status(503).json({ erro: "Acesso de operadores não configurado." });
      return;
    }
    const atendente = autenticador.autenticar(req.headers.authorization);
    if (!atendente) {
      res.set("WWW-Authenticate", "Bearer").status(401).json({ erro: "Operador não autenticado." });
      return;
    }
    res.locals.atendente = atendente;
    next();
  });

  router.get("/fila", (_req, res, next) => {
    void fila.listarFila().then((tickets) => res.json(tickets.map((ticket) => ({
      protocolo: ticket.getProtocolo(), assunto: ticket.getAssunto(), prioridade: ticket.getPrioridade(),
      status: ticket.getStatus(), abertoEm: ticket.getDataAbertura(), conversaId: ticket.getConversa().getId(),
      resumoBot: ticket.getResumoBot(),
      motivo: ticket.getMotivo(), dados: ticket.getDados(),
    })))).catch(next);
  });

  router.post("/tickets/:protocolo/assumir", (req, res, next) => {
    const atendente = res.locals.atendente as Atendente;
    void fila.assumirTicket(req.params.protocolo, atendente).then(() => res.json({
      protocolo: req.params.protocolo, status: "EM_ATENDIMENTO", atendenteId: atendente.getId(),
    })).catch(next);
  });

  router.get("/tickets/:protocolo/historico", (req, res, next) => {
    void fila.obterHistoricoDoTicket(req.params.protocolo).then((mensagens) => res.json(mensagens.map((m) => ({
      conteudo: m.getTexto(), dataHora: m.getDataEnvio(), remetente: m.getRemetente().getIdentificacao(),
      intencaoDetectada: m.getIntencaoDetectada(),
    })))).catch(next);
  });

  const tratarErro: ErrorRequestHandler = (erro: unknown, _req, res, _next) => {
    if (erro instanceof TicketNaoEncontradoError) res.status(404).json({ erro: erro.message });
    else if (erro instanceof TicketIndisponivelError) res.status(409).json({ erro: erro.message });
    else if (erro instanceof AtendenteNaoCadastradoError) res.status(403).json({ erro: "Operador sem cadastro para assumir tickets." });
    else {
      console.error("[http] falha na operação de fila");
      res.status(500).json({ erro: "Não foi possível concluir a operação da fila." });
    }
  };
  router.use(tratarErro);
  return router;
}
