// Inspeção SOMENTE LEITURA do banco (Turso ou arquivo local, conforme o .env). Não altera nada.
// Uso: node db/inspecionar.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../api/_core/db');

(async () => {
  const tabelas = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows.map((r) => r.name);
  for (const t of tabelas) {
    const n = (await db.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n;
    console.log(`\n== ${t} (${n} registros)`);
    (await db.execute(`PRAGMA table_info(${t})`)).rows.forEach((c) =>
      console.log(`   ${c.name} ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.pk ? ' PK' : ''}${c.dflt_value != null ? ' DEFAULT ' + c.dflt_value : ''}`));
    (await db.execute(`PRAGMA foreign_key_list(${t})`)).rows.forEach((f) => console.log(`   FK ${f.from} -> ${f.table}.${f.to}`));
    (await db.execute(`PRAGMA index_list(${t})`)).rows.forEach((i) => console.log(`   índice ${i.name}${i.unique ? ' (único)' : ''}`));
  }
  const esperadas = ['produtos', 'estoque_movimentacoes'];
  console.log('\nTabelas de estoque que faltam:', esperadas.filter((t) => !tabelas.includes(t)).join(', ') || 'nenhuma');
  console.log('foreign_key_check:', JSON.stringify((await db.execute('PRAGMA foreign_key_check')).rows));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
