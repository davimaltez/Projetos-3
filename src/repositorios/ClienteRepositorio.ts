import type pg from "pg";
import type { DadosDoCliente, RepositorioDeClientes } from "../nucleo/Repositorios.js";

/** Limites de tamanho: texto vindo do usuário não deve inflar o cadastro nem o cartão do operador. */
const TAMANHO_MAXIMO_NOME = 80;
const TAMANHO_MAXIMO_EMPRESA = 120;

function limpar(texto: string | undefined, maximo: number): string | null {
  const limpo = texto?.replace(/\s+/g, " ").trim().slice(0, maximo) ?? "";
  return limpo === "" ? null : limpo;
}

export class ClienteRepositorio implements RepositorioDeClientes {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Um único comando atômico. O par SELECT + INSERT separados quebra quando
   * a mesma pessoa manda duas mensagens seguidas: as duas veem "não existe",
   * as duas tentam inserir, e a segunda estoura a UNIQUE de telefone.
   * O nome de perfil só preenche um nome vazio: não sobrescreve um nome já cadastrado.
   */
  async obterOuCriar(telefone: string, origem: string, enderecoResposta?: string, nome?: string): Promise<number> {
    const { rows } = await this.pool.query<{ id: number }>(
        `INSERT INTO clientes (telefone, origem, endereco_resposta, nome) VALUES ($1, $2, $3, $4)
          ON CONFLICT (telefone) DO UPDATE SET endereco_resposta = EXCLUDED.endereco_resposta,
                                               nome = COALESCE(clientes.nome, EXCLUDED.nome)
                                      RETURNING id`,
        [telefone, origem, enderecoResposta ?? null, limpar(nome, TAMANHO_MAXIMO_NOME)]
    );
    return rows[0].id;
  }

  async obterPorId(id: number): Promise<DadosDoCliente | null> {
    const { rows } = await this.pool.query<{ nome: string | null; empresa: string | null; telefone: string }>(
      "SELECT nome, empresa, telefone FROM clientes WHERE id = $1",
      [id]
    );
    if (!rows[0]) return null;
    return { nome: rows[0].nome, empresa: rows[0].empresa, telefone: rows[0].telefone };
  }

  async salvarEmpresa(id: number, empresa: string): Promise<void> {
    const valor = limpar(empresa, TAMANHO_MAXIMO_EMPRESA);
    if (valor === null) return;
    await this.pool.query("UPDATE clientes SET empresa = $2 WHERE id = $1", [id, valor]);
  }
}
