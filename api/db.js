// Conexão com o banco (Turso/libSQL ou arquivo SQLite local).
// O cliente é criado só no primeiro uso: no Cloudflare Workers as variáveis/secrets
// só ficam disponíveis em process.env depois que o Worker inicia.
let cliente = null;
function obter() {
  if (!cliente) {
    const url = process.env.TURSO_DATABASE_URL;
    // No Workers só funciona a versão HTTP (@libsql/client/web); no Node usa a completa (aceita arquivo local)
    const { createClient } = process.env.WORKERS ? require('@libsql/client/web') : require('@libsql/client');
    if (!url) {
      if (process.env.WORKERS) throw new Error('TURSO_DATABASE_URL não configurado (use: wrangler secret put TURSO_DATABASE_URL).');
      cliente = createClient({ url: 'file:' + require('path').join(__dirname, '..', 'db', 'extinsul.db') });
    } else {
      cliente = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    }
  }
  return cliente;
}

// Mesma interface do cliente (execute, batch, executeMultiple...), criado sob demanda
module.exports = new Proxy({}, { get: (_t, prop) => { const c = obter(); const v = c[prop]; return typeof v === 'function' ? v.bind(c) : v; } });
