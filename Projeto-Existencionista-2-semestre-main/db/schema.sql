-- Extinsul - esquema do banco (SQLite / Turso libSQL)
-- Todas as instruções são idempotentes (IF NOT EXISTS). Colunas novas de bancos
-- antigos são adicionadas por lib/db.js (migrar).

CREATE TABLE IF NOT EXISTS usuarios (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT NOT NULL,
  perfil    TEXT NOT NULL CHECK (perfil IN ('gerente','operador','motorista')),
  pin_hash  TEXT NOT NULL,              -- formato salt:hash (scrypt, hex)
  ativo     INTEGER NOT NULL DEFAULT 1,
  telefone  TEXT
);

CREATE TABLE IF NOT EXISTS clientes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT NOT NULL UNIQUE,
  telefone  TEXT,
  email     TEXT,
  endereco  TEXT,
  cidade    TEXT
);

CREATE TABLE IF NOT EXISTS veiculos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  placa         TEXT NOT NULL UNIQUE,
  modelo        TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'Utilitário',
  ano           INTEGER,
  km            INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel','em_rota','manutencao')),
  motorista_id  INTEGER REFERENCES usuarios(id),
  observacao    TEXT
);

CREATE TABLE IF NOT EXISTS extintores (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo            TEXT NOT NULL UNIQUE,
  cliente_id        INTEGER NOT NULL REFERENCES clientes(id),
  tipo              TEXT NOT NULL CHECK (tipo IN ('PQS','CO2','Água')),
  status            TEXT NOT NULL DEFAULT 'em_dia' CHECK (status IN ('em_dia','em_atraso','inativo')),
  proxima_vistoria  TEXT,               -- data ISO (AAAA-MM-DD)
  localizacao       TEXT,
  capacidade        TEXT,
  observacao        TEXT
);

CREATE TABLE IF NOT EXISTS ordens_servico (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  numero         TEXT NOT NULL UNIQUE,
  cliente_id     INTEGER NOT NULL REFERENCES clientes(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('Recarga','Manutenção','Vistoria')),
  status         TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluida')),
  data           TEXT NOT NULL,         -- data ISO
  hora_inicio    TEXT,
  hora_fim       TEXT,
  motorista_id   INTEGER REFERENCES usuarios(id),
  ordem_rota     INTEGER,
  veiculo_id     INTEGER REFERENCES veiculos(id),
  descricao      TEXT,
  entregue_em    TEXT
);

CREATE TABLE IF NOT EXISTS vistorias (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  data         TEXT NOT NULL,
  extintor_id  INTEGER NOT NULL REFERENCES extintores(id),
  operador_id  INTEGER REFERENCES usuarios(id),
  resultado    TEXT NOT NULL CHECK (resultado IN ('conforme','nao_conforme')),
  observacao   TEXT
);

CREATE TABLE IF NOT EXISTS manutencoes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  data         TEXT NOT NULL,
  extintor_id  INTEGER NOT NULL REFERENCES extintores(id),
  operador_id  INTEGER REFERENCES usuarios(id),
  tipo         TEXT NOT NULL,           -- Recarga, Manutenção, Teste hidrostático, Troca de peça
  descricao    TEXT,
  custo        REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fotos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  data         TEXT NOT NULL,
  descricao    TEXT,
  extintor_id  INTEGER REFERENCES extintores(id),
  os_id        INTEGER REFERENCES ordens_servico(id),
  operador_id  INTEGER REFERENCES usuarios(id),
  imagem       TEXT NOT NULL            -- data URL (JPEG reduzido no navegador)
);

CREATE TABLE IF NOT EXISTS comprovantes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  os_id         INTEGER NOT NULL UNIQUE REFERENCES ordens_servico(id),
  data_hora     TEXT NOT NULL,
  recebedor     TEXT NOT NULL,
  documento     TEXT,
  observacao    TEXT,
  motorista_id  INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave  TEXT PRIMARY KEY,
  valor  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ext_status ON extintores(status);
CREATE INDEX IF NOT EXISTS idx_ext_prox   ON extintores(proxima_vistoria);
CREATE INDEX IF NOT EXISTS idx_os_data    ON ordens_servico(data);
CREATE INDEX IF NOT EXISTS idx_vist_data  ON vistorias(data);

-- ---------------------------------------------------------------
-- Estruturas adicionadas na v2 (criadas automaticamente por api/migrate.js ao iniciar o servidor)
--   clientes: telefone, email, cep, endereco, numero, complemento, bairro, cidade, uf (endereço fixo)
--   extintores: capacidade, local, cep, endereco, numero, complemento, bairro, cidade, uf (endereço onde está; vazio = usa o do cliente)
--   ordens_servico: descricao, veiculo_id
--   tabelas: veiculos, manutencoes, fotos, comprovantes, configuracoes, os_extintores (extintores de cada OS)
-- ---------------------------------------------------------------
