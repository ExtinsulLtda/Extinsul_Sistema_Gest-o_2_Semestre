// Aplicação Express (sem listen): usada pelo servidor Node (server.js), Vercel (api/index.js) e Cloudflare Worker (src/worker.js)
const express = require('express');
const auth = require('../api/_core/auth');

const app = express();
// Leitor de JSON próprio (express.json depende do iconv-lite, que não carrega no Workers). Fotos chegam em base64.
const LIMITE = 1024 * 1024;
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) { req.body = {}; return next(); }
  if (req.body !== undefined || req.readableEnded) {
    if (typeof req.body === 'string') {
      try { req.body = req.body.trim() ? JSON.parse(req.body) : {}; }
      catch { return res.status(400).json({ erro: 'JSON inválido.' }); }
    } else if (req.body == null) {
      req.body = {};
    }
    return next();
  }
  const partes = [];
  let tam = 0, estourou = false;
  req.on('data', (c) => {
    tam += c.length;
    if (tam > LIMITE) { estourou = true; return; }
    partes.push(c);
  });
  req.on('error', next);
  req.on('end', () => {
    if (estourou) return res.status(413).json({ erro: 'Requisição muito grande.' });
    const txt = Buffer.concat(partes).toString('utf8');
    if (!txt.trim()) { req.body = {}; return next(); }
    try { req.body = JSON.parse(txt); next(); } catch { res.status(400).json({ erro: 'JSON inválido.' }); }
  });
});

// CORS apenas para o Live Server do VS Code (desenvolvimento)
const ORIGENS_DEV = ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:5501', 'http://127.0.0.1:5501'];
app.use('/api', (req, res, next) => {
  if (ORIGENS_DEV.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Gancho opcional de preparação (Worker e Vercel definem app.locals.preparar para migrar o banco na 1ª requisição)
app.use('/api', (_req, _res, next) => {
  if (!app.locals.preparar) return next();
  app.locals.preparar().then(() => next(), next);
});

app.use('/api', auth.router);
app.use('/api/gerente', require('../api/_core/gerente'));
app.use('/api/operador', require('../api/_core/operador'));
app.use('/api/motorista', require('../api/_core/motorista'));
app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// Tratador global para retornar JSON em erros de inicialização/configuração na Vercel ou no Node
app.use('/api', (err, _req, res, _next) => {
  console.error('[api]', err && err.message ? err.message : err);
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  const erro = status === 503 ? err.message : 'Erro interno ao processar requisição no servidor.';
  res.status(status).json({ erro });
});

module.exports = app;
