// Conexão com o banco (Turso/libSQL ou arquivo SQLite local).
// O cliente é criado só no primeiro uso: no Cloudflare Workers as variáveis/secrets
// só ficam disponíveis em process.env depois que o Worker inicia.
let cliente = null;
let fkAtivadoLocal = false;

function ehProducao() {
  return process.env.WORKERS === '1' || process.env.NODE_ENV === 'production';
}

// Em produção (Cloudflare Workers ou NODE_ENV=production), recusa iniciar sem as variáveis do Turso.
// Evita que os dados caiam em um arquivo SQLite local efêmero sem o usuário perceber.
function validarAmbienteProducao() {
  if (!ehProducao()) return;
  const url = String(process.env.TURSO_DATABASE_URL || '').trim();
  const token = String(process.env.TURSO_AUTH_TOKEN || '').trim();
  if (!url) {
    throw new Error('Configuração inválida em produção: TURSO_DATABASE_URL não definida.');
  }
  if (/^file:/i.test(url)) {
    throw new Error('Configuração inválida em produção: URL local (file:) não é permitida.');
  }
  if (!/^(libsql|https):\/\//i.test(url)) {
    throw new Error('Configuração inválida em produção: TURSO_DATABASE_URL deve usar libsql:// ou https://.');
  }
  if (!token) {
    throw new Error('Configuração inválida em produção: TURSO_AUTH_TOKEN não definido.');
  }
}

function obter() {
  if (!cliente) {
    validarAmbienteProducao();
    const url = String(process.env.TURSO_DATABASE_URL || '').trim();
    const token = String(process.env.TURSO_AUTH_TOKEN || '').trim();
    // No Workers só funciona a versão HTTP (@libsql/client/web); no Node usa a completa (aceita arquivo local)
    const { createClient } = process.env.WORKERS ? require('@libsql/client/web') : require('@libsql/client');
    if (!url) {
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
  { validarAmbienteProducao, ehProducao, garantirForeignKeys, emTransacao },
  {
    get(alvo, prop) {
      if (Object.prototype.hasOwnProperty.call(alvo, prop)) return alvo[prop];
      const c = obter();
      const v = c[prop];
      return typeof v === 'function' ? v.bind(c) : v;
    },
  }
);
