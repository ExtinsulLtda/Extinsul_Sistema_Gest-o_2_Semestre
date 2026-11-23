const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const P = require('./pecas');
const dbMod = require('./db');

test('validaSequencia aceita inteiros 01..99 e rejeita fora da faixa ou texto', () => {
  assert.equal(P.validaSequencia('01'), 1);
  assert.equal(P.validaSequencia(9), 9);
  assert.equal(P.validaSequencia('99'), 99);

  assert.throws(() => P.validaSequencia(''), /obrigatória/);
  assert.throws(() => P.validaSequencia('0'), /01 e 99/);
  assert.throws(() => P.validaSequencia('100'), /01 a 99/);
  assert.throws(() => P.validaSequencia('-2'), /01 a 99/);
  assert.throws(() => P.validaSequencia('1a'), /01 a 99/);
});

test('validaOS aceita somente digitos numericos de 1 a 12 caracteres', () => {
  assert.equal(P.validaOS('123456'), '123456');
  assert.equal(P.validaOS('123456789012'), '123456789012');

  assert.throws(() => P.validaOS(''), /obrigatório/);
  assert.throws(() => P.validaOS('OS-123'), /somente dígitos/);
  assert.throws(() => P.validaOS('1234567890123'), /máximo 12 dígitos/);
});

test('validaNumeroPeca aceita letras, numeros e hifen e rejeita caracteres invalidos', () => {
  assert.equal(P.validaNumeroPeca('  PC-104A  '), 'PC-104A');
  assert.equal(P.validaNumeroPeca('99812'), '99812');

  assert.throws(() => P.validaNumeroPeca(''), /obrigatório/);
  assert.throws(() => P.validaNumeroPeca('PC 104'), /letras, números e hífen/);
  assert.throws(() => P.validaNumeroPeca('PC@104'), /letras, números e hífen/);
});

test('validaLancamentoTravas exige OS valida, faixa 0..999 e nao permite ambos zero', () => {
  assert.deepEqual(P.validaLancamentoTravas({ os: '4821', qtd_travas: 2, qtd_cordoes: 0 }), {
    os: '4821',
    qtd_travas: 2,
    qtd_cordoes: 0,
  });
  assert.deepEqual(P.validaLancamentoTravas({ os: '4821', qtd_travas: 0, qtd_cordoes: 999 }), {
    os: '4821',
    qtd_travas: 0,
    qtd_cordoes: 999,
  });

  assert.throws(() => P.validaLancamentoTravas({ os: '4821', qtd_travas: 0, qtd_cordoes: 0 }), /pelo menos 1 trava/);
  assert.throws(() => P.validaLancamentoTravas({ os: '4821', qtd_travas: 1000, qtd_cordoes: 1 }), /inválido/);
  assert.throws(() => P.validaLancamentoTravas({ os: '4821', qtd_travas: -1, qtd_cordoes: 1 }), /inválido/);
});

test('validaSituacaoPayload valida enum de situacao e motivo opcional', () => {
  assert.deepEqual(P.validaSituacaoPayload({ situacao: 'nao_listado' }), {
    situacao: 'nao_listado',
    motivo_analise: undefined,
  });
  assert.deepEqual(P.validaSituacaoPayload({ situacao: 'em_analise', motivo_analise: '  Falta conferir  ' }), {
    situacao: 'em_analise',
    motivo_analise: 'Falta conferir',
  });
  assert.deepEqual(P.validaSituacaoPayload({ situacao: 'em_analise', motivo_analise: '' }), {
    situacao: 'em_analise',
    motivo_analise: null,
  });

  assert.throws(() => P.validaSituacaoPayload({ situacao: 'pendente' }), /Situação inválido/);
});

test('005_pecas.sql define exatamente 32 pecas iniciais (7 + 25), notificacoes e sem ALTER/DROP', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '005_pecas.sql'), 'utf8');
  assert.equal(/ALTER\s+TABLE|DROP\s+TABLE/i.test(sql), false);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pecas_notificacoes/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pecas_notificacoes_lidas/i);
  const mang = sql.match(/\('Mangueiras e válvulas',\s*'[^']+',\s*\d+\)/g) || [];
  const peq = sql.match(/\('Peças pequenas',\s*'(?:''|[^'])+',\s*\d+\)/g) || [];
  assert.equal(mang.length, 7);
  assert.equal(peq.length, 25);
});

test('validarAmbienteProducao permite fallback local em Node, rejeita parcial e exige Turso no Workers', () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    WORKERS: process.env.WORKERS,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  };
  const restaurar = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  try {
    delete process.env.NODE_ENV;
    delete process.env.WORKERS;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    assert.equal(dbMod.validarAmbienteProducao().modo, 'local');

    // Em NODE_ENV=production sem Turso definido, permite subir com banco local e aviso
    process.env.NODE_ENV = 'production';
    const resProdLocal = dbMod.validarAmbienteProducao();
    assert.equal(resProdLocal.modo, 'local');
    assert.match(resProdLocal.aviso, /produção sem Turso/i);

    // Configuração parcial ou explícita file: em produção continua bloqueada
    process.env.TURSO_DATABASE_URL = 'file:db/extinsul.db';
    process.env.TURSO_AUTH_TOKEN = 'tok';
    assert.throws(() => dbMod.validarAmbienteProducao(), /file:/);

    process.env.TURSO_DATABASE_URL = 'libsql://banco-teste.turso.io';
    delete process.env.TURSO_AUTH_TOKEN;
    assert.throws(() => dbMod.validarAmbienteProducao(), /TURSO_AUTH_TOKEN/);

    delete process.env.TURSO_DATABASE_URL;
    process.env.TURSO_AUTH_TOKEN = 'tok-orfao';
    assert.throws(() => dbMod.validarAmbienteProducao(), /TURSO_DATABASE_URL/);

    process.env.TURSO_DATABASE_URL = 'libsql://banco-teste.turso.io';
    process.env.TURSO_AUTH_TOKEN = 'tok-teste';
    assert.equal(dbMod.validarAmbienteProducao().modo, 'turso');

    // No Cloudflare Workers (WORKERS=1), Turso é sempre obrigatório
    delete process.env.NODE_ENV;
    process.env.WORKERS = '1';
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    assert.throws(() => dbMod.validarAmbienteProducao(), /TURSO_DATABASE_URL/);

    process.env.TURSO_DATABASE_URL = 'libsql://banco-teste.turso.io';
    assert.throws(() => dbMod.validarAmbienteProducao(), /TURSO_AUTH_TOKEN/);

    process.env.TURSO_AUTH_TOKEN = 'tok-teste';
    assert.equal(dbMod.validarAmbienteProducao().modo, 'turso');
  } finally {
    restaurar();
  }
});

test('server.js inicia em NODE_ENV=production sem Turso (fallback) e recusa configuracao parcial', async () => {
  const { spawn } = require('node:child_process');
  const envParcial = { ...process.env, NODE_ENV: 'production', TURSO_DATABASE_URL: 'libsql://parcial.turso.io' };
  delete envParcial.TURSO_AUTH_TOKEN;
  let falhou = false;
  try {
    execFileSync(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: envParcial,
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (err) {
    falhou = true;
    assert.equal(err.status, 1);
    assert.match(String(err.stderr || err.message), /TURSO_AUTH_TOKEN/);
  }
  assert.equal(falhou, true);

  const wr = fs.readFileSync(path.join(__dirname, '..', 'wrangler.toml'), 'utf8');
  assert.match(wr, /"@libsql\/client"\s*=\s*"\.\/src\/libsql-worker\.js"/);
  const wk = fs.readFileSync(path.join(__dirname, '..', 'src', 'worker.js'), 'utf8');
  assert.match(wk, /^[^\n]*\n[^\n]*\nimport '\.\/worker-env\.js';/);

  // Sobe server.js em NODE_ENV=production sem variáveis do Turso e confirma que abre a porta e responde
  const envFallback = { ...process.env, NODE_ENV: 'production', PORT: '39876' };
  delete envFallback.TURSO_DATABASE_URL;
  delete envFallback.TURSO_AUTH_TOKEN;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: envFallback,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d.toString(); });
  child.stderr.on('data', (d) => { logs += d.toString(); });
  try {
    await new Promise((resolve, reject) => {
      const prazo = setTimeout(() => reject(new Error('Timeout esperando server.js em producao: ' + logs)), 8000);
      child.on('exit', (code) => {
        clearTimeout(prazo);
        reject(new Error(`server.js saiu inesperadamente (${code}): ${logs}`));
      });
      const checa = setInterval(() => {
        if (logs.includes('Extinsul rodando')) {
          clearInterval(checa);
          clearTimeout(prazo);
          resolve();
        }
      }, 50);
    });
    assert.match(logs, /produção sem Turso/i);
    const resp = await fetch('http://127.0.0.1:39876/api/login/status');
    assert.equal(resp.status, 200);
  } finally {
    child.kill('SIGKILL');
  }
});

test('migracao idempotente, FK ativa, rejeicao da linha 41, rollback e isolamento de falha em Peças', () => {
  const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extinsul-pecas-test-'));
  const dbPath = path.join(dirTmp, 'teste.db');
  const script = `
    const assert = require('node:assert/strict');
    const db = require('./api/db');
    const { migrar, migrarPecas, obterStatusPecas } = require('./api/migrate');

    (async () => {
      // 1. Executa migração duas vezes seguidas (idempotência)
      await migrar();
      await migrar();
      assert.equal(obterStatusPecas().ok, true);

      const cat = await db.execute('SELECT COUNT(*) AS n FROM pecas_catalogo WHERE ativo = 1');
      assert.equal(Number(cat.rows[0].n), 32);

      // 2. Confirma PRAGMA foreign_keys = ON e rejeição de FKs inválidas / 41ª linha
      await db.garantirForeignKeys();
      const fk = await db.execute('PRAGMA foreign_keys');
      assert.equal(Number(fk.rows[0].foreign_keys), 1);

      const op = (await db.execute("SELECT id FROM usuarios WHERE perfil = 'operador' LIMIT 1")).rows[0];
      const ger = (await db.execute("SELECT id FROM usuarios WHERE perfil = 'gerente' LIMIT 1")).rows[0];
      assert.ok(op && ger);

      await assert.rejects(
        () => db.execute({
          sql: "INSERT INTO pecas_lancamentos(tabela_id, ordem, catalogo_id, peca_nome, sequencia, os, numero_peca, operador_id, criado_em, data_envio, horario_envio) VALUES (999999, 1, 1, 'X', 1, '1', 'A-1', ?, '2026-01-01T00:00:00Z', '2026-01-01', '10:00')",
          args: [op.id],
        }),
        /FOREIGN KEY/i
      );

      // 3. Rollback de transação atômica (tudo ou nada)
      const tabIns = await db.execute({
        sql: "INSERT INTO pecas_tabelas_globais(nome, status, criado_por, criado_em, data_criacao, horario_criacao) VALUES ('T-Roll', 'aberta', ?, '2026-01-01T00:00:00Z', '2026-01-01', '10:00')",
        args: [ger.id],
      });
      const tabId = Number(tabIns.lastInsertRowid);

      await assert.rejects(() => db.emTransacao(async (tx) => {
        await tx.execute({
          sql: "INSERT INTO pecas_lancamentos(tabela_id, ordem, catalogo_id, peca_nome, sequencia, os, numero_peca, operador_id, criado_em, data_envio, horario_envio) VALUES (?, 1, 1, 'Mangueira de CO2', 1, '10', 'PC-1', ?, '2026-01-01T00:00:00Z', '2026-01-01', '10:00')",
          args: [tabId, op.id],
        });
        throw new Error('Falha simulada no meio da transacao');
      }), /Falha simulada/);

      const aposRoll = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM pecas_lancamentos WHERE tabela_id = ?', args: [tabId] });
      assert.equal(Number(aposRoll.rows[0].n), 0);

      // 4. Rejeição na tentativa de inserir ordem 41 (CHECK BETWEEN 1 AND 40)
      await assert.rejects(
        () => db.execute({
          sql: "INSERT INTO pecas_lancamentos(tabela_id, ordem, catalogo_id, peca_nome, sequencia, os, numero_peca, operador_id, criado_em, data_envio, horario_envio) VALUES (?, 41, 1, 'Mangueira de CO2', 1, '10', 'PC-41', ?, '2026-01-01T00:00:00Z', '2026-01-01', '10:00')",
          args: [tabId, op.id],
        }),
        /CHECK constraint/i
      );

      // 5. Falha isolada de migrarPecas não derruba o banco nem o login
      await migrarPecas({ pecasSql: 'SQL INVALIDO QUEBRADO;' });
      assert.equal(obterStatusPecas().ok, false);
      const usr = await db.execute('SELECT COUNT(*) AS n FROM usuarios');
      assert.equal(Number(usr.rows[0].n), 3);
    })();
  `;
  try {
    execFileSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'development', TURSO_DATABASE_URL: `file:${dbPath}` },
      encoding: 'utf8',
      timeout: 15000,
    });
  } finally {
    fs.rmSync(dirTmp, { recursive: true, force: true });
  }
});

