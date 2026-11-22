// Conexão com o banco (Turso/libSQL ou arquivo SQLite local fora da Vercel).
// O cliente é criado só no primeiro uso para respeitar variáveis injetadas em tempo de execução.
const path = require('path');

let cliente = null;

function erroConfig(mensagem) {
  const err = new Error(mensagem);
  err.status = 503;
  err.codigo = 'CONFIG_TURSO_AUSENTE';
  return err;
}

function obter() {
  if (!cliente) {
    const url = (process.env.TURSO_DATABASE_URL || '').trim();
    const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim();
    const emVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
    const emWorkers = Boolean(process.env.WORKERS);

    const { createClient } = emWorkers ? require('@libsql/client/web') : require('@libsql/client');

    if (!url) {
      if (emVercel) {
        throw erroConfig('TURSO_DATABASE_URL não configurado nas Environment Variables da Vercel.');
      }
      if (emWorkers) {
        throw erroConfig('TURSO_DATABASE_URL não configurado (use: wrangler secret put TURSO_DATABASE_URL).');
      }
      cliente = createClient({ url: 'file:' + path.join(__dirname, '..', '..', 'db', 'extinsul.db') });
    } else {
      if ((emVercel || emWorkers) && !authToken) {
        throw erroConfig('TURSO_AUTH_TOKEN não configurado nas variáveis de ambiente do servidor.');
      }
      cliente = createClient({ url, authToken: authToken || undefined });
    }
  }
  return cliente;
}

// Mesma interface do cliente (execute, batch, executeMultiple...), criado sob demanda
module.exports = new Proxy({}, {
  get: (_t, prop) => {
    const c = obter();
    const v = c[prop];
    return typeof v === 'function' ? v.bind(c) : v;
  },
});
