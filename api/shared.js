// Consultas usadas por mais de um perfil (listagens e detalhes)
const db = require('./db');
const U = require('./util');
const { HttpErro, linhas, inteiro, texto, paginacao, resposta, like, atualizaAtrasos, enderecoTexto, enderecoExtintor, COLS_END_CLIENTE } = U;

async function listarExtintores(req, res) {
  await atualizaAtrasos();
  const p = paginacao(req);
  const onde = [], args = [];
  const { q, status, tipo } = req.query;
  if (q) { onde.push('(e.codigo LIKE ? OR c.nome LIKE ? OR e.local LIKE ?)'); args.push(like(q), like(q), like(q)); }
  if (status) { onde.push('e.status = ?'); args.push(status); }
  if (tipo) { onde.push('e.tipo = ?'); args.push(tipo); }
  if (req.query.cliente_id) { onde.push('e.cliente_id = ?'); args.push(Number(req.query.cliente_id)); }
  const W = onde.length ? 'WHERE ' + onde.join(' AND ') : '';
  const base = `FROM extintores e JOIN clientes c ON c.id = e.cliente_id ${W}`;
  const [tot, r] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) AS n ${base}`, args }),
    db.execute({
      sql: `SELECT e.id, e.codigo, e.tipo, e.status, e.capacidade, e.local, e.proxima_vistoria, e.cliente_id, c.nome AS cliente,
              e.cep, e.endereco, e.numero, e.complemento, e.bairro, e.cidade, e.uf, ${COLS_END_CLIENTE},
              (SELECT COUNT(*) FROM fotos f WHERE f.extintor_id = e.id) AS fotos
            ${base} ORDER BY e.codigo LIMIT ? OFFSET ?`,
      args: [...args, p.limit, p.offset],
    }),
  ]);
  res.json(resposta(linhas(r).map(enderecoExtintor), Number(tot.rows[0].n), p));
}

async function detalheExtintor(req, res) {
  const id = inteiro(req.params.id, { nome: 'Extintor', obrig: true });
  const e = await db.execute({
    sql: `SELECT e.*, c.nome AS cliente, ${COLS_END_CLIENTE} FROM extintores e JOIN clientes c ON c.id = e.cliente_id WHERE e.id = ?`,
    args: [id],
  });
  if (!e.rows.length) throw new HttpErro(404, 'Extintor não encontrado.');
  const [v, m] = await Promise.all([
    db.execute({
      sql: `SELECT v.data, v.resultado, v.observacao, u.nome AS operador FROM vistorias v
            LEFT JOIN usuarios u ON u.id = v.operador_id WHERE v.extintor_id = ? ORDER BY v.data DESC, v.id DESC LIMIT 10`,
      args: [id],
    }),
    db.execute({
      sql: `SELECT m.data, m.tipo, m.descricao, m.custo, u.nome AS operador FROM manutencoes m
            LEFT JOIN usuarios u ON u.id = m.operador_id WHERE m.extintor_id = ? ORDER BY m.data DESC, m.id DESC LIMIT 10`,
      args: [id],
    }),
  ]);
  res.json({ extintor: enderecoExtintor({ ...e.rows[0] }), vistorias: linhas(v), manutencoes: linhas(m) });
}

async function listarClientes(req, res) {
  const p = paginacao(req);
  const onde = [], args = [];
  if (req.query.q) {
    onde.push('(c.nome LIKE ? OR c.cidade LIKE ? OR c.telefone LIKE ? OR c.email LIKE ?)');
    const l = like(req.query.q); args.push(l, l, l, l);
  }
  const W = onde.length ? 'WHERE ' + onde.join(' AND ') : '';
  const [tot, r] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) AS n FROM clientes c ${W}`, args }),
    db.execute({
      sql: `SELECT c.id, c.nome, c.telefone, c.email, c.cep, c.endereco, c.numero, c.complemento, c.bairro, c.cidade, c.uf,
              (SELECT COUNT(*) FROM extintores e WHERE e.cliente_id = c.id) AS extintores,
              (SELECT COUNT(*) FROM ordens_servico o WHERE o.cliente_id = c.id) AS os
            FROM clientes c ${W} ORDER BY c.nome LIMIT ? OFFSET ?`,
      args: [...args, p.limit, p.offset],
    }),
  ]);
  res.json(resposta(linhas(r).map((c) => ({ ...c, endereco_texto: enderecoTexto(c) })), Number(tot.rows[0].n), p));
}

async function detalheCliente(req, res) {
  const id = inteiro(req.params.id, { nome: 'Cliente', obrig: true });
  const c = await db.execute({ sql: 'SELECT * FROM clientes WHERE id = ?', args: [id] });
  if (!c.rows.length) throw new HttpErro(404, 'Cliente não encontrado.');
  const [e, o] = await Promise.all([
    db.execute({ sql: 'SELECT id, codigo, tipo, status, proxima_vistoria FROM extintores WHERE cliente_id = ? ORDER BY codigo LIMIT 50', args: [id] }),
    db.execute({ sql: 'SELECT numero, tipo, status, data FROM ordens_servico WHERE cliente_id = ? ORDER BY data DESC, id DESC LIMIT 10', args: [id] }),
  ]);
  res.json({ cliente: { ...c.rows[0], endereco_texto: enderecoTexto(c.rows[0]) }, extintores: linhas(e), ordens: linhas(o) });
}

const SELECT_OS = `SELECT o.id, o.numero, o.cliente_id, c.nome AS cliente, o.tipo, o.status, o.data, o.hora_inicio, o.hora_fim,
    o.descricao, o.ordem_rota, o.motorista_id, m.nome AS motorista, o.veiculo_id, v.placa AS veiculo,
    (SELECT GROUP_CONCAT(x.codigo, ', ') FROM os_extintores oe JOIN extintores x ON x.id = oe.extintor_id WHERE oe.os_id = o.id) AS extintores_codigos
  FROM ordens_servico o
  JOIN clientes c ON c.id = o.cliente_id
  LEFT JOIN usuarios m ON m.id = o.motorista_id
  LEFT JOIN veiculos v ON v.id = o.veiculo_id`;

async function listarOS(req, res) {
  const p = paginacao(req);
  const onde = [], args = [];
  const { q, status, tipo, data } = req.query;
  if (q) { onde.push('(o.numero LIKE ? OR c.nome LIKE ?)'); args.push(like(q), like(q)); }
  if (status) { onde.push('o.status = ?'); args.push(status); }
  if (tipo) { onde.push('o.tipo = ?'); args.push(tipo); }
  if (data) { onde.push('o.data = ?'); args.push(data); }
  const W = onde.length ? 'WHERE ' + onde.join(' AND ') : '';
  const [tot, r] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) AS n FROM ordens_servico o JOIN clientes c ON c.id = o.cliente_id ${W}`, args }),
    db.execute({ sql: `${SELECT_OS} ${W} ORDER BY o.data DESC, o.id DESC LIMIT ? OFFSET ?`, args: [...args, p.limit, p.offset] }),
  ]);
  res.json(resposta(linhas(r), Number(tot.rows[0].n), p));
}

async function opcoes(req, res) {
  const [c, m, v] = await Promise.all([
    db.execute('SELECT id, nome FROM clientes ORDER BY nome'),
    db.execute("SELECT id, nome FROM usuarios WHERE perfil = 'motorista' AND ativo = 1 ORDER BY nome"),
    db.execute('SELECT id, placa, modelo FROM veiculos ORDER BY placa'),
  ]);
  res.json({ clientes: linhas(c), motoristas: linhas(m), veiculos: linhas(v) });
}

/* ================= localização (endereço) do extintor ================= */
// Valida local + endereço. Com usar_endereco_cliente, o extintor fica sem endereço próprio.
function validaLocalizacao(b) {
  const local = texto(b.local, { nome: 'Local', max: 80 });
  const usar = b.usar_endereco_cliente === true || b.usar_endereco_cliente === 'true' || b.usar_endereco_cliente === 1;
  const vazio = { cep: null, endereco: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null };
  if (usar) return { local, ...vazio };
  const e = U.endereco(b);
  if (!e.endereco) throw new HttpErro(400, 'Informe o endereço do extintor ou marque “Usar o endereço fixo do cliente”.');
  if (!e.cidade) throw new HttpErro(400, 'Informe a cidade do endereço do extintor.');
  return { local, ...e };
}
const SQL_LOC = 'local=?, cep=?, endereco=?, numero=?, complemento=?, bairro=?, cidade=?, uf=?';
const argsLoc = (v) => [v.local, v.cep, v.endereco, v.numero, v.complemento, v.bairro, v.cidade, v.uf];

async function atualizarLocalizacao(req, res) {
  const id = inteiro(req.params.id, { nome: 'Extintor', obrig: true });
  if (!(await db.execute({ sql: 'SELECT 1 FROM extintores WHERE id = ?', args: [id] })).rows.length) throw new HttpErro(404, 'Extintor não encontrado.');
  const v = validaLocalizacao(req.body || {});
  await db.execute({ sql: `UPDATE extintores SET ${SQL_LOC} WHERE id = ?`, args: [...argsLoc(v), id] });
  res.json({ ok: true });
}

/* ================= fotos ================= */
function validaImagem(b) {
  const imagem = String(b.imagem || '');
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(imagem)) throw new HttpErro(400, 'Envie uma imagem JPG, PNG ou WebP.');
  if (imagem.length > 700000) throw new HttpErro(400, 'Imagem muito grande (máx. ~500 KB).');
  return imagem;
}
async function fotosDoExtintor(req, res) {
  const id = inteiro(req.params.id, { nome: 'Extintor', obrig: true });
  const r = await db.execute({
    sql: `SELECT f.id, f.data, f.descricao, f.imagem, f.operador_id, u.nome AS operador FROM fotos f
          LEFT JOIN usuarios u ON u.id = f.operador_id WHERE f.extintor_id = ? ORDER BY f.id DESC LIMIT 24`,
    args: [id],
  });
  res.json({ itens: linhas(r) });
}
async function novaFotoExtintor(req, res) {
  const id = inteiro(req.params.id, { nome: 'Extintor', obrig: true });
  if (!(await db.execute({ sql: 'SELECT 1 FROM extintores WHERE id = ?', args: [id] })).rows.length) throw new HttpErro(404, 'Extintor não encontrado.');
  const imagem = validaImagem(req.body || {});
  const descricao = texto((req.body || {}).descricao, { nome: 'Descrição', max: 200 });
  await db.execute({
    sql: 'INSERT INTO fotos(data, extintor_id, operador_id, descricao, imagem) VALUES (?,?,?,?,?)',
    args: [U.hojeISO(), id, req.user.id, descricao, imagem],
  });
  res.status(201).json({ ok: true });
}
// Gerente apaga qualquer foto; operador só as que ele enviou
async function excluirFoto(req, res) {
  const id = inteiro(req.params.id, { nome: 'Foto', obrig: true });
  const f = await db.execute({ sql: 'SELECT operador_id FROM fotos WHERE id = ?', args: [id] });
  if (!f.rows.length) throw new HttpErro(404, 'Foto não encontrada.');
  if (req.user.perfil !== 'gerente' && f.rows[0].operador_id !== req.user.id) throw new HttpErro(403, 'Você só pode excluir fotos que você enviou.');
  await db.execute({ sql: 'DELETE FROM fotos WHERE id = ?', args: [id] });
  res.json({ ok: true });
}

/* ================= criar extintor (gerente e operador) ================= */
// Cadastra o extintor e, se vier "imagem", já grava a primeira foto na mesma operação (batch = tudo ou nada).
async function criarExtintor(req, res) {
  const b = req.body || {};
  const TIPOS = ['PQS', 'CO2', 'Água'], STATUS = ['em_dia', 'em_atraso', 'inativo'];
  const cliente_id = inteiro(b.cliente_id, { nome: 'Cliente', obrig: true });
  if (!(await db.execute({ sql: 'SELECT 1 FROM clientes WHERE id = ?', args: [cliente_id] })).rows.length) throw new HttpErro(400, 'Cliente não encontrado.');
  const tipo = U.opcao(b.tipo, TIPOS, { nome: 'Tipo' });
  const status = U.opcao(b.status, STATUS, { nome: 'Status', padrao: 'em_dia' });
  const capacidade = texto(b.capacidade, { nome: 'Capacidade', max: 30 });
  const proxima = U.data(b.proxima_vistoria, { nome: 'Próxima vistoria' });
  const loc = validaLocalizacao(b);
  const imagem = b.imagem ? validaImagem(b) : null;
  let codigo = texto(b.codigo, { nome: 'Código', max: 20 });
  if (codigo) {
    codigo = codigo.toUpperCase();
    if (!/^[A-Z0-9-]{3,20}$/.test(codigo)) throw new HttpErro(400, 'Código inválido (use letras, números e hífen).');
  } else {
    const n = Number((await db.execute("SELECT MAX(CAST(SUBSTR(codigo, 5) AS INTEGER)) AS n FROM extintores WHERE codigo LIKE 'EXT-%'")).rows[0].n || 0);
    codigo = 'EXT-' + String(n + 1).padStart(3, '0');
  }
  if ((await db.execute({ sql: 'SELECT 1 FROM extintores WHERE codigo = ?', args: [codigo] })).rows.length) throw new HttpErro(409, 'Já existe um extintor com esse código.');
  const stmts = [{
    sql: 'INSERT INTO extintores(codigo, cliente_id, tipo, status, capacidade, proxima_vistoria, local, cep, endereco, numero, complemento, bairro, cidade, uf) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    args: [codigo, cliente_id, tipo, status, capacidade, proxima, ...argsLoc(loc)],
  }];
  if (imagem) stmts.push({
    sql: 'INSERT INTO fotos(data, extintor_id, operador_id, descricao, imagem) VALUES (?,(SELECT id FROM extintores WHERE codigo = ?),?,?,?)',
    args: [U.hojeISO(), codigo, req.user.id, texto(b.descricao_foto, { nome: 'Descrição', max: 200 }), imagem],
  });
  const rs = await db.batch(stmts, 'write');
  res.status(201).json({ id: Number(rs[0].lastInsertRowid), codigo });
}

/* ================= criar cliente (operador) ================= */
async function criarCliente(req, res) {
  const b = req.body || {};
  const nome = texto(b.nome, { nome: 'Nome', obrig: true, max: 100 });
  const email = texto(b.email, { nome: 'E-mail', max: 100 });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpErro(400, 'E-mail inválido.');
  if ((await db.execute({ sql: 'SELECT 1 FROM clientes WHERE LOWER(nome) = LOWER(?)', args: [nome] })).rows.length) throw new HttpErro(409, 'Já existe um cliente com esse nome.');
  const e = U.endereco(b);
  const x = await db.execute({
    sql: 'INSERT INTO clientes(nome, telefone, email, cep, endereco, numero, complemento, bairro, cidade, uf) VALUES (?,?,?,?,?,?,?,?,?,?)',
    args: [nome, texto(b.telefone, { nome: 'Telefone', max: 30 }), email, e.cep, e.endereco, e.numero, e.complemento, e.bairro, e.cidade, e.uf],
  });
  res.status(201).json({ id: Number(x.lastInsertRowid), nome });
}

module.exports = {
  criarCliente,
  criarExtintor,
  listarExtintores, detalheExtintor, listarClientes, detalheCliente, listarOS, opcoes, SELECT_OS,
  validaLocalizacao, SQL_LOC, argsLoc, atualizarLocalizacao, validaImagem, fotosDoExtintor, novaFotoExtintor, excluirFoto,
};
