// Entrada Serverless da Vercel: atende todas as rotas /api/* via Express + Turso
const fs = require('fs');
const path = require('path');

try { require('dotenv').config(); } catch { /* opcional na Vercel */ }

const app = require('../src/app');
const { migrar } = require('./_core/migrate');

function lerSql(nome) {
  const caminhos = [
    path.join(process.cwd(), 'db', 'migrations', nome),
    path.join(__dirname, '..', 'db', 'migrations', nome),
  ];
  for (const p of caminhos) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return undefined;
}

let migrado = null;
app.locals.preparar = () => {
  if (!migrado) {
    migrado = migrar({
      estoqueSql: lerSql('002_estoque.sql'),
      loginSql: lerSql('003_login_seguranca.sql'),
    }).catch((err) => {
      migrado = null;
      throw err;
    });
  }
  return migrado;
};

module.exports = app;
