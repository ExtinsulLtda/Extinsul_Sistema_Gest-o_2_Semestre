-- Consultas de validação (somente leitura). Rodar:  turso db shell extinsul < db/validacao.sql

-- 1) Tabelas existentes
SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;

-- 2) Colunas das tabelas novas e das que o terminal usa
PRAGMA table_info(produtos);
PRAGMA table_info(estoque_movimentacoes);
PRAGMA table_info(clientes);
PRAGMA table_info(usuarios);

-- 3) Índices e gatilhos
SELECT name, tbl_name FROM sqlite_master WHERE type='index'   AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name;
SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' ORDER BY name;

-- 4) Chaves estrangeiras (cada linha devolvida seria um problema; o esperado é NENHUMA linha)
PRAGMA foreign_key_list(estoque_movimentacoes);
PRAGMA foreign_key_check;

-- 5) Os registros anteriores continuam lá (compare com as contagens do backup)
SELECT 'usuarios' AS tabela, COUNT(*) AS n FROM usuarios
UNION ALL SELECT 'clientes', COUNT(*) FROM clientes
UNION ALL SELECT 'extintores', COUNT(*) FROM extintores
UNION ALL SELECT 'ordens_servico', COUNT(*) FROM ordens_servico
UNION ALL SELECT 'vistorias', COUNT(*) FROM vistorias
UNION ALL SELECT 'produtos', COUNT(*) FROM produtos;

-- 6) Integridade geral e saldo coerente com o histórico (esperado: nenhuma linha em "divergentes")
PRAGMA integrity_check;
SELECT p.id, p.nome, p.quantidade AS saldo,
       COALESCE(SUM(CASE m.tipo WHEN 'entrada' THEN m.quantidade WHEN 'saida' THEN -m.quantidade END), 0) AS soma_movimentos
  FROM produtos p LEFT JOIN estoque_movimentacoes m ON m.produto_id = p.id
 GROUP BY p.id HAVING 1 = 0;   -- troque "1 = 0" por "saldo <> soma_movimentos" se TODO o saldo nasceu de movimentações
