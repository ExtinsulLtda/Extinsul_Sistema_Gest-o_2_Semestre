// Conexão com o banco (Turso/libSQL ou arquivo SQLite local).
// O cliente é criado só no primeiro uso: no Cloudflare Workers as variáveis/secrets
// só ficam disponíveis em process.env depois que o Worker inicia.
let cliente = null;
let fkAtivadoLocal = false;

function ehWorkers() {
  return process.env.WORKERS === '1';
}

function ehProducao() {
  return ehWorkers() || process.env.NODE_ENV === 'production';
}

// No Workers, Turso é obrigatório (não existe arquivo local).
// No servidor Node, se nenhuma variável do Turso foi configurada, inicia com banco local provisório e avisa no log;
// se o usuário configurou apenas parte do Turso (ex.: URL sem token), bloqueia para evitar erro silencioso.
function validarAmbienteProducao() {
  const url = String(process.env.TURSO_DATABASE_URL || '').trim();
  const token = String(process.env.TURSO_AUTH_TOKEN || '').trim();
  const noWorkers = ehWorkers();
  const emProd = ehProducao();

  if (noWorkers) {
    if (!url) {
      throw new Error('Configuração inválida no Workers: TURSO_DATABASE_URL não definida.');
    }
    if (/^file:/i.test(url)) {
      throw new Error('Configuração inválida no Workers: URL local (file:) não é permitida.');
    }
    if (!/^(libsql|https):\/\//i.test(url)) {
      throw new Error('Configuração inválida no Workers: TURSO_DATABASE_URL deve usar libsql:// ou https://.');
    }
    if (!token) {
      throw new Error('Configuração inválida no Workers: TURSO_AUTH_TOKEN não definido.');
    }
    return { modo: 'turso' };
  }

  if (!url && !token) {
    return {
      modo: 'local',
      aviso: emProd
        ? 'AVISO (produção sem Turso): TURSO_DATABASE_URL/TURSO_AUTH_TOKEN não definidos — iniciando com o banco local provisório (db/extinsul.db). Configure o Turso para persistência definitiva.'
        : 'ATENÇÃO (desenvolvimento local): TURSO_DATABASE_URL não definido — usando db/extinsul.db.',
    };
  }

  if (!url && token) {
    throw new Error('Configuração inválida do Turso: TURSO_AUTH_TOKEN definido sem TURSO_DATABASE_URL.');
  }

  if (/^file:/i.test(url)) {
    if (emProd) {
      throw new Error('Configuração inválida em produção: URL local (file:) não é permitida quando TURSO_DATABASE_URL é informada.');
    }
    return { modo: 'local' };
  }

  if (!/^(libsql|https):\/\//i.test(url)) {
    throw new Error('Configuração inválida do Turso: TURSO_DATABASE_URL deve usar libsql:// ou https://.');
  }
  if (!token) {
    throw new Error('Configuração inválida do Turso: TURSO_AUTH_TOKEN não definido.');
  }
  return { modo: 'turso' };
}

function obter() {
  if (!cliente) {
    const info = validarAmbienteProducao();
    const url = String(process.env.TURSO_DATABASE_URL || '').trim();
    const token = String(process.env.TURSO_AUTH_TOKEN || '').trim();
    // No Workers só funciona a versão HTTP (@libsql/client/web); no Node usa a completa (aceita arquivo local)
    const { createClient } = ehWorkers() ? require('@libsql/client/web') : require('@libsql/client');
    if (info.modo === 'local' && !url) {
      cliente = createClient({ url: 'file:' + require('path').join(__dirname, '..', 'db', 'extinsul.db') });
    } else {
      cliente = createClient({ url, authToken: token || undefined });
    }
  }
  return cliente;
}

// Garante PRAGMA foreign_keys = ON no cliente atual quando possível
async function garantirForeignKeys() {
  const c = obter();
  if (!process.env.TURSO_DATABASE_URL && fkAtivadoLocal) return;
  await c.execute('PRAGMA foreign_keys = ON');
  if (!process.env.TURSO_DATABASE_URL) fkAtivadoLocal = true;
}

// Executa operações compostas em transação única (tudo ou nada) com chaves estrangeiras ativas
async function emTransacao(fn) {
  const c = obter();
  const tx = await c.transaction('write');
  try {
    await tx.execute('PRAGMA foreign_keys = ON');
    const res = await fn(tx);
    await tx.commit();
    return res;
  } catch (e) {
    try { await tx.rollback(); } catch { /* ignora erro de rollback se já encerrada */ }
    throw e;
  }
}

// Mesma interface do cliente (execute, batch, executeMultiple, transaction...), criado sob demanda
module.exports = new Proxy(
  { validarAmbienteProducao, ehProducao, ehWorkers, garantirForeignKeys, emTransacao },
  {
    get(alvo, prop) {
      if (Object.prototype.hasOwnProperty.call(alvo, prop)) return alvo[prop];
      const c = obter();
      const v = c[prop];
      return typeof v === 'function' ? v.bind(c) : v;
    },
  }
);
