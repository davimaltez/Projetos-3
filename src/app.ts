import express from "express";

const PORTA_PADRAO = 3000;

const paginaInicial = `<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chatbot WXN</title>
</head>
<body style="margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#0f172a; color:#f8fafc; font-family:system-ui, -apple-system, sans-serif;">
  <main style="text-align:center;">
    <h1 style="font-size:2.5rem; margin:0 0 0.5rem;">Hello World</h1>
    <p style="color:#94a3b8; margin:0;">Chatbot WXN &middot; Grupo 11 </p>
  </main>
</body>
</html>`;

const app = express();
const porta = Number(process.env.PORT ?? PORTA_PADRAO);

app.get("/", (_req, res) => {
  res.type("html").send(paginaInicial);
});

app.get("/estou-vivo", (_req, res) => {
  res.type("text/plain").send("estou vivo");
});

app.listen(porta, () => {
  console.log(`Servidor rodando em http://localhost:${porta}`);
});