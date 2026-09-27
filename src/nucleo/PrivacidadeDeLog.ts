/**
 * O que pode ir para o log sem expor o cliente. Telefone inteiro e texto de mensagem são
 * dados pessoais (LGPD), e um texto enorme ou com quebras de linha poderia inundar o log
 * ou forjar linhas falsas nele.
 */

const TRECHO_MAXIMO = 40;

/** "5581999999999" vira "5581***99"; "123456789@lid" vira "1234***89@lid". */
export function mascararRemetente(remetente: string): string {
  const [usuario, ...resto] = remetente.split("@");
  const sufixo = resto.length > 0 ? `@${resto.join("@")}` : "";
  if (usuario.length <= 6) return `***${sufixo}`;
  return `${usuario.slice(0, 4)}***${usuario.slice(-2)}${sufixo}`;
}

/**
 * Só o começo do texto, entre aspas e com quebras de linha escapadas (JSON.stringify),
 * mais o tamanho total: "\"oi, tudo bem?\" (13 caracteres)".
 */
export function resumirTextoParaLog(texto: string): string {
  const caracteres = Array.from(texto); // conta emoji como 1, não corta no meio dele
  const trecho = JSON.stringify(caracteres.slice(0, TRECHO_MAXIMO).join(""));
  return `${trecho}${caracteres.length > TRECHO_MAXIMO ? "…" : ""} (${caracteres.length} caracteres)`;
}
