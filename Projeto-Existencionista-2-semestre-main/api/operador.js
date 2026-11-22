// API do OPERADOR: vistorias, manutenções, fotos e consulta de extintores, clientes e OS
const express = require('express');
const db = require('./db');
const U = require('./util');
const S = require('./shared');
const { exige } = require('./auth');

const { wrap, HttpErro, linhas, texto, inteiro, decimal, opcao, hojeISO, somaDias, paginacao, resposta, like } = U;
const r = express.Router();
r.use(exige('operador'));

const TIPOS_MANUT = ['Recarga', 'Manutenção', 'Teste hidrostático', 'Troca de peça'];
const contar = async (sql, args) => Number((await db.execute({ sql, args })).rows[0].n);

async function extintorPorCodigo(codigo) {
  const c = texto(codigo, { nome: 'Código do extintor', obrig: true, max: 20 }).toUpperCase();
  const e = await db.execute({ sql: "SELECT id, status FROM extintores WHERE codigo = ?", args: [c] });
  if (!e.rows.length) throw new HttpErro(404, `Extintor ${c} não encontrado.`);
  return { id: e.rows[0].id, status: e.rows[0].status, codigo: c };
}

/* ================= PAINEL ================= */
r.get('/dashboard', wrap(async (req, res) => {
  await U.atualizaAtrasos();
  const hoje = hojeISO();
  const [ext, vist, nc, k] = await Promise.all([
    db.execute(`SELECT e.id, e.codigo, c.nome AS cliente, e.tipo, e.status, e.proxima_vistoria FROM extintores e
                JOIN clientes c ON c.id = e.cliente_id WHERE e.status != 'inativo'
                ORDER BY e.proxima_vistoria ASC LIMIT 5`),
    db.execute(`SELECT v.data, e.codigo, c.nome AS cliente, v.resultado FROM vistorias v
                JOIN extintores e ON e.id = v.extintor_id JOIN clientes c ON c.id = e.cliente_id
                ORDER BY v.data DESC, v.id DESC LIMIT 5`),
    db.execute(`SELECT e.codigo FROM vistorias v JOIN extintores e ON e.id = v.extintor_id
                WHERE v.resultado = 'nao_conforme' AND e.status != 'em_dia' ORDER BY v.data DESC, v.id DESC LIMIT 1`),
    Promise.all([
      contar("SELECT COUNT(*) AS n FROM extintores WHERE status = 'em_atraso'", []),
      contar('SELECT COUNT(*) AS n FROM vistorias WHERE data = ?', [hoje]),
      contar('SELECT COUNT(*) AS n FROM manutencoes WHERE data >= ?', [hoje.slice(0, 8) + '01']),
      contar("SELECT COUNT(*) AS n FROM ordens_servico WHERE status != 'concluida'", []),
    ]),
  ]);
  res.json({
    extintores: linhas(ext), vistorias: linhas(vist), alerta: nc.rows[0] ? nc.rows[0].codigo : null,
    atrasados: k[0], vistorias_hoje: k[1], manutencoes_mes: k[2], os_abertas: k[3],
  });
}));

/* ================= CONSULTAS ================= */
r.get('/opcoes', wrap(S.opcoes));
r.get('/extintores', wrap(S.listarExtintores));
r.post('/extintores', wrap(S.criarExtintor));
r.get('/extintores/:id', wrap(S.detalheExtintor));
// O operador está em campo: ajusta onde o extintor está (local + endereço) e envia fotos dele
r.put('/extintores/:id/localizacao', wrap(S.atualizarLocalizacao));
r.get('/extintores/:id/fotos', wrap(S.fotosDoExtintor));
r.post('/extintores/:id/fotos', wrap(S.novaFotoExtintor));
r.get('/clientes', wrap(S.listarClientes));
r.post('/clientes', wrap(S.criarCliente));
r.get('/clientes/:id', wrap(S.detalheCliente));
r.get('/os', wrap(S.listarOS));
r.put('/os/:id/status', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'OS' });
  const status = opcao((req.body || {}).status, ['pendente', 'em_andamento', 'concluida'], { nome: 'Status' });
  if (!(await contar('SELECT COUNT(*) AS n FROM ordens_servico WHERE id = ?', [id]))) throw new HttpErro(404, 'Ordem de serviço não encontrada.');
  await db.execute({ sql: 'UPDATE ordens_servico SET status = ? WHERE id = ?', args: [status, id] });
  res.json({ ok: true });
}));

/* ================= VISTORIAS ================= */
r.get('/vistorias', wrap(async (req, res) => {
  const p = paginacao(req);
  const onde = [], args = [];
  if (req.query.q) { onde.push('(e.codigo LIKE ? OR c.nome LIKE ?)'); args.push(like(req.query.q), like(req.query.q)); }
  if (req.query.resultado) { onde.push('v.resultado = ?'); args.push(req.query.resultado); }
  const W = onde.length ? 'WHERE ' + onde.join(' AND ') : '';
  const base = `FROM vistorias v JOIN extintores e ON e.id = v.extintor_id JOIN clientes c ON c.id = e.cliente_id
                LEFT JOIN usuarios u ON u.id = v.operador_id ${W}`;
  const [tot, x] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) AS n ${base}`, args }),
    db.execute({
      sql: `SELECT v.id, v.data, e.codigo, c.nome AS cliente, u.nome AS operador, v.resultado, v.observacao ${base}
            ORDER BY v.data DESC, v.id DESC LIMIT ? OFFSET ?`,
      args: [...args, p.limit, p.offset],
    }),
  ]);
  res.json(resposta(linhas(x), Number(tot.rows[0].n), p));
}));
r.post('/vistorias', wrap(async (req, res) => {
  const b = req.body || {};
  const e = await extintorPorCodigo(b.codigo);
  const resultado = opcao(b.resultado, ['conforme', 'nao_conforme'], { nome: 'Resultado' });
  const obs = texto(b.observacao, { nome: 'Observação', max: 300 });
  if (resultado === 'nao_conforme' && !obs) throw new HttpErro(400, 'Descreva o problema encontrado.');
  const cfg = await U.getConfig();
  const ok = resultado === 'conforme';
  await db.batch([
    { sql: 'INSERT INTO vistorias(data, extintor_id, operador_id, resultado, observacao) VALUES (?,?,?,?,?)', args: [hojeISO(), e.id, req.user.id, resultado, obs] },
    {
      sql: 'UPDATE extintores SET status = ?, proxima_vistoria = ? WHERE id = ? AND status != ?',
      args: [ok ? 'em_dia' : 'em_atraso', ok ? somaDias(Number(cfg.intervalo_vistoria_dias)) : hojeISO(), e.id, 'inativo'],
    },
  ], 'write');
  res.status(201).json({ ok: true });
}));

/* ================= MANUTENÇÕES ================= */
r.get('/manutencoes', wrap(async (req, res) => {
  const p = paginacao(req);
  const onde = [], args = [];
  if (req.query.q) { onde.push('(e.codigo LIKE ? OR c.nome LIKE ?)'); args.push(like(req.query.q), like(req.query.q)); }
  if (req.query.tipo) { onde.push('m.tipo = ?'); args.push(req.query.tipo); }
  const W = onde.length ? 'WHERE ' + onde.join(' AND ') : '';
  const base = `FROM manutencoes m JOIN extintores e ON e.id = m.extintor_id JOIN clientes c ON c.id = e.cliente_id
                LEFT JOIN usuarios u ON u.id = m.operador_id ${W}`;
  const [tot, x] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) AS n ${base}`, args }),
    db.execute({
      sql: `SELECT m.id, m.data, e.codigo, c.nome AS cliente, m.tipo, m.descricao, m.custo, u.nome AS operador ${base}
            ORDER BY m.data DESC, m.id DESC LIMIT ? OFFSET ?`,
      args: [...args, p.limit, p.offset],
    }),
  ]);
  res.json(resposta(linhas(x), Number(tot.rows[0].n), p));
}));
r.post('/manutencoes', wrap(async (req, res) => {
  const b = req.body || {};
  const e = await extintorPorCodigo(b.codigo);
  const tipo = opcao(b.tipo, TIPOS_MANUT, { nome: 'Tipo' });
  const descricao = texto(b.descricao, { nome: 'Descrição', max: 300 });
  const custo = decimal(b.custo, { nome: 'Custo', max: 1e6 });
  const cfg = await U.getConfig();
  await db.batch([
    { sql: 'INSERT INTO manutencoes(data, extintor_id, operador_id, tipo, descricao, custo) VALUES (?,?,?,?,?,?)', args: [hojeISO(), e.id, req.user.id, tipo, descricao, custo] },
    // extintor consertado/recarregado volta a ficar em dia
    { sql: "UPDATE extintores SET status = 'em_dia', proxima_vistoria = ? WHERE id = ? AND status != 'inativo'", args: [somaDias(Number(cfg.intervalo_vistoria_dias)), e.id] },
  ], 'write');
  res.status(201).json({ ok: true });
}));

/* ================= FOTOS ================= */
r.get('/fotos', wrap(async (req, res) => {
  const p = paginacao(req, 12);
  const [tot, x] = await Promise.all([
    db.execute('SELECT COUNT(*) AS n FROM fotos'),
    db.execute({
      sql: `SELECT f.id, f.data, f.descricao, f.imagem, f.operador_id, e.codigo, o.numero AS os, u.nome AS operador
            FROM fotos f LEFT JOIN extintores e ON e.id = f.extintor_id LEFT JOIN ordens_servico o ON o.id = f.os_id
            LEFT JOIN usuarios u ON u.id = f.operador_id ORDER BY f.id DESC LIMIT ? OFFSET ?`,
      args: [p.limit, p.offset],
    }),
  ]);
  res.json(resposta(linhas(x), Number(tot.rows[0].n), p));
}));
r.post('/fotos', wrap(async (req, res) => {
  const b = req.body || {};
  const imagem = S.validaImagem(b);
  const descricao = texto(b.descricao, { nome: 'Descrição', max: 200 });
  let extintor_id = null, os_id = null;
  if (b.codigo) extintor_id = (await extintorPorCodigo(b.codigo)).id;
  if (b.os) {
    const o = await db.execute({ sql: 'SELECT id FROM ordens_servico WHERE numero = ?', args: [String(b.os).toUpperCase()] });
    if (!o.rows.length) throw new HttpErro(404, 'Ordem de serviço não encontrada.');
    os_id = o.rows[0].id;
  }
  await db.execute({
    sql: 'INSERT INTO fotos(data, extintor_id, os_id, operador_id, descricao, imagem) VALUES (?,?,?,?,?,?)',
    args: [hojeISO(), extintor_id, os_id, req.user.id, descricao, imagem],
  });
  res.status(201).json({ ok: true });
}));
r.delete('/fotos/:id', wrap(S.excluirFoto));

module.exports = r;
