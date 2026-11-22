-- ============================================================================
-- 004_reservas.sql  —  SOMENTE ESTRUTURA ADITIVA (sem DROP/DELETE)
-- Cria as tabelas do módulo de Reservas (gerente) e Empréstimos (motorista):
--   1) reservas_tabelas: tabelas de controle de extintores reserva
--   2) reservas_linhas: até 100 linhas por tabela, com cliente opcional
--   3) reservas_emprestimos: empréstimos de reservas registrados pelo motorista
-- Seguro para repetir: tudo usa IF NOT EXISTS. Não altera tabelas existentes.
-- Compatível com SQLite / Turso (libSQL). Aplicado também por api/migrate.js.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reservas_tabelas (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  nome             TEXT NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 100),
  criado_em        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  data_criacao     TEXT NOT NULL,
  horario_criacao  TEXT NOT NULL,
  atualizado_em    TEXT,
  criado_por       INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS reservas_linhas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tabela_id     INTEGER NOT NULL REFERENCES reservas_tabelas(id) ON DELETE CASCADE,
  ordem         INTEGER NOT NULL CHECK (ordem BETWEEN 1 AND 100),
  numero        INTEGER NOT NULL CHECK (numero BETWEEN 0 AND 999999999),
  motivo        TEXT CHECK (motivo IN ('E', 'V')),
  movimentacao  TEXT CHECK (movimentacao IN ('Vai', 'Retornou')),
  cliente_id    INTEGER REFERENCES clientes(id),
  UNIQUE (tabela_id, numero),
  UNIQUE (tabela_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_reservas_linhas_tabela
  ON reservas_linhas(tabela_id, ordem);

CREATE INDEX IF NOT EXISTS idx_reservas_linhas_cliente
  ON reservas_linhas(cliente_id);

CREATE TABLE IF NOT EXISTS reservas_emprestimos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_reserva  INTEGER NOT NULL CHECK (numero_reserva BETWEEN 0 AND 999999999),
  cliente_id      INTEGER NOT NULL REFERENCES clientes(id),
  motorista_id    INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  devolvido_em    TEXT
);

-- Garante no próprio banco que o mesmo número não fique emprestado duas vezes em aberto
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservas_emp_aberto
  ON reservas_emprestimos(numero_reserva)
  WHERE devolvido_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_reservas_emp_motorista
  ON reservas_emprestimos(motorista_id, criado_em);

CREATE INDEX IF NOT EXISTS idx_reservas_emp_cliente
  ON reservas_emprestimos(cliente_id);
