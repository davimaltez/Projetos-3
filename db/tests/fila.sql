-- Somente em banco de testes isolado. Nunca executar no banco principal.
-- psql -X -v ON_ERROR_STOP=1 -f db/tests/fila.sql
BEGIN;
SET LOCAL search_path = public, pg_catalog;

CREATE FUNCTION pg_temp.esperar_erro(comando TEXT, estado TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE comando;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = ANY (string_to_array(estado, ',')) THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Esperava SQLSTATE %, mas o comando teve sucesso: %', estado, comando;
END;
$$;

DO $$
DECLARE
  cliente INTEGER;
  conversa INTEGER;
  outra_conversa INTEGER;
  estado TEXT;
  prioridade TEXT;
  coluna TEXT;
  responsavel INTEGER;
  fechamento TIMESTAMPTZ;
  tem_atendente BOOLEAN;
  tem_fechamento BOOLEAN;
  valido BOOLEAN;
  comando TEXT;
BEGIN
  INSERT INTO clientes (telefone) VALUES ('teste-fila-sql') RETURNING id INTO cliente;
  INSERT INTO conversas (cliente_id) VALUES (cliente) RETURNING id INTO conversa;
  INSERT INTO conversas (cliente_id) VALUES (cliente) RETURNING id INTO outra_conversa;
  IF (SELECT criado_em FROM conversas WHERE id = conversa) IS NULL THEN
    RAISE EXCEPTION 'conversas.criado_em sem default';
  END IF;
  PERFORM pg_temp.esperar_erro(
    format('UPDATE conversas SET criado_em = NULL WHERE id = %s', conversa), '23502');

  -- E-mail repetido é permitido; default OFFLINE e especialidade opcional.
  INSERT INTO atendentes (id, nome, email) VALUES
    (-9001, 'Ana', 'fila@example.test'), (-9002, 'Bruno', 'fila@example.test');
  IF (SELECT status FROM atendentes WHERE id = -9001) <> 'OFFLINE' THEN
    RAISE EXCEPTION 'Default do atendente incorreto';
  END IF;
  FOREACH estado IN ARRAY ARRAY['DISPONIVEL', 'OCUPADO', 'OFFLINE'] LOOP
    UPDATE atendentes SET status = estado WHERE id = -9001;
  END LOOP;
  UPDATE atendentes SET especialidade = 'Suporte' WHERE id = -9001;
  PERFORM pg_temp.esperar_erro(
    'UPDATE atendentes SET status = ''INVALIDO'' WHERE id = -9001', '23514');
  FOREACH coluna IN ARRAY ARRAY['id', 'nome', 'email', 'status'] LOOP
    PERFORM pg_temp.esperar_erro(
      format('UPDATE atendentes SET %I = NULL WHERE id = -9001', coluna), '23502');
  END LOOP;
  PERFORM pg_temp.esperar_erro(
    'INSERT INTO atendentes (id, nome, email) VALUES (-9001, ''Outro'', ''outro@example.test'')',
    '23505');

  -- Todas as 12 combinações de estado/responsável/fechamento: apenas 3 válidas.
  FOREACH estado IN ARRAY ARRAY['AGUARDANDO', 'EM_ATENDIMENTO', 'ENCERRADO'] LOOP
    FOREACH tem_atendente IN ARRAY ARRAY[false, true] LOOP
      FOREACH tem_fechamento IN ARRAY ARRAY[false, true] LOOP
        responsavel := CASE WHEN tem_atendente THEN -9001 ELSE NULL END;
        fechamento := CASE WHEN tem_fechamento
          THEN '2026-01-01 11:00:00+00'::timestamptz ELSE NULL END;
        valido := (estado = 'AGUARDANDO' AND NOT tem_atendente AND NOT tem_fechamento)
          OR (estado = 'EM_ATENDIMENTO' AND tem_atendente AND NOT tem_fechamento)
          OR (estado = 'ENCERRADO' AND tem_atendente AND tem_fechamento);
        comando := format(
          'INSERT INTO tickets (id, conversa_id, atendente_id, assunto, prioridade,
            status, data_abertura, data_fechamento, resumo_bot)
           VALUES (''nao-uuid'', %s, %L, ''Suporte'', ''MEDIA'', %L,
            ''2026-01-01 10:00:00+00'', %L, '''')',
          conversa, responsavel, estado, fechamento);
        IF valido THEN
          EXECUTE comando;
          DELETE FROM tickets WHERE id = 'nao-uuid';
        ELSE
          PERFORM pg_temp.esperar_erro(comando, '23514');
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- Dados válidos para testar UPDATEs, PK, UNIQUE e FKs.
  INSERT INTO tickets (id, conversa_id, assunto, prioridade, data_abertura, resumo_bot)
    VALUES ('pendente', conversa, 'Suporte', 'MEDIA', '2026-01-01 10:00:00+00', '');
  IF (SELECT status FROM tickets WHERE id = 'pendente') <> 'AGUARDANDO' THEN
    RAISE EXCEPTION 'Default do ticket incorreto';
  END IF;
  FOREACH prioridade IN ARRAY ARRAY['URGENTE', 'ALTA', 'MEDIA', 'BAIXA'] LOOP
    EXECUTE 'UPDATE tickets SET prioridade = $1 WHERE id = ''pendente''' USING prioridade;
  END LOOP;
  PERFORM pg_temp.esperar_erro(
    'UPDATE tickets SET prioridade = ''CRITICA'' WHERE id = ''pendente''', '23514');
  PERFORM pg_temp.esperar_erro(
    'UPDATE tickets SET status = ''INVALIDO'' WHERE id = ''pendente''', '23514');
  FOREACH coluna IN ARRAY ARRAY[
    'id', 'conversa_id', 'assunto', 'prioridade', 'status', 'data_abertura', 'resumo_bot'
  ] LOOP
    PERFORM pg_temp.esperar_erro(
      format('UPDATE tickets SET %I = NULL WHERE id = ''pendente''', coluna), '23502');
  END LOOP;
  PERFORM pg_temp.esperar_erro(
    format('INSERT INTO tickets (id, conversa_id, assunto, prioridade, data_abertura, resumo_bot)
      VALUES (''pendente'', %s, ''Suporte'', ''ALTA'', now(), '''')', outra_conversa), '23505');
  PERFORM pg_temp.esperar_erro(
    format('INSERT INTO tickets (id, conversa_id, assunto, prioridade, data_abertura, resumo_bot)
      VALUES (''duplicado'', %s, ''Suporte'', ''ALTA'', now(), '''')', conversa), '23505');
  PERFORM pg_temp.esperar_erro(
    'UPDATE tickets SET conversa_id = 2147483647 WHERE id = ''pendente''', '23503');
  PERFORM pg_temp.esperar_erro(
    'UPDATE tickets SET status = ''EM_ATENDIMENTO'', atendente_id = 2147483647
     WHERE id = ''pendente''', '23503');
  UPDATE tickets SET status = 'EM_ATENDIMENTO', atendente_id = -9001 WHERE id = 'pendente';
  -- RESTRICT pode emitir foreign_key_violation ou restrict_violation conforme a versão.
  PERFORM pg_temp.esperar_erro('DELETE FROM atendentes WHERE id = -9001', '23503,23001');
  PERFORM pg_temp.esperar_erro(format('DELETE FROM conversas WHERE id = %s', conversa), '23503,23001');
  UPDATE tickets SET status = 'ENCERRADO', data_fechamento = '2026-01-01 11:00:00+00'
    WHERE id = 'pendente';
  -- Mesmo encerrada, a conversa não pode gerar outro ticket.
  PERFORM pg_temp.esperar_erro(
    format('INSERT INTO tickets (id, conversa_id, assunto, prioridade, data_abertura, resumo_bot)
      VALUES (''novo'', %s, ''Suporte'', ''BAIXA'', now(), '''')', conversa), '23505');

  -- Caminho de escrita legado continua válido.
  INSERT INTO mensagens (conversa_id, wamid, direcao, texto)
    VALUES (conversa, 'teste-fila-entrada', 'entrada', 'Olá');
  INSERT INTO mensagens (conversa_id, wamid, direcao, texto, processado)
    VALUES (conversa, 'teste-fila-saida', 'saida', 'Resposta', true);
  INSERT INTO eventos (conversa_id, tipo, dados) VALUES (conversa, 'resposta', '{}');
  INSERT INTO conhecimento (pergunta, resposta) VALUES ('Pergunta', 'Resposta');
  INSERT INTO administradores (telefone) VALUES ('teste-fila-admin');
  UPDATE conversas SET contexto = jsonb_set(contexto, '{menu}', '{"caminho":["1"]}'::jsonb)
    WHERE id = conversa;
  RAISE NOTICE 'Validação da fila concluída: estados, enums, nulabilidade, PKs, UNIQUE, FKs e inserts legados.';
END;
$$;

ROLLBACK;
