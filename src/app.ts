import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORTA_PADRAO = 3000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pastaInterface = path.join(__dirname, "..", "interface");

const app = express();
const porta = Number(process.env.PORT ?? PORTA_PADRAO);

app.use(express.static(path.join(__dirname, "..", "interface")));

app.get("/estou-vivo", (_req, res) => {
  res.sendFile(path.join(pastaInterface, "status.html"));
});

app.listen(porta, () => {
  console.log(`Servidor rodando em http://localhost:${porta}`);
});