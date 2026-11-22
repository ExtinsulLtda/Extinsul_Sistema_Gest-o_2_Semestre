-- ============================================================================
-- 003_login_seguranca.sql  —  SOMENTE ESTRUTURA ADITIVA (sem DROP/DELETE)
-- Cria e indexa as tabelas auxiliares de segurança da Etapa 1 do login:
--   1) auth_tentativas: controle persistente de falhas e bloqueio progressivo (2 min / 5 min)
--   2) auth_logs: auditoria de tentativas de autenticação (sem armazenar PIN/senha)
-- Seguro para repetir: tudo usa IF NOT EXISTS. Preserva integralmente usuarios e dados existentes.
-- Compatível com SQLite / Turso (libSQL). Aplicado também por api/migrate.js.
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth_tentativas (
  chave_escopo        TEXT PRIMARY KEY,
  tipo_escopo         TEXT NOT NULL CHECK (tipo_escopo IN ('ip', 'user')),
  usuario_id          INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  falhas_consecutivas INTEGER NOT NULL DEFAULT 0 CHECK (falhas_consecutivas >= 0),
  nivel_bloqueio      INTEGER NOT NULL DEFAULT 0 CHECK (nivel_bloqueio IN (0, 1, 2)),
  bloqueado_em        INTEGER,
  bloqueado_ate       INTEGER,
  ultima_tentativa_em INTEGER NOT NULL,
  atualizado_em       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_tentativas_usuario
  ON auth_tentativas(usuario_id);

CREATE INDEX IF NOT EXISTS idx_auth_tentativas_bloq
  ON auth_tentativas(bloqueado_ate);

CREATE TABLE IF NOT EXISTS auth_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  etapa          TEXT NOT NULL CHECK (etapa IN ('pin', 'nome')),
  resultado      TEXT NOT NULL CHECK (resultado IN ('sucesso', 'falha', 'bloqueado')),
  motivo_tecnico TEXT NOT NULL,
  origem         TEXT,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_logs_usuario
  ON auth_logs(usuario_id, criado_em);

CREATE INDEX IF NOT EXISTS idx_auth_logs_criado
  ON auth_logs(criado_em);
