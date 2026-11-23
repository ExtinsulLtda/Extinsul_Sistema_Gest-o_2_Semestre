// Entrada do Cloudflare Worker: roda a API Express (rotas /api/*); as páginas estáticas
// (HTML/CSS/JS) são servidas direto pelo Workers Assets (pasta public/).
import './worker-env.js';
import { httpServerHandler } from 'cloudflare:node';
import estoqueSql from '../db/migrations/002_estoque.sql';
import loginSql from '../db/migrations/003_login_seguranca.sql';
import reservasSql from '../db/migrations/004_reservas.sql';
import pecasSql from '../db/migrations/005_pecas.sql';
import app from './app.js';
import db from '../api/db.js';
import { migrar } from '../api/migrate.js';

// Migração idempotente: roda uma vez por instância do Worker, antes da primeira requisição à API
let migrado = null;
app.locals.preparar = () => {
  if (!migrado) {
    migrado = Promise.resolve()
      .then(() => {
        db.validarAmbienteProducao();
        return migrar({ estoqueSql, loginSql, reservasSql, pecasSql });
      })
      .catch((e) => { migrado = null; throw e; });
  }
  return migrado;
};

app.listen(8080);
export default httpServerHandler({ port: 8080 });
