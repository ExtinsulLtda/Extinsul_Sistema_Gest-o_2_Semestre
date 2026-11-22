// API do MOTORISTA: rota do dia, ordens de serviço, comprovantes, clientes e veículo
const express = require('express');
const db = require('./db');
const U = require('./util');
const S = require('./shared');
const { exige } = require('./auth');

const { wrap, HttpErro, linhas, texto, inteiro, data, opcao, hojeISO, paginacao, resposta, like } = U;
const r = express.Router();
r.use(exige('motorista'));

const contar = async (sql, args) => Number((await db.execute({ sql, args })).rows[0].n);
const hhmm = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

const SELECT_ROTA = `SELECT o.id, o.numero, c.nome AS cliente, c.telefone, ${U.COLS_END_CLIENTE}, o.tipo, o.status, o.data,
    o.hora_inicio, o.hora_fim, o.descricao, o.ordem_rota,
    (SELECT cp.id FROM comprovantes cp WHERE cp.os_id = o.id) AS comprovante_id
  FROM ordens_servico o JOIN clientes c ON c.id = o.cliente_id`;

// Rota de um dia: OS da data + (se for hoje) pendências de dias anteriores
async function rota(userId, dia) {
  const hoje = hojeISO();
  const x = await db.execute({
    sql: `${SELECT_ROTA} WHERE o.motorista_id = ? AND (o.data = ? OR (? = ? AND o.data < ? AND o.status != 'concluida'))
          ORDER BY o.data, COALESCE(o.ordem_rota, 99), o.hora_inicio`,
    args: [userId, dia, dia, hoje, hoje],
  });
  return anexaDestinos(linhas(x));
}
/*
 * DESTINOS da OS (base para as rotas de entrega, a implementar):
 * - se a OS tem extintores vinculados, o destino é o endereço de cada extintor (o dele, ou o fixo do cliente);
 * - senão, o destino é o endereço fixo do cliente.
 * Cada destino traz o texto do endereço, pronto para virar link de rota (Google Maps / Waze) no front-end.
 */
async function anexaDestinos(itens) {
  if (!itens.length) return itens;
  const ids = itens.map((o) => o.id);
  const r = await db.execute({
    sql: `SELECT oe.os_id, e.codigo, e.cep, e.endereco, e.numero, e.complemento, e.bairro, e.cidade, e.uf, ${U.COLS_END_CLIENTE}
          FROM os_extintores oe JOIN extintores e ON e.id = oe.extintor_id JOIN clientes c ON c.id = e.cliente_id
          WHERE oe.os_id IN (${ids.map(() => '?').join(',')}) ORDER BY e.codigo`,
    args: ids,
  });
  const porOS = new Map();
  linhas(r).forEach((x) => {
    const e = U.enderecoExtintor({ ...x });
    if (!e.endereco_texto) return;
    const lista = porOS.get(x.os_id) || [];
    const ja = lista.find((d) => d.endereco_texto === e.endereco_texto);
    if (ja) ja.extintores.push(x.codigo); else lista.push({ endereco_texto: e.endereco_texto, extintores: [x.codigo], origem: e.endereco_proprio ? 'extintor' : 'cliente' });
    porOS.set(x.os_id, lista);
  });
  itens.forEach((o) => {
    const doCliente = U.enderecoTexto(U.doCliente(o));
    o.endereco_texto = doCliente;                       // endereço fixo do cliente
    o.destinos = porOS.get(o.id) || (doCliente ? [{ endereco_texto: doCliente, extintores: [], origem: 'cliente' }] : []);
    U.limpaPrefixo(o);
  });
  return itens;
}

async function minhaOS(req) {
  const id = inteiro(req.params.id, { obrig: true, nome: 'OS' });
  const o = await db.execute({ sql: 'SELECT id, status, numero FROM ordens_servico WHERE id = ? AND motorista_id = ?', args: [id, req.user.id] });
  if (!o.rows.length) throw new HttpErro(404, 'Ordem de serviço não encontrada para você.');
  return { ...o.rows[0] };
}
async function veiculoDo(userId) {
  const v = await db.execute({ sql: 'SELECT id, placa, modelo, ano, km_atual, status FROM veiculos WHERE motorista_id = ? LIMIT 1', args: [userId] });
  return v.rows[0] ? { ...v.rows[0] } : null;
}

/* ================= PAINEL / ROTA ================= */
r.get('/dashboard', wrap(async (req, res) => {
  const hoje = hojeISO();
  const itens = await rota(req.user.id, hoje);
  const concluidasHoje = await contar('SELECT COUNT(*) AS n FROM comprovantes WHERE motorista_id = ? AND data = ?', [req.user.id, hoje]);
  res.json({
    rota: itens, clientes: new Set(itens.map((x) => x.cliente)).size,
    concluidas_hoje: concluidasHoje, veiculo: await veiculoDo(req.user.id),
  });
}));
r.get('/rota', wrap(async (req, res) => {
  const dia = data(req.query.data, { nome: 'Data' }) || hojeISO();
  res.json({ data: dia, itens: await rota(req.user.id, dia) });
}));

/* ================= ORDENS DE SERVIÇO ================= */
r.get('/os', wrap(async (req, res) => {
  const p = paginacao(req);
  const onde = ['o.motorista_id = ?'], args = [req.user.id];
  if (req.query.status) { onde.push('o.status = ?'); args.push(req.query.status); }
  if (req.query.q) { onde.push('(o.numero LIKE ? OR c.nome LIKE ?)'); args.push(like(req.query.q), like(req.query.q)); }
  const W = 'WHERE ' + onde.join(' AND ');
  const [tot, x] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) AS n FROM ordens_servico o JOIN clientes c ON c.id = o.cliente_id ${W}`, args }),
    db.execute({ sql: `${SELECT_ROTA} ${W} ORDER BY o.data DESC, o.id DESC LIMIT ? OFFSET ?`, args: [...args, p.limit, p.offset] }),
  ]);
  res.json(resposta(await anexaDestinos(linhas(x)), Number(tot.rows[0].n), p));
}));
r.put('/os/:id/iniciar', wrap(async (req, res) => {
  const o = await minhaOS(req);
  if (o.status !== 'pendente') throw new HttpErro(409, 'Só é possível iniciar uma OS pendente.');
  await db.execute({ sql: "UPDATE ordens_servico SET status = 'em_andamento' WHERE id = ?", args: [o.id] });
  res.json({ ok: true });
}));
// Entrega: registra o comprovante e conclui a OS
r.post('/os/:id/entregar', wrap(async (req, res) => {
  const o = await minhaOS(req);
  if (o.status === 'concluida') throw new HttpErro(409, 'Essa OS já foi concluída.');
  const b = req.body || {};
  const recebedor = texto(b.recebedor, { nome: 'Nome de quem recebeu', obrig: true, max: 100 });
  const documento = texto(b.documento, { nome: 'Documento', max: 30 });
  const observacao = texto(b.observacao, { nome: 'Observação', max: 300 });
  await db.batch([
    { sql: 'INSERT INTO comprovantes(os_id, motorista_id, data, hora, recebedor, documento, observacao) VALUES (?,?,?,?,?,?,?)', args: [o.id, req.user.id, hojeISO(), hhmm(), recebedor, documento, observacao] },
    { sql: "UPDATE ordens_servico SET status = 'concluida', hora_fim = ? WHERE id = ?", args: [hhmm(), o.id] },   // hora da entrega = hora em que o motorista confirmou
  ], 'write');
  res.status(201).json({ ok: true });
}));

/* ================= COMPROVANTES ================= */
r.get('/comprovantes', wrap(async (req, res) => {
  const p = paginacao(req);
  const args = [req.user.id]; let extra = '';
  if (req.query.q) { extra = ' AND (o.numero LIKE ? OR c.nome LIKE ? OR cp.recebedor LIKE ?)'; args.push(like(req.query.q), like(req.query.q), like(req.query.q)); }
  const base = `FROM comprovantes cp JOIN ordens_servico o ON o.id = cp.os_id JOIN clientes c ON c.id = o.cliente_id
                WHERE cp.motorista_id = ?${extra}`;
  const [tot, x] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) AS n ${base}`, args }),
    db.execute({
      sql: `SELECT cp.id, cp.data, cp.hora, cp.recebedor, cp.documento, cp.observacao, o.numero, o.tipo,
              c.nome AS cliente, ${U.COLS_END_CLIENTE} ${base} ORDER BY cp.id DESC LIMIT ? OFFSET ?`,
      args: [...args, p.limit, p.offset],
    }),
  ]);
  res.json(resposta(linhas(x).map((c) => { const t = U.enderecoTexto(U.doCliente(c)); return { ...U.limpaPrefixo(c), endereco_texto: t }; }), Number(tot.rows[0].n), p));
}));

/* ================= CLIENTES ================= */
r.get('/clientes', wrap(async (req, res) => {
  const args = [req.user.id]; let extra = '';
  if (req.query.q) { extra = ' AND (c.nome LIKE ? OR c.cidade LIKE ?)'; args.push(like(req.query.q), like(req.query.q)); }
  const x = linhas(await db.execute({
    sql: `SELECT c.id, c.nome, c.telefone, c.cep, c.endereco, c.numero, c.complemento, c.bairro, c.cidade, c.uf,
            COUNT(o.id) AS os_total,
            SUM(CASE WHEN o.status != 'concluida' THEN 1 ELSE 0 END) AS os_abertas
          FROM clientes c JOIN ordens_servico o ON o.cliente_id = c.id
          WHERE o.motorista_id = ?${extra} GROUP BY c.id ORDER BY c.nome`, args,
  })).map((c) => ({ ...c, endereco_texto: U.enderecoTexto(c) }));
  res.json({ itens: x, total: x.length, page: 1, paginas: 1 });
}));

/* ================= VEÍCULO ================= */
r.get('/veiculo', wrap(async (req, res) => res.json({ veiculo: await veiculoDo(req.user.id) })));
r.put('/veiculo', wrap(async (req, res) => {
  const v = await veiculoDo(req.user.id);
  if (!v) throw new HttpErro(404, 'Nenhum veículo está atribuído a você.');
  const km = inteiro((req.body || {}).km_atual, { nome: 'Quilometragem', obrig: true, min: 0, max: 5000000 });
  if (km < v.km_atual) throw new HttpErro(400, `A quilometragem não pode ser menor que a atual (${v.km_atual} km).`);
  const status = opcao((req.body || {}).status, ['disponivel', 'em_uso', 'manutencao'], { nome: 'Status' });
  await db.execute({ sql: 'UPDATE veiculos SET km_atual = ?, status = ? WHERE id = ?', args: [km, status, v.id] });
  res.json({ ok: true });
}));

module.exports = r;
