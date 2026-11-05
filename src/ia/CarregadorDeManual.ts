import { readFileSync } from "node:fs";

/** O manual inteiro vai em toda pergunta. Passou disso, é hora de mandar só o trecho do assunto. */
const TAMANHO_MAXIMO = 60_000; // caracteres

/** Lê o manual de um arquivo de texto. Lança erro com mensagem clara; o app.ts desliga o gerador. */
export function carregarManual(caminho: string): string {
  let texto: string;
  try {
    texto = readFileSync(caminho, "utf8");
  } catch {
    throw new Error(`não consegui ler o manual em "${caminho}".`);
  }
  texto = texto.trim();
  if (texto.length === 0) throw new Error(`o manual em "${caminho}" está vazio.`);
  if (texto.length > TAMANHO_MAXIMO) {
    throw new Error(`o manual tem ${texto.length} caracteres e o limite do MVP é ${TAMANHO_MAXIMO}.`);
  }
  return texto;
}