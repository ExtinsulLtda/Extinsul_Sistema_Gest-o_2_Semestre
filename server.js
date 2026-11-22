// Extinsul - servidor Node local (Express). Em produção no Cloudflare, veja src/worker.js e wrangler.toml.
require('dotenv').config();
const path = require('path');
const express = require('express');
const { migrar } = require('./api/migrate');
const app = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;

/* ---------- páginas (somente as pastas públicas) ---------- */
['css', 'js', 'assets', 'gerente', 'operador', 'motorista'].forEach((p) =>
  app.use('/' + p, express.static(path.join(__dirname, p))));
app.get('/index.html', (_req, res) => res.redirect('/'));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

if (process.env.TURSO_DATABASE_URL) {
  console.log('[banco] Usando o Turso (os dados ficam salvos fora do servidor).');
} else {
  console.warn('[banco] ATENÇÃO: TURSO_DATABASE_URL não definido — usando o arquivo local db/extinsul.db.');
}

migrar()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`Extinsul rodando em http://0.0.0.0:${PORT}`)))
  .catch((e) => { console.error('Falha ao preparar o banco:', e); process.exit(1); });
