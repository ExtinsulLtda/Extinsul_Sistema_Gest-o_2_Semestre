-- ============================================================================
-- 002_estoque.sql  —  SOMENTE ESTRUTURA (nenhum INSERT/UPDATE/DELETE de dados)
-- Cria o módulo de estoque usado pelo aplicativo de terminal (via API).
-- Seguro para repetir: tudo usa IF NOT EXISTS. Não altera nenhuma tabela existente.
-- Compatível com SQLite / Turso (libSQL). Aplicado também por api/migrate.js.
-- ============================================================================

-- Produtos / materiais em estoque.
-- NÃO é a tabela "extintores": aqui ficam mercadorias (pó químico, cargas, mangueiras, lacres...),
-- enquanto "extintores" são unidades identificadas por código e ligadas a clientes.
CREATE TABLE IF NOT EXISTS produtos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo          TEXT UNIQUE,                                   -- SKU opcional (NULL permitido, vários NULL são aceitos)
  nome            TEXT NOT NULL,
  descricao       TEXT,
  unidade         TEXT NOT NULL DEFAULT 'un',                    -- un, kg, L, m...
  quantidade      INTEGER NOT NULL DEFAULT 0 CHECK (quantidade >= 0),   -- impede estoque negativo
  valor_unitario  REAL    NOT NULL DEFAULT 0 CHECK (valor_unitario >= 0),
  ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Histórico de entradas e saídas. É a trilha de auditoria: quem mexeu, quanto e quando.
CREATE TABLE IF NOT EXISTS estoque_movimentacoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id  INTEGER NOT NULL REFERENCES produtos(id),
  tipo        TEXT    NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  quantidade  INTEGER NOT NULL CHECK (quantidade > 0),
  usuario_id  INTEGER REFERENCES usuarios(id),
  observacao  TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_estmov_produto ON estoque_movimentacoes(produto_id, criado_em);

-- Cada movimentação atualiza o saldo do produto na MESMA transação.
-- Se uma saída deixasse o saldo negativo, o CHECK de produtos.quantidade faz o INSERT inteiro falhar.
CREATE TRIGGER IF NOT EXISTS trg_estmov_aplica
AFTER INSERT ON estoque_movimentacoes
BEGIN
  UPDATE produtos
     SET quantidade    = quantidade + CASE NEW.tipo WHEN 'entrada' THEN NEW.quantidade ELSE -NEW.quantidade END,
         atualizado_em = datetime('now')
   WHERE id = NEW.produto_id;
END;

-- Mantém atualizado_em ao editar dados cadastrais (a coluna quantidade fica de fora de propósito).
CREATE TRIGGER IF NOT EXISTS trg_produtos_atualizado
AFTER UPDATE OF codigo, nome, descricao, unidade, valor_unitario, ativo ON produtos
BEGIN
  UPDATE produtos SET atualizado_em = datetime('now') WHERE id = NEW.id;
END;
