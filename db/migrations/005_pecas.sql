-- ============================================================================
-- 005_pecas.sql  —  SOMENTE ESTRUTURA ADITIVA E CATÁLOGO FIXO (sem ALTER/DROP)
-- Cria as tabelas do módulo PEÇAS (Peças Global + Travas e Cordões):
--   1) pecas_catalogo: catálogo fixo com 32 tipos de peças em 2 categorias
--   2) pecas_preferencias_usuario: controle individual de alertas por gerente
--   3) pecas_tabelas_globais: tabelas globais de peças (máx. 40 linhas)
--   4) pecas_lancamentos: lançamentos vinculados às tabelas globais de peças
--   5) pecas_travas_tabelas: tabelas de Travas e Cordões (máx. 40 linhas)
--   6) pecas_travas_lancamentos: lançamentos de Travas e Cordões
-- Seguro para repetir: tudo usa IF NOT EXISTS e INSERT OR IGNORE.
-- Compatível com SQLite / Turso (libSQL). Aplicado também por api/migrate.js.
-- ============================================================================

CREATE TABLE IF NOT EXISTS pecas_catalogo (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria  TEXT NOT NULL CHECK (categoria IN ('Mangueiras e válvulas', 'Peças pequenas')),
  nome       TEXT NOT NULL UNIQUE,
  ordem      INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS pecas_preferencias_usuario (
  usuario_id       INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  recebe_alertas   INTEGER NOT NULL DEFAULT 0 CHECK (recebe_alertas IN (0, 1)),
  ultimo_visto_em  TEXT,
  atualizado_em    TEXT
);

CREATE TABLE IF NOT EXISTS pecas_tabelas_globais (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  nome             TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 100),
  status           TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'fechada')),
  criado_por       INTEGER REFERENCES usuarios(id),
  criado_em        TEXT NOT NULL,
  data_criacao     TEXT NOT NULL,
  horario_criacao  TEXT NOT NULL,
  fechada_em       TEXT,
  atualizado_em    TEXT
);

CREATE TABLE IF NOT EXISTS pecas_lancamentos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tabela_id       INTEGER NOT NULL REFERENCES pecas_tabelas_globais(id) ON DELETE CASCADE,
  ordem           INTEGER NOT NULL CHECK (ordem BETWEEN 1 AND 40),
  catalogo_id     INTEGER NOT NULL REFERENCES pecas_catalogo(id),
  peca_nome       TEXT NOT NULL,
  sequencia       INTEGER NOT NULL CHECK (sequencia BETWEEN 1 AND 99),
  os              TEXT NOT NULL CHECK (length(os) BETWEEN 1 AND 12),
  numero_peca     TEXT NOT NULL CHECK (length(trim(numero_peca)) BETWEEN 1 AND 40),
  operador_id     INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em       TEXT NOT NULL,
  data_envio      TEXT NOT NULL,
  horario_envio   TEXT NOT NULL,
  situacao        TEXT NOT NULL DEFAULT 'nao_listado' CHECK (situacao IN ('nao_listado', 'em_analise', 'conferido')),
  motivo_analise  TEXT,
  baixa           INTEGER NOT NULL DEFAULT 0 CHECK (baixa IN (0, 1)),
  baixa_em        TEXT,
  baixa_por       INTEGER REFERENCES usuarios(id),
  UNIQUE (tabela_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_pecas_lanc_tabela
  ON pecas_lancamentos(tabela_id, ordem);

CREATE INDEX IF NOT EXISTS idx_pecas_lanc_op
  ON pecas_lancamentos(operador_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_pecas_lanc_criado
  ON pecas_lancamentos(criado_em DESC);

CREATE TABLE IF NOT EXISTS pecas_travas_tabelas (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  nome             TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 100),
  status           TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'fechada')),
  criado_por       INTEGER REFERENCES usuarios(id),
  criado_em        TEXT NOT NULL,
  data_criacao     TEXT NOT NULL,
  horario_criacao  TEXT NOT NULL,
  fechada_em       TEXT,
  atualizado_em    TEXT
);

CREATE TABLE IF NOT EXISTS pecas_travas_lancamentos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tabela_id       INTEGER NOT NULL REFERENCES pecas_travas_tabelas(id) ON DELETE CASCADE,
  ordem           INTEGER NOT NULL CHECK (ordem BETWEEN 1 AND 40),
  os              TEXT NOT NULL CHECK (length(os) BETWEEN 1 AND 12),
  qtd_travas      INTEGER NOT NULL CHECK (qtd_travas BETWEEN 0 AND 999),
  qtd_cordoes     INTEGER NOT NULL CHECK (qtd_cordoes BETWEEN 0 AND 999),
  operador_id     INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em       TEXT NOT NULL,
  data_envio      TEXT NOT NULL,
  horario_envio   TEXT NOT NULL,
  situacao        TEXT NOT NULL DEFAULT 'nao_listado' CHECK (situacao IN ('nao_listado', 'em_analise', 'conferido')),
  motivo_analise  TEXT,
  baixa           INTEGER NOT NULL DEFAULT 0 CHECK (baixa IN (0, 1)),
  baixa_em        TEXT,
  baixa_por       INTEGER REFERENCES usuarios(id),
  CHECK (qtd_travas + qtd_cordoes >= 1),
  UNIQUE (tabela_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_pecas_travas_lanc_tabela
  ON pecas_travas_lancamentos(tabela_id, ordem);

CREATE INDEX IF NOT EXISTS idx_pecas_travas_lanc_op
  ON pecas_travas_lancamentos(operador_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_pecas_travas_lanc_criado
  ON pecas_travas_lancamentos(criado_em DESC);

-- Carga inicial idempotente do catálogo fixo de peças (7 + 25 = 32 itens)
INSERT OR IGNORE INTO pecas_catalogo(categoria, nome, ordem) VALUES
  ('Mangueiras e válvulas', 'Mangueira de CO2', 1),
  ('Mangueiras e válvulas', 'Mangueira de AP10', 2),
  ('Mangueiras e válvulas', 'Mangueira de PQS ABC 04 KG', 3),
  ('Mangueiras e válvulas', 'Mangueira de PQS BC 4, 6 e 8 KG', 4),
  ('Mangueiras e válvulas', 'Mangueira de PQS ABC 12, 06 e 08 KG', 5),
  ('Mangueiras e válvulas', 'Válvula CO2', 6),
  ('Mangueiras e válvulas', 'Válvula geral de AP10 e PQS', 7),
  ('Peças pequenas', 'Tampa de borracha', 8),
  ('Peças pequenas', 'Pino de AP10', 9),
  ('Peças pequenas', 'Anel do pino de PQS 4', 10),
  ('Peças pequenas', 'O''Hing de pino', 11),
  ('Peças pequenas', 'O''Hing grande', 12),
  ('Peças pequenas', 'Anel de miolo de válvula', 13),
  ('Peças pequenas', 'Bucha PO4, PO6, PO8, PO12 e AP10 — pequena', 14),
  ('Peças pequenas', 'Bucha PO4, PO6, PO8, PO12 e AP10 — grande', 15),
  ('Peças pequenas', 'Pêra PO4, PO6, PO8 e PO12', 16),
  ('Peças pequenas', 'Pêra AP10', 17),
  ('Peças pequenas', 'Anel do miolo da válvula Yanes', 18),
  ('Peças pequenas', 'O''Hing PO1 e PO2', 19),
  ('Peças pequenas', 'Mola de válvula PQS e AP', 20),
  ('Peças pequenas', 'Anel pó 04', 21),
  ('Peças pequenas', 'O''Hing PO4, PO6, PO8, PO12 e AP10', 22),
  ('Peças pequenas', 'Parafusos e porcas diversos', 23),
  ('Peças pequenas', 'Arruelas diversas', 24),
  ('Peças pequenas', 'Arruela de 2 mm para ampola', 25),
  ('Peças pequenas', 'Bico de mangueira', 26),
  ('Peças pequenas', 'Carreta e lance PO1', 27),
  ('Peças pequenas', 'Vedantes e O''Hings diversos', 28),
  ('Peças pequenas', 'Arruela inox M30 P4', 29),
  ('Peças pequenas', 'Niplel', 30),
  ('Peças pequenas', 'Mola do Gatinho', 31),
  ('Peças pequenas', 'Bucha redunão', 32);
