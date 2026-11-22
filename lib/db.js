// Conexão com o Turso (libSQL) + migração automática do esquema
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const { hashPin } = require('./auth');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:' + path.join(__dirname, '..', 'db', 'extinsul.db'),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Colunas adicionadas depois da primeira versão do banco (para bancos já criados)
const COLUNAS_NOVAS = {
  usuarios: [['telefone', 'TEXT']],
  clientes: [['telefone', 'TEXT'], ['email', 'TEXT'], ['endereco', 'TEXT'], ['cidade', 'TEXT']],
  extintores: [['localizacao', 'TEXT'], ['capacidade', 'TEXT'], ['observacao', 'TEXT']],
  ordens_servico: [['veiculo_id', 'INTEGER'], ['descricao', 'TEXT'], ['entregue_em', 'TEXT']],
};

const CONFIG_PADRAO = {
  empresa_nome: 'Extinsul Extintores Ltda.',
  empresa_telefone: '',
  empresa_email: '',
  dias_alerta: '7',
  intervalo_vistoria_dias: '180',
};

const ENDERECOS = {
  'Empresa ABC': ['Rua das Acácias, 120 - Centro', 'Varginha', '(35) 3221-1001'],
  'Posto Central': ['Av. Princesa do Sul, 850', 'Varginha', '(35) 3221-1002'],
  'Condomínio Vista Bela': ['Rua Bela Vista, 45', 'Varginha', '(35) 3221-1003'],
  'Indústria XYZ': ['Rod. BR-491, km 12', 'Varginha', '(35) 3221-1004'],
  'Escola Municipal': ['Rua da Escola, 300', 'Varginha', '(35) 3221-1005'],
  'Hospital São Lucas': ['Av. Rui Barbosa, 1500', 'Varginha', '(35) 3221-1006'],
};

async function migrar() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await db.executeMultiple(sql);

  for (const [tabela, cols] of Object.entries(COLUNAS_NOVAS)) {
    const info = await db.execute(`PRAGMA table_info(${tabela})`);
    const existentes = new Set(info.rows.map((r) => r.name));
    for (const [nome, tipo] of cols) {
      if (!existentes.has(nome)) await db.execute(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${tipo}`);
    }
  }

  for (const [k, v] of Object.entries(CONFIG_PADRAO)) {
    await db.execute({ sql: 'INSERT OR IGNORE INTO configuracoes(chave, valor) VALUES (?, ?)', args: [k, v] });
  }

  // Dados de exemplo para bancos antigos (só preenche o que estiver vazio)
  for (const [nome, [end, cid, tel]] of Object.entries(ENDERECOS)) {
    await db.execute({
      sql: 'UPDATE clientes SET endereco = ?, cidade = ?, telefone = ? WHERE nome = ? AND endereco IS NULL',
      args: [end, cid, tel, nome],
    });
  }
  const nv = await db.execute('SELECT COUNT(*) AS n FROM veiculos');
  if (Number(nv.rows[0].n) === 0) {
    const mot = await db.execute("SELECT id FROM usuarios WHERE perfil = 'motorista' AND ativo = 1 ORDER BY id LIMIT 1");
    const motId = mot.rows[0] ? mot.rows[0].id : null;
    const vs = [['ABC-1D23', 'Fiat Strada', 'Utilitário', 2022, 41200, 'em_rota', motId],
                ['DEF-4G56', 'Renault Master', 'Van', 2020, 87650, 'disponivel', null],
                ['GHI-7J89', 'VW Delivery 9.170', 'Caminhão', 2019, 132400, 'manutencao', null]];
    for (const v of vs) {
      await db.execute({ sql: 'INSERT INTO veiculos(placa, modelo, tipo, ano, km, status, motorista_id) VALUES (?,?,?,?,?,?,?)', args: v });
    }
  }
}

module.exports = { db, migrar, hashPin };
