// Migração idempotente: atualiza o banco existente (inclusive no Turso) sem perder dados.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { hashPin, cifraPin } = require('./auth');
const { hojeISO, somaDias } = require('./util');

async function colunas(tabela) {
  const r = await db.execute(`PRAGMA table_info(${tabela})`);
  return r.rows.map((x) => x.name);
}
async function addCol(tabela, coluna, def) {
  if ((await colunas(tabela)).includes(coluna)) return false;
  await db.execute(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${def}`);
  return true;
}
const contagem = async (t) => Number((await db.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n);

async function migrar(opcoes = {}) {
  /* ----- tabelas base (caso o banco ainda esteja vazio) ----- */
  await db.batch([
    `CREATE TABLE IF NOT EXISTS usuarios (
       id       INTEGER PRIMARY KEY AUTOINCREMENT,
       nome     TEXT NOT NULL,
       perfil   TEXT NOT NULL CHECK (perfil IN ('gerente','operador','motorista')),
       pin_hash TEXT NOT NULL,
       ativo    INTEGER NOT NULL DEFAULT 1
     )`,
    `CREATE TABLE IF NOT EXISTS clientes (
       id   INTEGER PRIMARY KEY AUTOINCREMENT,
       nome TEXT NOT NULL UNIQUE
     )`,
    `CREATE TABLE IF NOT EXISTS extintores (
       id               INTEGER PRIMARY KEY AUTOINCREMENT,
       codigo           TEXT NOT NULL UNIQUE,
       cliente_id       INTEGER NOT NULL REFERENCES clientes(id),
       tipo             TEXT NOT NULL CHECK (tipo IN ('PQS','CO2','Água')),
       status           TEXT NOT NULL DEFAULT 'em_dia' CHECK (status IN ('em_dia','em_atraso','inativo')),
       proxima_vistoria TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS ordens_servico (
       id           INTEGER PRIMARY KEY AUTOINCREMENT,
       numero       TEXT NOT NULL UNIQUE,
       cliente_id   INTEGER NOT NULL REFERENCES clientes(id),
       tipo         TEXT NOT NULL CHECK (tipo IN ('Recarga','Manutenção','Vistoria')),
       status       TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluida')),
       data         TEXT NOT NULL,
       hora_inicio  TEXT,
       hora_fim     TEXT,
       motorista_id INTEGER REFERENCES usuarios(id),
       ordem_rota   INTEGER
     )`,
    `CREATE TABLE IF NOT EXISTS vistorias (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       data        TEXT NOT NULL,
       extintor_id INTEGER NOT NULL REFERENCES extintores(id),
       operador_id INTEGER REFERENCES usuarios(id),
       resultado   TEXT NOT NULL CHECK (resultado IN ('conforme','nao_conforme')),
       observacao  TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS vencimentos (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       cliente_id INTEGER NOT NULL REFERENCES clientes(id),
       tipo       TEXT NOT NULL,
       data       TEXT NOT NULL
     )`,
  ], 'write');

  /* ----- novas tabelas ----- */
  await db.batch([
    `CREATE TABLE IF NOT EXISTS veiculos (
       id           INTEGER PRIMARY KEY AUTOINCREMENT,
       placa        TEXT NOT NULL UNIQUE,
       modelo       TEXT NOT NULL,
       ano          INTEGER,
       km_atual     INTEGER NOT NULL DEFAULT 0,
       status       TEXT NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel','em_uso','manutencao')),
       motorista_id INTEGER REFERENCES usuarios(id)
     )`,
    `CREATE TABLE IF NOT EXISTS manutencoes (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       data        TEXT NOT NULL,
       extintor_id INTEGER NOT NULL REFERENCES extintores(id),
       operador_id INTEGER REFERENCES usuarios(id),
       tipo        TEXT NOT NULL,
       descricao   TEXT,
       custo       REAL
     )`,
    `CREATE TABLE IF NOT EXISTS fotos (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       data        TEXT NOT NULL,
       extintor_id INTEGER REFERENCES extintores(id),
       os_id       INTEGER REFERENCES ordens_servico(id),
       operador_id INTEGER REFERENCES usuarios(id),
       descricao   TEXT,
       imagem      TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS comprovantes (
       id           INTEGER PRIMARY KEY AUTOINCREMENT,
       os_id        INTEGER NOT NULL UNIQUE REFERENCES ordens_servico(id),
       motorista_id INTEGER REFERENCES usuarios(id),
       data         TEXT NOT NULL,
       hora         TEXT,
       recebedor    TEXT NOT NULL,
       documento    TEXT,
       observacao   TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS configuracoes (
       chave TEXT PRIMARY KEY,
       valor TEXT NOT NULL
     )`,
  ], 'write');

  /* ----- novas colunas ----- */
  await db.execute(`CREATE TABLE IF NOT EXISTS os_extintores (
       os_id       INTEGER NOT NULL REFERENCES ordens_servico(id),
       extintor_id INTEGER NOT NULL REFERENCES extintores(id),
       PRIMARY KEY (os_id, extintor_id)
     )`);
  await addCol('usuarios', 'pin_cifrado', 'TEXT');   // cópia cifrada do PIN (só o gerente consegue ver)
  const novoTel = await addCol('clientes', 'telefone', 'TEXT');
  await addCol('clientes', 'email', 'TEXT');
  await addCol('clientes', 'endereco', 'TEXT');
  await addCol('clientes', 'cidade', 'TEXT');
  const novoEnd = await addCol('clientes', 'cep', 'TEXT');
  for (const c of ['numero', 'complemento', 'bairro', 'uf']) await addCol('clientes', c, 'TEXT');
  // endereço onde o extintor está instalado (vazio = usa o endereço fixo do cliente)
  const novoEndExt = await addCol('extintores', 'cep', 'TEXT');
  for (const c of ['endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf']) await addCol('extintores', c, 'TEXT');
  const novaCap = await addCol('extintores', 'capacidade', 'TEXT');
  await addCol('extintores', 'local', 'TEXT');
  await addCol('ordens_servico', 'descricao', 'TEXT');
  await addCol('ordens_servico', 'veiculo_id', 'INTEGER REFERENCES veiculos(id)');

  /* ----- dados iniciais das novas estruturas ----- */
  if (novoTel) {
    const dados = [
      ['Empresa ABC', '(11) 3333-1001', 'contato@empresaabc.com.br', 'Av. Brasil, 1200', 'São Paulo'],
      ['Posto Central', '(11) 3333-1002', 'gerencia@postocentral.com.br', 'Rua das Flores, 45', 'São Paulo'],
      ['Condomínio Vista Bela', '(11) 3333-1003', 'sindico@vistabela.com.br', 'Rua Vista Bela, 300', 'Guarulhos'],
      ['Indústria XYZ', '(11) 3333-1004', 'seguranca@xyz.ind.br', 'Rod. Anhanguera km 20', 'Osasco'],
      ['Escola Municipal', '(11) 3333-1005', 'direcao@escolamunicipal.edu.br', 'Praça da Escola, 10', 'Barueri'],
      ['Hospital São Lucas', '(11) 3333-1006', 'engenharia@saolucas.org.br', 'Av. da Saúde, 800', 'São Paulo'],
    ];
    for (const d of dados) {
      await db.execute({ sql: 'UPDATE clientes SET telefone=?, email=?, endereco=?, cidade=? WHERE nome=?', args: [d[1], d[2], d[3], d[4], d[0]] });
    }
  }
  if (novoEnd) await db.execute("UPDATE clientes SET uf = 'SP' WHERE endereco IS NOT NULL AND uf IS NULL");
  if (novoEndExt) {
    // exemplo: um extintor instalado em endereço diferente do cadastro do cliente
    await db.execute(`UPDATE extintores SET cep='13015-000', endereco='Rua das Acácias', numero='77', bairro='Jardim Primavera', cidade='Campinas', uf='SP'
                      WHERE codigo='EXT-001'`);
  }
  if (novaCap) {
    await db.execute(`UPDATE extintores SET
      capacidade = CASE tipo WHEN 'PQS' THEN '6 kg' WHEN 'CO2' THEN '6 kg' ELSE '10 L' END,
      local = CASE (id % 5) WHEN 0 THEN 'Recepção' WHEN 1 THEN 'Corredor principal' WHEN 2 THEN 'Almoxarifado' WHEN 3 THEN 'Cozinha' ELSE 'Garagem' END`);
  }
  // IMPORTANTE: não recriar dados de exemplo a cada inicialização. Se o usuário apagar veículos, manutenções ou vínculos,
  // eles NÃO podem voltar quando o servidor reinicia (isso acontecia com os exemplos antigos).
  const padrao = {
    empresa_nome: 'Extinsul Extintores Ltda.', empresa_telefone: '', empresa_email: '',
    dias_alerta: '7', intervalo_vistoria_dias: '180',
  };
  for (const [k, v] of Object.entries(padrao)) {
    await db.execute({ sql: 'INSERT OR IGNORE INTO configuracoes(chave, valor) VALUES (?, ?)', args: [k, v] });
  }
  // Módulo de estoque: estrutura em arquivo SQL próprio (db/migrations), também aplicável à mão com o Turso CLI
  // No Cloudflare Workers o SQL vem embutido no bundle (opcoes.estoqueSql); no Node, lê do arquivo
  const estoqueSql = opcoes.estoqueSql || fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '002_estoque.sql'), 'utf8');
  await db.executeMultiple(estoqueSql);
  // Módulo de segurança do login (auth_tentativas e auth_logs): idempotente e aditivo
  const loginSql = opcoes.loginSql || fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '003_login_seguranca.sql'), 'utf8');
  await db.executeMultiple(loginSql);
  await addCol('auth_tentativas', 'bloqueado_em', 'INTEGER');
  await db.batch([
    'CREATE INDEX IF NOT EXISTS idx_manut_ext ON manutencoes(extintor_id)',
    'CREATE INDEX IF NOT EXISTS idx_fotos_data ON fotos(data)',
    'CREATE INDEX IF NOT EXISTS idx_fotos_ext ON fotos(extintor_id)',
    'CREATE INDEX IF NOT EXISTS idx_os_motorista ON ordens_servico(motorista_id, data)',
  ], 'write');

  if ((await contagem('usuarios')) === 0) {
    await seedInicial();
  }
}

async function seedInicial() {
  const usuarios = [
    ['Carlos Silva', 'gerente', '1111'],
    ['João Pereira', 'operador', '2222'],
    ['Roberto Almeida', 'motorista', '3333'],
  ];
  for (const [nome, perfil, pin] of usuarios) {
    await db.execute({
      sql: 'INSERT INTO usuarios(nome, perfil, pin_hash, pin_cifrado, ativo) VALUES (?,?,?,?,1)',
      args: [nome, perfil, hashPin(pin), cifraPin(pin)],
    });
  }

  const motId = (await db.execute("SELECT id FROM usuarios WHERE perfil = 'motorista' ORDER BY id LIMIT 1")).rows[0]?.id || null;
  const opId = (await db.execute("SELECT id FROM usuarios WHERE perfil = 'operador' ORDER BY id LIMIT 1")).rows[0]?.id || null;

  const clientesDados = [
    ['Empresa ABC', '(11) 3333-1001', 'contato@empresaabc.com.br', 'Av. Brasil', '1200', 'Centro', 'São Paulo', 'SP'],
    ['Posto Central', '(11) 3333-1002', 'gerencia@postocentral.com.br', 'Rua das Flores', '45', 'Centro', 'São Paulo', 'SP'],
    ['Condomínio Vista Bela', '(11) 3333-1003', 'sindico@vistabela.com.br', 'Rua Vista Bela', '300', 'Vila Nova', 'Guarulhos', 'SP'],
    ['Indústria XYZ', '(11) 3333-1004', 'seguranca@xyz.ind.br', 'Rod. Anhanguera', 'km 20', 'Distrito Industrial', 'Osasco', 'SP'],
    ['Escola Municipal', '(11) 3333-1005', 'direcao@escolamunicipal.edu.br', 'Praça da Escola', '10', 'Centro', 'Barueri', 'SP'],
    ['Hospital São Lucas', '(11) 3333-1006', 'engenharia@saolucas.org.br', 'Av. da Saúde', '800', 'Saúde', 'São Paulo', 'SP'],
  ];
  const cid = {};
  for (const [nome, tel, email, end, num, bairro, cidade, uf] of clientesDados) {
    const r = await db.execute({
      sql: 'INSERT INTO clientes(nome, telefone, email, endereco, numero, bairro, cidade, uf) VALUES (?,?,?,?,?,?,?,?)',
      args: [nome, tel, email, end, num, bairro, cidade, uf],
    });
    cid[nome] = Number(r.lastInsertRowid);
  }

  const tipos = ['PQS', 'CO2', 'Água'];
  const locais = ['Recepção', 'Corredor principal', 'Almoxarifado', 'Cozinha', 'Garagem'];
  const extStmts = [];
  for (let n = 1; n <= 30; n++) {
    const cli = clientesDados[n % clientesDados.length][0];
    const tp = tipos[n % tipos.length];
    const atrasado = n % 6 === 2;
    const status = atrasado ? 'em_atraso' : 'em_dia';
    const prox = atrasado ? somaDias(-(n % 20) - 1) : (n <= 10 ? somaDias((n % 7) + 1) : somaDias(30 + (n % 90)));
    const cap = tp === 'Água' ? '10 L' : '6 kg';
    const loc = locais[n % locais.length];
    if (n === 1) {
      extStmts.push({
        sql: `INSERT INTO extintores(codigo, cliente_id, tipo, status, capacidade, local, proxima_vistoria, cep, endereco, numero, bairro, cidade, uf)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: ['EXT-001', cid['Empresa ABC'], 'PQS', 'em_dia', '6 kg', 'Recepção', somaDias(3), '13015-000', 'Rua das Acácias', '77', 'Jardim Primavera', 'Campinas', 'SP'],
      });
    } else {
      extStmts.push({
        sql: 'INSERT INTO extintores(codigo, cliente_id, tipo, status, capacidade, local, proxima_vistoria) VALUES (?,?,?,?,?,?,?)',
        args: [`EXT-${String(n).padStart(3, '0')}`, cid[cli], tp, status, cap, loc, prox],
      });
    }
  }
  await db.batch(extStmts, 'write');

  if ((await contagem('veiculos')) === 0) {
    await db.batch([
      { sql: 'INSERT INTO veiculos(placa, modelo, ano, km_atual, status, motorista_id) VALUES (?,?,?,?,?,?)', args: ['ABC-1D23', 'Fiat Strada', 2022, 41200, 'em_uso', motId] },
      { sql: 'INSERT INTO veiculos(placa, modelo, ano, km_atual, status, motorista_id) VALUES (?,?,?,?,?,?)', args: ['DEF-4G56', 'Renault Master', 2020, 87650, 'disponivel', null] },
      { sql: 'INSERT INTO veiculos(placa, modelo, ano, km_atual, status, motorista_id) VALUES (?,?,?,?,?,?)', args: ['GHI-7J89', 'VW Delivery 9.170', 2019, 132400, 'manutencao', null] },
    ], 'write');
  }
  const veicId = (await db.execute('SELECT id FROM veiculos ORDER BY id LIMIT 1')).rows[0]?.id || null;

  const ordens = [
    ['OS-0048', 'Empresa ABC', 'Recarga', 'em_andamento', 0, '08:00', '09:00', 1],
    ['OS-0047', 'Posto Central', 'Manutenção', 'pendente', -1, '09:30', '10:30', 2],
    ['OS-0046', 'Condomínio Vista Bela', 'Vistoria', 'concluida', -2, '11:00', '12:00', 3],
    ['OS-0045', 'Indústria XYZ', 'Recarga', 'concluida', -4, '13:30', '15:00', 4],
    ['OS-0044', 'Escola Municipal', 'Manutenção', 'pendente', -6, '15:30', '16:30', 5],
  ];
  for (const [num, cli, tp, st, off, hi, hf, ordem] of ordens) {
    await db.execute({
      sql: 'INSERT INTO ordens_servico(numero, cliente_id, tipo, status, data, hora_inicio, hora_fim, motorista_id, ordem_rota, veiculo_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
      args: [num, cid[cli], tp, st, somaDias(off), hi, hf, motId, ordem, veicId],
    });
  }

  const vist = [
    [0, 'EXT-012', 'conforme', null],
    [-1, 'EXT-009', 'conforme', null],
    [-2, 'EXT-014', 'nao_conforme', 'Pressão abaixo do indicado'],
    [-3, 'EXT-017', 'conforme', null],
    [-4, 'EXT-006', 'conforme', null],
  ];
  for (const [off, cod, res, obs] of vist) {
    const ext = (await db.execute({ sql: 'SELECT id FROM extintores WHERE codigo = ?', args: [cod] })).rows[0];
    if (ext) {
      await db.execute({
        sql: 'INSERT INTO vistorias(data, extintor_id, operador_id, resultado, observacao) VALUES (?,?,?,?,?)',
        args: [somaDias(off), ext.id, opId, res, obs],
      });
    }
  }
}

module.exports = { migrar };
