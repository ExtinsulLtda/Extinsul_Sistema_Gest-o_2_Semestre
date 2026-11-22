// API do GERENTE: painel, cadastros completos, relatórios, funcionários, veículos e configurações
const express = require('express');
const db = require('./db');
const U = require('./util');
const S = require('./shared');
const { exige, hashPin, cifraPin, decifraPin, pinEmUso, PIN_REGEX } = require('./auth');

const { wrap, HttpErro, linhas, texto, inteiro, decimal, data, hora, opcao, hojeISO, somaDias, paginacao, resposta, like } = U;
const r = express.Router();
r.use(exige('gerente'));

const TIPOS_EXT = ['PQS', 'CO2', 'Água'];
const STATUS_EXT = ['em_dia', 'em_atraso', 'inativo'];
const TIPOS_OS = ['Recarga', 'Manutenção', 'Vistoria'];
const STATUS_OS = ['pendente', 'em_andamento', 'concluida'];
const PERFIS = ['gerente', 'operador', 'motorista'];
const STATUS_VEIC = ['disponivel', 'em_uso', 'manutencao'];

const existe = async (tabela, id) => (await db.execute({ sql: `SELECT 1 FROM ${tabela} WHERE id = ?`, args: [id] })).rows.length > 0;
const contar = async (sql, args) => Number((await db.execute({ sql, args })).rows[0].n);

/* ================= PAINEL ================= */
r.get('/dashboard', wrap(async (req, res) => {
  await U.atualizaAtrasos();
  const cfg = await U.getConfig();
  const dias = Number(cfg.dias_alerta) || 7;
  const hoje = hojeISO(), ate = somaDias(dias);
  const [tot, prox, osr, venc, osab] = await Promise.all([
    db.execute('SELECT status, COUNT(*) AS n FROM extintores GROUP BY status'),
    db.execute({ sql: "SELECT COUNT(*) AS n FROM extintores WHERE status='em_dia' AND proxima_vistoria BETWEEN ? AND ?", args: [hoje, ate] }),
    db.execute(`${S.SELECT_OS} ORDER BY o.data DESC, o.id DESC LIMIT 5`),
    db.execute({
      sql: `SELECT e.codigo, c.nome AS cliente, e.proxima_vistoria AS data FROM extintores e
            JOIN clientes c ON c.id = e.cliente_id
            WHERE e.status != 'inativo' AND e.proxima_vistoria BETWEEN ? AND ? ORDER BY e.proxima_vistoria, e.codigo LIMIT 8`,
      args: [hoje, ate],
    }),
    db.execute("SELECT COUNT(*) AS n FROM ordens_servico WHERE status != 'concluida'"),
  ]);
  const cont = { em_dia: 0, em_atraso: 0, inativo: 0 };
  tot.rows.forEach((x) => { cont[x.status] = Number(x.n); });
  res.json({
    total: cont.em_dia + cont.em_atraso + cont.inativo, ...cont,
    proximas_vistorias: Number(prox.rows[0].n),
    os_abertas: Number(osab.rows[0].n),
    ordens_recentes: linhas(osr), vencimentos: linhas(venc), dias,
  });
}));

r.get('/opcoes', wrap(S.opcoes));

/* ================= EXTINTORES ================= */
async function validaExtintor(b) {
  const cliente_id = inteiro(b.cliente_id, { nome: 'Cliente', obrig: true });
  if (!(await existe('clientes', cliente_id))) throw new HttpErro(400, 'Cliente não encontrado.');
  return {
    cliente_id,
    tipo: opcao(b.tipo, TIPOS_EXT, { nome: 'Tipo' }),
    status: opcao(b.status, STATUS_EXT, { nome: 'Status', padrao: 'em_dia' }),
    capacidade: texto(b.capacidade, { nome: 'Capacidade', max: 30 }),
    proxima_vistoria: data(b.proxima_vistoria, { nome: 'Próxima vistoria' }),
    loc: S.validaLocalizacao(b),          // local + endereço do extintor
  };
}
r.get('/extintores', wrap(S.listarExtintores));
r.get('/extintores/:id', wrap(S.detalheExtintor));
r.put('/extintores/:id/localizacao', wrap(S.atualizarLocalizacao));
r.get('/extintores/:id/fotos', wrap(S.fotosDoExtintor));
r.post('/extintores/:id/fotos', wrap(S.novaFotoExtintor));
r.delete('/fotos/:id', wrap(S.excluirFoto));
r.post('/extintores', wrap(S.criarExtintor));
r.put('/extintores/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Extintor' });
  if (!(await existe('extintores', id))) throw new HttpErro(404, 'Extintor não encontrado.');
  const v = await validaExtintor(req.body || {});
  await db.execute({
    sql: `UPDATE extintores SET cliente_id=?, tipo=?, status=?, capacidade=?, proxima_vistoria=?, ${S.SQL_LOC} WHERE id=?`,
    args: [v.cliente_id, v.tipo, v.status, v.capacidade, v.proxima_vistoria, ...S.argsLoc(v.loc), id],
  });
  res.json({ ok: true });
}));
r.delete('/extintores/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Extintor' });
  if (!(await existe('extintores', id))) throw new HttpErro(404, 'Extintor não encontrado.');
  // exclui o extintor e todo o histórico dele (tudo ou nada)
  await db.batch([
    { sql: 'DELETE FROM fotos WHERE extintor_id = ?', args: [id] },
    { sql: 'DELETE FROM manutencoes WHERE extintor_id = ?', args: [id] },
    { sql: 'DELETE FROM vistorias WHERE extintor_id = ?', args: [id] },
    { sql: 'DELETE FROM os_extintores WHERE extintor_id = ?', args: [id] },
    { sql: 'DELETE FROM extintores WHERE id = ?', args: [id] },
  ], 'write');
  res.json({ ok: true });
}));

/* ================= CLIENTES ================= */
async function validaCliente(b, idAtual = null) {
  const nome = texto(b.nome, { nome: 'Nome', obrig: true, max: 100 });
  const email = texto(b.email, { nome: 'E-mail', max: 100 });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpErro(400, 'E-mail inválido.');
  const dup = await db.execute({ sql: 'SELECT id FROM clientes WHERE LOWER(nome) = LOWER(?)', args: [nome] });
  if (dup.rows.some((x) => x.id !== idAtual)) throw new HttpErro(409, 'Já existe um cliente com esse nome.');
  return { nome, email, telefone: texto(b.telefone, { nome: 'Telefone', max: 30 }), ...U.endereco(b) };
}
r.get('/clientes', wrap(S.listarClientes));
r.get('/clientes/:id', wrap(S.detalheCliente));
r.post('/clientes', wrap(async (req, res) => {
  const v = await validaCliente(req.body || {});
  const x = await db.execute({
    sql: 'INSERT INTO clientes(nome, telefone, email, cep, endereco, numero, complemento, bairro, cidade, uf) VALUES (?,?,?,?,?,?,?,?,?,?)',
    args: [v.nome, v.telefone, v.email, v.cep, v.endereco, v.numero, v.complemento, v.bairro, v.cidade, v.uf],
  });
  res.status(201).json({ id: Number(x.lastInsertRowid) });
}));
r.put('/clientes/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Cliente' });
  if (!(await existe('clientes', id))) throw new HttpErro(404, 'Cliente não encontrado.');
  const v = await validaCliente(req.body || {}, id);
  await db.execute({
    sql: 'UPDATE clientes SET nome=?, telefone=?, email=?, cep=?, endereco=?, numero=?, complemento=?, bairro=?, cidade=?, uf=? WHERE id=?',
    args: [v.nome, v.telefone, v.email, v.cep, v.endereco, v.numero, v.complemento, v.bairro, v.cidade, v.uf, id],
  });
  res.json({ ok: true });
}));
r.delete('/clientes/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Cliente' });
  if (!(await existe('clientes', id))) throw new HttpErro(404, 'Cliente não encontrado.');
  // exclui o cliente com seus extintores (e históricos), ordens de serviço (e comprovantes) e vencimentos (tudo ou nada)
  const EXT = '(SELECT id FROM extintores WHERE cliente_id = ?)', OSS = '(SELECT id FROM ordens_servico WHERE cliente_id = ?)';
  await db.batch([
    { sql: `DELETE FROM fotos WHERE extintor_id IN ${EXT} OR os_id IN ${OSS}`, args: [id, id] },
    { sql: `DELETE FROM manutencoes WHERE extintor_id IN ${EXT}`, args: [id] },
    { sql: `DELETE FROM vistorias WHERE extintor_id IN ${EXT}`, args: [id] },
    { sql: `DELETE FROM os_extintores WHERE extintor_id IN ${EXT} OR os_id IN ${OSS}`, args: [id, id] },
    { sql: `DELETE FROM comprovantes WHERE os_id IN ${OSS}`, args: [id] },
    { sql: 'DELETE FROM ordens_servico WHERE cliente_id = ?', args: [id] },
    { sql: 'DELETE FROM extintores WHERE cliente_id = ?', args: [id] },
    { sql: 'DELETE FROM vencimentos WHERE cliente_id = ?', args: [id] },
    { sql: 'DELETE FROM clientes WHERE id = ?', args: [id] },
  ], 'write');
  res.json({ ok: true });
}));

/* ================= ORDENS DE SERVIÇO ================= */
async function validaOS(b) {
  const cliente_id = inteiro(b.cliente_id, { nome: 'Cliente', obrig: true });
  if (!(await existe('clientes', cliente_id))) throw new HttpErro(400, 'Cliente não encontrado.');
  const motorista_id = inteiro(b.motorista_id, { nome: 'Motorista' });
  if (motorista_id && !(await contar("SELECT COUNT(*) AS n FROM usuarios WHERE id = ? AND perfil = 'motorista'", [motorista_id]))) {
    throw new HttpErro(400, 'Motorista não encontrado.');
  }
  const veiculo_id = inteiro(b.veiculo_id, { nome: 'Veículo' });
  if (veiculo_id && !(await existe('veiculos', veiculo_id))) throw new HttpErro(400, 'Veículo não encontrado.');
  const hora_inicio = hora(b.hora_inicio, { nome: 'Hora inicial' });
  const hora_fim = hora(b.hora_fim, { nome: 'Hora final' });
  if (hora_inicio && hora_fim && hora_fim < hora_inicio) throw new HttpErro(400, 'A hora final deve ser depois da inicial.');
  return {
    cliente_id, motorista_id, veiculo_id, hora_inicio, hora_fim,
    tipo: opcao(b.tipo, TIPOS_OS, { nome: 'Tipo' }),
    status: opcao(b.status, STATUS_OS, { nome: 'Status', padrao: 'pendente' }),
    data: data(b.data, { nome: 'Data', obrig: true }),
    descricao: texto(b.descricao, { nome: 'Descrição', max: 300 }),
    ordem_rota: inteiro(b.ordem_rota, { nome: 'Ordem na rota', min: 1, max: 99 }),
  };
}
// Extintores atendidos pela OS (códigos separados por vírgula). Devem ser do mesmo cliente da OS.
async function idsExtintores(valor, clienteId) {
  const codigos = [...new Set(String(valor || '').split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const ids = [];
  for (const c of codigos) {
    const x = await db.execute({ sql: 'SELECT id, cliente_id FROM extintores WHERE codigo = ?', args: [c] });
    if (!x.rows.length) throw new HttpErro(400, `Extintor ${c} não encontrado.`);
    if (x.rows[0].cliente_id !== clienteId) throw new HttpErro(400, `O extintor ${c} pertence a outro cliente.`);
    ids.push(x.rows[0].id);
  }
  return ids;
}
const vincula = (osId, ids) => db.batch([
  { sql: 'DELETE FROM os_extintores WHERE os_id = ?', args: [osId] },
  ...ids.map((e) => ({ sql: 'INSERT INTO os_extintores(os_id, extintor_id) VALUES (?, ?)', args: [osId, e] })),
], 'write');

r.get('/os', wrap(S.listarOS));
r.post('/os', wrap(async (req, res) => {
  const v = await validaOS(req.body || {});
  const ids = await idsExtintores((req.body || {}).extintores, v.cliente_id);
  const n = Number((await db.execute("SELECT MAX(CAST(SUBSTR(numero, 4) AS INTEGER)) AS n FROM ordens_servico WHERE numero LIKE 'OS-%'")).rows[0].n || 0);
  const numero = 'OS-' + String(n + 1).padStart(4, '0');
  if (!v.ordem_rota && v.motorista_id) {
    v.ordem_rota = (await contar('SELECT COUNT(*) AS n FROM ordens_servico WHERE motorista_id = ? AND data = ?', [v.motorista_id, v.data])) + 1;
  }
  const x = await db.execute({
    sql: `INSERT INTO ordens_servico(numero, cliente_id, tipo, status, data, hora_inicio, hora_fim, motorista_id, ordem_rota, descricao, veiculo_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [numero, v.cliente_id, v.tipo, v.status, v.data, v.hora_inicio, v.hora_fim, v.motorista_id, v.ordem_rota, v.descricao, v.veiculo_id],
  });
  await vincula(Number(x.lastInsertRowid), ids);
  res.status(201).json({ id: Number(x.lastInsertRowid), numero });
}));
r.put('/os/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'OS' });
  if (!(await existe('ordens_servico', id))) throw new HttpErro(404, 'Ordem de serviço não encontrada.');
  const v = await validaOS(req.body || {});
  const ids = await idsExtintores((req.body || {}).extintores, v.cliente_id);
  await db.execute({
    sql: `UPDATE ordens_servico SET cliente_id=?, tipo=?, status=?, data=?, hora_inicio=?, hora_fim=?, motorista_id=?, ordem_rota=?, descricao=?, veiculo_id=? WHERE id=?`,
    args: [v.cliente_id, v.tipo, v.status, v.data, v.hora_inicio, v.hora_fim, v.motorista_id, v.ordem_rota, v.descricao, v.veiculo_id, id],
  });
  await vincula(id, ids);
  res.json({ ok: true });
}));
r.delete('/os/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'OS' });
  if (!(await existe('ordens_servico', id))) throw new HttpErro(404, 'Ordem de serviço não encontrada.');
  await db.batch([
    { sql: 'DELETE FROM comprovantes WHERE os_id = ?', args: [id] },
    { sql: 'DELETE FROM os_extintores WHERE os_id = ?', args: [id] },
    { sql: 'UPDATE fotos SET os_id = NULL WHERE os_id = ?', args: [id] },
    { sql: 'DELETE FROM ordens_servico WHERE id = ?', args: [id] },
  ], 'write');
  res.json({ ok: true });
}));

/* ================= RELATÓRIOS ================= */
const NOME_STATUS = { em_dia: 'Em dia', em_atraso: 'Em atraso', inativo: 'Inativo', pendente: 'Pendente', em_andamento: 'Em andamento', concluida: 'Concluída', conforme: 'Conforme', nao_conforme: 'Não conforme' };
const fd = (s) => (s ? s.split('-').reverse().join('/') : '');
const nm = (s) => NOME_STATUS[s] || s || '';

r.get('/relatorios/:tipo', wrap(async (req, res) => {
  const hoje = hojeISO();
  const de = data(req.query.de, { nome: 'Data inicial' }) || somaDias(-30);
  const ate = data(req.query.ate, { nome: 'Data final' }) || hoje;
  const tipo = req.params.tipo;
  let out;
  if (tipo === 'extintores') {
    await U.atualizaAtrasos();
    const args = []; let W = '';
    if (req.query.status) { W = 'WHERE e.status = ?'; args.push(req.query.status); }
    const x = linhas(await db.execute({
      sql: `SELECT e.codigo, c.nome AS cliente, e.tipo, e.capacidade, e.local, e.status, e.proxima_vistoria,
              e.cep, e.endereco, e.numero, e.complemento, e.bairro, e.cidade, e.uf, ${U.COLS_END_CLIENTE}
            FROM extintores e JOIN clientes c ON c.id = e.cliente_id ${W} ORDER BY c.nome, e.codigo`, args,
    })).map(U.enderecoExtintor);
    out = {
      titulo: 'Relatório de extintores',
      colunas: ['Código', 'Cliente', 'Tipo', 'Capacidade', 'Local', 'Endereço', 'Status', 'Próx. vistoria'],
      linhas: x.map((e) => [e.codigo, e.cliente, e.tipo, e.capacidade || '', e.local || '', e.endereco_texto, nm(e.status), fd(e.proxima_vistoria)]),
      resumo: [{ rotulo: 'Total', valor: x.length }, { rotulo: 'Em dia', valor: x.filter((e) => e.status === 'em_dia').length }, { rotulo: 'Em atraso', valor: x.filter((e) => e.status === 'em_atraso').length }],
    };
  } else if (tipo === 'os') {
    const x = linhas(await db.execute({ sql: `${S.SELECT_OS} WHERE o.data BETWEEN ? AND ? ORDER BY o.data, o.numero`, args: [de, ate] }));
    out = {
      titulo: `Ordens de serviço de ${fd(de)} a ${fd(ate)}`,
      colunas: ['Nº OS', 'Cliente', 'Tipo', 'Status', 'Data', 'Motorista'],
      linhas: x.map((o) => [o.numero, o.cliente, o.tipo, nm(o.status), fd(o.data), o.motorista || '']),
      resumo: [{ rotulo: 'Total', valor: x.length }, { rotulo: 'Pendentes', valor: x.filter((o) => o.status === 'pendente').length }, { rotulo: 'Em andamento', valor: x.filter((o) => o.status === 'em_andamento').length }, { rotulo: 'Concluídas', valor: x.filter((o) => o.status === 'concluida').length }],
    };
  } else if (tipo === 'vistorias') {
    const x = linhas(await db.execute({
      sql: `SELECT v.data, e.codigo, c.nome AS cliente, u.nome AS operador, v.resultado, v.observacao FROM vistorias v
            JOIN extintores e ON e.id = v.extintor_id JOIN clientes c ON c.id = e.cliente_id
            LEFT JOIN usuarios u ON u.id = v.operador_id WHERE v.data BETWEEN ? AND ? ORDER BY v.data, v.id`,
      args: [de, ate],
    }));
    const ok = x.filter((v) => v.resultado === 'conforme').length;
    out = {
      titulo: `Vistorias de ${fd(de)} a ${fd(ate)}`,
      colunas: ['Data', 'Extintor', 'Cliente', 'Operador', 'Resultado', 'Observação'],
      linhas: x.map((v) => [fd(v.data), v.codigo, v.cliente, v.operador || '', nm(v.resultado), v.observacao || '']),
      resumo: [{ rotulo: 'Total', valor: x.length }, { rotulo: 'Conformes', valor: ok }, { rotulo: 'Não conformes', valor: x.length - ok }, { rotulo: 'Conformidade', valor: x.length ? Math.round((ok / x.length) * 100) + '%' : '—' }],
    };
  } else if (tipo === 'vencimentos') {
    const ini = req.query.de ? de : hoje;
    const fim = req.query.ate ? ate : somaDias(30);
    const x = linhas(await db.execute({
      sql: `SELECT e.codigo, c.nome AS cliente, e.tipo, e.local, e.proxima_vistoria FROM extintores e
            JOIN clientes c ON c.id = e.cliente_id WHERE e.status != 'inativo' AND e.proxima_vistoria BETWEEN ? AND ?
            ORDER BY e.proxima_vistoria, e.codigo`, args: [ini, fim],
    }));
    out = {
      titulo: `Vencimentos de ${fd(ini)} a ${fd(fim)}`,
      colunas: ['Vencimento', 'Extintor', 'Cliente', 'Tipo', 'Local'],
      linhas: x.map((e) => [fd(e.proxima_vistoria), e.codigo, e.cliente, e.tipo, e.local || '']),
      resumo: [{ rotulo: 'Extintores a vencer', valor: x.length }],
    };
  } else if (tipo === 'manutencoes') {
    const x = linhas(await db.execute({
      sql: `SELECT m.data, e.codigo, c.nome AS cliente, m.tipo, m.descricao, m.custo, u.nome AS operador FROM manutencoes m
            JOIN extintores e ON e.id = m.extintor_id JOIN clientes c ON c.id = e.cliente_id
            LEFT JOIN usuarios u ON u.id = m.operador_id WHERE m.data BETWEEN ? AND ? ORDER BY m.data, m.id`,
      args: [de, ate],
    }));
    const total = x.reduce((s, m) => s + (m.custo || 0), 0);
    out = {
      titulo: `Manutenções de ${fd(de)} a ${fd(ate)}`,
      colunas: ['Data', 'Extintor', 'Cliente', 'Tipo', 'Descrição', 'Custo (R$)', 'Operador'],
      linhas: x.map((m) => [fd(m.data), m.codigo, m.cliente, m.tipo, m.descricao || '', m.custo != null ? m.custo.toFixed(2).replace('.', ',') : '', m.operador || '']),
      resumo: [{ rotulo: 'Manutenções', valor: x.length }, { rotulo: 'Custo total', valor: 'R$ ' + total.toFixed(2).replace('.', ',') }],
    };
  } else if (tipo === 'clientes') {
    const x = linhas(await db.execute(`SELECT c.nome, c.cidade, c.telefone,
        (SELECT COUNT(*) FROM extintores e WHERE e.cliente_id = c.id AND e.status != 'inativo') AS ext,
        (SELECT COUNT(*) FROM extintores e WHERE e.cliente_id = c.id AND e.status = 'em_atraso') AS atraso,
        (SELECT COUNT(*) FROM ordens_servico o WHERE o.cliente_id = c.id AND o.status != 'concluida') AS os_abertas
        FROM clientes c ORDER BY c.nome`));
    out = {
      titulo: 'Resumo por cliente',
      colunas: ['Cliente', 'Cidade', 'Telefone', 'Extintores', 'Em atraso', 'OS abertas'],
      linhas: x.map((c) => [c.nome, c.cidade || '', c.telefone || '', c.ext, c.atraso, c.os_abertas]),
      resumo: [{ rotulo: 'Clientes', valor: x.length }],
    };
  } else {
    throw new HttpErro(404, 'Relatório não encontrado.');
  }
  res.json(out);
}));

/* ================= FUNCIONÁRIOS ================= */
r.get('/funcionarios', wrap(async (req, res) => {
  const args = []; let W = '';
  if (req.query.q) { W = 'WHERE nome LIKE ?'; args.push(like(req.query.q)); }
  const x = linhas(await db.execute({ sql: `SELECT id, nome, perfil, ativo FROM usuarios ${W} ORDER BY ativo DESC, perfil, nome`, args }));
  res.json({ itens: x, total: x.length, page: 1, paginas: 1 });
}));
r.post('/funcionarios', wrap(async (req, res) => {
  const b = req.body || {};
  const nome = texto(b.nome, { nome: 'Nome', obrig: true, max: 100 });
  const perfil = opcao(b.perfil, PERFIS, { nome: 'Perfil' });
  const pin = String(b.pin || '');
  if (!PIN_REGEX.test(pin)) throw new HttpErro(400, 'O PIN deve ter de 4 a 8 números.');
  if (await pinEmUso(pin)) throw new HttpErro(409, 'Esse PIN já está em uso. Escolha outro.');
  const x = await db.execute({ sql: 'INSERT INTO usuarios(nome, perfil, pin_hash, pin_cifrado, ativo) VALUES (?,?,?,?,1)', args: [nome, perfil, hashPin(pin), cifraPin(pin)] });
  res.status(201).json({ id: Number(x.lastInsertRowid) });
}));
// PIN atual do funcionário (apenas gerente). null = ainda não registrado: o PIN é salvo quando a pessoa entra ou quando o gerente define um novo.
r.get('/funcionarios/:id/pin', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Funcionário' });
  const x = await db.execute({ sql: 'SELECT pin_cifrado FROM usuarios WHERE id = ?', args: [id] });
  if (!x.rows.length) throw new HttpErro(404, 'Funcionário não encontrado.');
  res.json({ pin: x.rows[0].pin_cifrado ? decifraPin(x.rows[0].pin_cifrado) : null });
}));
r.put('/funcionarios/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Funcionário' });
  if (!(await existe('usuarios', id))) throw new HttpErro(404, 'Funcionário não encontrado.');
  const b = req.body || {};
  const nome = texto(b.nome, { nome: 'Nome', obrig: true, max: 100 });
  const perfil = opcao(b.perfil, PERFIS, { nome: 'Perfil' });
  const ativo = b.ativo === false || b.ativo === 0 || b.ativo === '0' ? 0 : 1;
  if (id === req.user.id && (perfil !== 'gerente' || !ativo)) throw new HttpErro(400, 'Você não pode remover seu próprio acesso de gerente.');
  const args = [nome, perfil, ativo]; let sets = 'nome=?, perfil=?, ativo=?';
  if (b.pin) {
    const pin = String(b.pin);
    if (!PIN_REGEX.test(pin)) throw new HttpErro(400, 'O PIN deve ter de 4 a 8 números.');
    if (await pinEmUso(pin, id)) throw new HttpErro(409, 'Esse PIN já está em uso. Escolha outro.');
    sets += ', pin_hash=?, pin_cifrado=?'; args.push(hashPin(pin), cifraPin(pin));
  }
  args.push(id);
  await db.execute({ sql: `UPDATE usuarios SET ${sets} WHERE id=?`, args });
  res.json({ ok: true });
}));
r.delete('/funcionarios/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Funcionário' });
  if (!(await existe('usuarios', id))) throw new HttpErro(404, 'Funcionário não encontrado.');
  if (id === req.user.id) throw new HttpErro(400, 'Você não pode excluir o seu próprio usuário.');
  const refs = (await contar('SELECT COUNT(*) AS n FROM vistorias WHERE operador_id = ?', [id]))
    + (await contar('SELECT COUNT(*) AS n FROM manutencoes WHERE operador_id = ?', [id]))
    + (await contar('SELECT COUNT(*) AS n FROM fotos WHERE operador_id = ?', [id]))
    + (await contar('SELECT COUNT(*) AS n FROM ordens_servico WHERE motorista_id = ?', [id]))
    + (await contar('SELECT COUNT(*) AS n FROM comprovantes WHERE motorista_id = ?', [id]));
  await db.execute({ sql: 'UPDATE veiculos SET motorista_id = NULL WHERE motorista_id = ?', args: [id] });
  if (refs) {
    await db.execute({ sql: 'UPDATE usuarios SET ativo = 0 WHERE id = ?', args: [id] });
    return res.json({ ok: true, inativado: true });
  }
  await db.execute({ sql: 'DELETE FROM usuarios WHERE id = ?', args: [id] });
  res.json({ ok: true, inativado: false });
}));

/* ================= VEÍCULOS ================= */
async function validaVeiculo(b, idAtual = null) {
  let placa = texto(b.placa, { nome: 'Placa', obrig: true, max: 8 }).toUpperCase();
  if (!/^[A-Z0-9-]{6,8}$/.test(placa)) throw new HttpErro(400, 'Placa inválida.');
  const dup = await db.execute({ sql: 'SELECT id FROM veiculos WHERE placa = ?', args: [placa] });
  if (dup.rows.some((x) => x.id !== idAtual)) throw new HttpErro(409, 'Já existe um veículo com essa placa.');
  const motorista_id = inteiro(b.motorista_id, { nome: 'Motorista' });
  if (motorista_id && !(await contar("SELECT COUNT(*) AS n FROM usuarios WHERE id = ? AND perfil = 'motorista'", [motorista_id]))) {
    throw new HttpErro(400, 'Motorista não encontrado.');
  }
  return {
    placa, motorista_id,
    modelo: texto(b.modelo, { nome: 'Modelo', obrig: true, max: 60 }),
    ano: inteiro(b.ano, { nome: 'Ano', min: 1980, max: 2100 }),
    km_atual: inteiro(b.km_atual, { nome: 'Quilometragem', min: 0, max: 5000000 }) ?? 0,
    status: opcao(b.status, STATUS_VEIC, { nome: 'Status', padrao: 'disponivel' }),
  };
}
r.get('/veiculos', wrap(async (req, res) => {
  const args = []; let W = '';
  if (req.query.q) { W = 'WHERE (v.placa LIKE ? OR v.modelo LIKE ?)'; args.push(like(req.query.q), like(req.query.q)); }
  const x = linhas(await db.execute({
    sql: `SELECT v.id, v.placa, v.modelo, v.ano, v.km_atual, v.status, v.motorista_id, u.nome AS motorista
          FROM veiculos v LEFT JOIN usuarios u ON u.id = v.motorista_id ${W} ORDER BY v.placa`, args,
  }));
  res.json({ itens: x, total: x.length, page: 1, paginas: 1 });
}));
r.post('/veiculos', wrap(async (req, res) => {
  const v = await validaVeiculo(req.body || {});
  if (v.motorista_id) await db.execute({ sql: 'UPDATE veiculos SET motorista_id = NULL WHERE motorista_id = ?', args: [v.motorista_id] });
  const x = await db.execute({
    sql: 'INSERT INTO veiculos(placa, modelo, ano, km_atual, status, motorista_id) VALUES (?,?,?,?,?,?)',
    args: [v.placa, v.modelo, v.ano, v.km_atual, v.status, v.motorista_id],
  });
  res.status(201).json({ id: Number(x.lastInsertRowid) });
}));
r.put('/veiculos/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Veículo' });
  if (!(await existe('veiculos', id))) throw new HttpErro(404, 'Veículo não encontrado.');
  const v = await validaVeiculo(req.body || {}, id);
  if (v.motorista_id) await db.execute({ sql: 'UPDATE veiculos SET motorista_id = NULL WHERE motorista_id = ? AND id != ?', args: [v.motorista_id, id] });
  await db.execute({
    sql: 'UPDATE veiculos SET placa=?, modelo=?, ano=?, km_atual=?, status=?, motorista_id=? WHERE id=?',
    args: [v.placa, v.modelo, v.ano, v.km_atual, v.status, v.motorista_id, id],
  });
  res.json({ ok: true });
}));
r.delete('/veiculos/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Veículo' });
  if (!(await existe('veiculos', id))) throw new HttpErro(404, 'Veículo não encontrado.');
  await db.batch([
    { sql: 'UPDATE ordens_servico SET veiculo_id = NULL WHERE veiculo_id = ?', args: [id] },
    { sql: 'DELETE FROM veiculos WHERE id = ?', args: [id] },
  ], 'write');
  res.json({ ok: true });
}));

/* ================= CONFIGURAÇÕES ================= */
r.get('/config', wrap(async (req, res) => res.json(await U.getConfig())));
r.put('/config', wrap(async (req, res) => {
  const b = req.body || {};
  const email = texto(b.empresa_email, { nome: 'E-mail', max: 100 });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpErro(400, 'E-mail inválido.');
  const v = {
    empresa_nome: texto(b.empresa_nome, { nome: 'Nome da empresa', obrig: true, max: 100 }),
    empresa_telefone: texto(b.empresa_telefone, { nome: 'Telefone', max: 30 }) || '',
    empresa_email: email || '',
    dias_alerta: String(inteiro(b.dias_alerta, { nome: 'Dias de alerta', obrig: true, min: 1, max: 60 })),
    intervalo_vistoria_dias: String(inteiro(b.intervalo_vistoria_dias, { nome: 'Intervalo de vistoria', obrig: true, min: 30, max: 730 })),
  };
  await db.batch(Object.entries(v).map(([k, val]) => ({
    sql: 'INSERT INTO configuracoes(chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', args: [k, val],
  })), 'write');
  res.json({ ok: true });
}));

/* ================= ESTOQUE (usado pelo app de terminal em C++) ================= */
// Quantidade só muda por movimentação (entrada/saída): o trigger do banco aplica o saldo e o CHECK impede negativo.
async function validaProduto(b, idAtual = null) {
  let codigo = texto(b.codigo, { nome: 'Código', max: 30 });
  if (codigo) {
    codigo = codigo.toUpperCase();
    const dup = await db.execute({ sql: 'SELECT id FROM produtos WHERE codigo = ?', args: [codigo] });
    if (dup.rows.some((x) => x.id !== idAtual)) throw new HttpErro(409, 'Já existe um produto com esse código.');
  }
  return {
    codigo: codigo || null,
    nome: texto(b.nome, { nome: 'Nome', obrig: true, max: 100 }),
    descricao: texto(b.descricao, { nome: 'Descrição', max: 300 }),
    unidade: texto(b.unidade, { nome: 'Unidade', max: 10 }) || 'un',
    valor_unitario: decimal(b.valor_unitario, { nome: 'Valor unitário', min: 0, max: 100000000 }) ?? 0,
  };
}
r.get('/estoque', wrap(async (req, res) => {
  const p = paginacao(req);
  const args = []; let W = '';
  if (req.query.q) { W = 'WHERE (nome LIKE ? OR codigo LIKE ?)'; args.push(like(req.query.q), like(req.query.q)); }
  const [tot, x] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) AS n FROM produtos ${W}`, args }),
    db.execute({ sql: `SELECT id, codigo, nome, descricao, unidade, quantidade, valor_unitario, ativo, criado_em, atualizado_em FROM produtos ${W} ORDER BY nome LIMIT ? OFFSET ?`, args: [...args, p.limit, p.offset] }),
  ]);
  res.json(resposta(linhas(x), Number(tot.rows[0].n), p));
}));
r.get('/estoque/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Produto' });
  const x = await db.execute({ sql: 'SELECT id, codigo, nome, descricao, unidade, quantidade, valor_unitario, ativo, criado_em, atualizado_em FROM produtos WHERE id = ?', args: [id] });
  if (!x.rows.length) throw new HttpErro(404, 'Produto não encontrado.');
  const m = await db.execute({
    sql: `SELECT m.id, m.tipo, m.quantidade, m.observacao, m.criado_em, u.nome AS usuario FROM estoque_movimentacoes m
          LEFT JOIN usuarios u ON u.id = m.usuario_id WHERE m.produto_id = ? ORDER BY m.id DESC LIMIT 50`, args: [id],
  });
  res.json({ produto: linhas(x)[0], movimentacoes: linhas(m) });
}));
r.post('/estoque', wrap(async (req, res) => {
  const v = await validaProduto(req.body || {});
  const inicial = inteiro((req.body || {}).quantidade_inicial, { nome: 'Quantidade inicial', min: 0, max: 100000000 }) || 0;
  const x = await db.execute({
    sql: 'INSERT INTO produtos(codigo, nome, descricao, unidade, valor_unitario) VALUES (?,?,?,?,?)',
    args: [v.codigo, v.nome, v.descricao, v.unidade, v.valor_unitario],
  });
  const id = Number(x.lastInsertRowid);
  if (inicial > 0) {
    await db.execute({ sql: "INSERT INTO estoque_movimentacoes(produto_id, tipo, quantidade, usuario_id, observacao) VALUES (?, 'entrada', ?, ?, 'Estoque inicial')", args: [id, inicial, req.user.id] });
  }
  res.status(201).json({ id });
}));
r.put('/estoque/:id', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Produto' });
  if (!(await existe('produtos', id))) throw new HttpErro(404, 'Produto não encontrado.');
  const v = await validaProduto(req.body || {}, id);
  const ativo = (req.body || {}).ativo === false || (req.body || {}).ativo === 0 ? 0 : 1;
  await db.execute({ sql: 'UPDATE produtos SET codigo=?, nome=?, descricao=?, unidade=?, valor_unitario=?, ativo=? WHERE id=?', args: [v.codigo, v.nome, v.descricao, v.unidade, v.valor_unitario, ativo, id] });
  res.json({ ok: true });
}));
r.post('/estoque/:id/movimentos', wrap(async (req, res) => {
  const id = inteiro(req.params.id, { obrig: true, nome: 'Produto' });
  const b = req.body || {};
  const tipo = opcao(b.tipo, ['entrada', 'saida'], { nome: 'Tipo' });
  const qtd = inteiro(b.quantidade, { obrig: true, nome: 'Quantidade', min: 1, max: 100000000 });
  const atual = await db.execute({ sql: 'SELECT quantidade FROM produtos WHERE id = ?', args: [id] });
  if (!atual.rows.length) throw new HttpErro(404, 'Produto não encontrado.');
  if (tipo === 'saida' && Number(atual.rows[0].quantidade) < qtd) throw new HttpErro(409, `Saldo insuficiente (disponível: ${atual.rows[0].quantidade}).`);
  try {
    await db.execute({ sql: 'INSERT INTO estoque_movimentacoes(produto_id, tipo, quantidade, usuario_id, observacao) VALUES (?,?,?,?,?)', args: [id, tipo, qtd, req.user.id, texto(b.observacao, { nome: 'Observação', max: 200 })] });
  } catch (e) {
    if (/CHECK/i.test(String(e.message))) throw new HttpErro(409, 'Saldo insuficiente.');   // outra saída chegou antes
    throw e;
  }
  const n = await db.execute({ sql: 'SELECT quantidade FROM produtos WHERE id = ?', args: [id] });
  res.status(201).json({ ok: true, quantidade: Number(n.rows[0].quantidade) });
}));

module.exports = r;
