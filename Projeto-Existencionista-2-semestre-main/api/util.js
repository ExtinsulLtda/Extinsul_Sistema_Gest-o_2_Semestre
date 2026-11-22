// Utilidades compartilhadas pelas APIs
const db = require('./db');

class HttpErro extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const TZ = 'America/Sao_Paulo';
const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
function somaDias(n, base) {
  const d = new Date((base || hojeISO()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const linhas = (r) => r.rows.map((x) => ({ ...x }));

// Envolve handlers async: trata erros e responde JSON
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    if (e instanceof HttpErro) return res.status(e.status).json({ erro: e.message });
    console.error(e);
    res.status(500).json({ erro: 'Erro interno ao acessar o banco de dados.' });
  });

/* ---------- validação ---------- */
function texto(v, { nome = 'Campo', max = 200, obrig = false } = {}) {
  const s = v == null ? '' : String(v).trim();
  if (!s) { if (obrig) throw new HttpErro(400, `${nome} é obrigatório.`); return null; }
  if (s.length > max) throw new HttpErro(400, `${nome} deve ter no máximo ${max} caracteres.`);
  return s;
}
function inteiro(v, { nome = 'Campo', obrig = false, min = -Infinity, max = Infinity } = {}) {
  if (v === null || v === undefined || v === '') {
    if (obrig) throw new HttpErro(400, `${nome} é obrigatório.`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpErro(400, `${nome} inválido.`);
  return n;
}
function decimal(v, { nome = 'Campo', obrig = false, min = 0, max = 1e9 } = {}) {
  if (v === null || v === undefined || v === '') {
    if (obrig) throw new HttpErro(400, `${nome} é obrigatório.`);
    return null;
  }
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpErro(400, `${nome} inválido.`);
  return n;
}
function data(v, { nome = 'Data', obrig = false } = {}) {
  const s = texto(v, { nome, obrig, max: 10 });
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpErro(400, `${nome} inválida.`);
  return s;
}
function hora(v, { nome = 'Horário', obrig = false } = {}) {
  const s = texto(v, { nome, obrig, max: 5 });
  if (!s) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new HttpErro(400, `${nome} inválido.`);
  return s;
}
function opcao(v, lista, { nome = 'Campo', obrig = true, padrao = null } = {}) {
  if (v === null || v === undefined || v === '') {
    if (padrao !== null) return padrao;
    if (obrig) throw new HttpErro(400, `${nome} é obrigatório.`);
    return null;
  }
  if (!lista.includes(v)) throw new HttpErro(400, `${nome} inválido.`);
  return v;
}

/* ---------- paginação ---------- */
function paginacao(req, limitePadrao = 15) {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || limitePadrao));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  return { page, limit, offset: (page - 1) * limit };
}
const resposta = (itens, total, p) => ({ itens, total, page: p.page, paginas: Math.max(1, Math.ceil(total / p.limit)) });

/* ---------- configurações ---------- */
const CONFIG_PADRAO = {
  empresa_nome: 'Extinsul Extintores Ltda.',
  empresa_telefone: '',
  empresa_email: '',
  dias_alerta: '7',
  intervalo_vistoria_dias: '180',
};
async function getConfig() {
  const r = await db.execute('SELECT chave, valor FROM configuracoes');
  const cfg = { ...CONFIG_PADRAO };
  r.rows.forEach((x) => { cfg[x.chave] = x.valor; });
  return cfg;
}

// Extintor com vistoria vencida passa a "em atraso"
async function atualizaAtrasos() {
  await db.execute({
    sql: "UPDATE extintores SET status='em_atraso' WHERE status='em_dia' AND proxima_vistoria IS NOT NULL AND proxima_vistoria < ?",
    args: [hojeISO()],
  });
}

/* ---------- endereço ---------- */
// Valida/normaliza os campos de endereço de um corpo de requisição
function endereco(b) {
  let cep = texto(b.cep, { nome: 'CEP', max: 9 });
  if (cep) {
    const d = cep.replace(/\D/g, '');
    if (d.length !== 8) throw new HttpErro(400, 'CEP inválido (use 8 números).');
    cep = d.slice(0, 5) + '-' + d.slice(5);
  }
  const uf = texto(b.uf, { nome: 'UF', max: 2 });
  if (uf && !/^[A-Za-z]{2}$/.test(uf)) throw new HttpErro(400, 'UF inválida.');
  return {
    cep,
    endereco: texto(b.endereco, { nome: 'Logradouro', max: 150 }),
    numero: texto(b.numero, { nome: 'Número', max: 15 }),
    complemento: texto(b.complemento, { nome: 'Complemento', max: 60 }),
    bairro: texto(b.bairro, { nome: 'Bairro', max: 60 }),
    cidade: texto(b.cidade, { nome: 'Cidade', max: 60 }),
    uf: uf ? uf.toUpperCase() : null,
  };
}
// (serve para exibir e para buscar no mapa)
function enderecoTexto(o) {
  if (!o || !o.endereco) return '';
  const a = [[o.endereco, o.numero].filter(Boolean).join(', '), o.bairro].filter(Boolean).join(' - ');
  const b = [o.cidade, o.uf].filter(Boolean).join(' - ');
  return [a, b, o.cep].filter(Boolean).join(', ');
}
// Colunas do endereço do cliente, com prefixo c_, para juntar ao extintor/OS
const COLS_END_CLIENTE = 'c.cep AS c_cep, c.endereco AS c_endereco, c.numero AS c_numero, c.complemento AS c_complemento, c.bairro AS c_bairro, c.cidade AS c_cidade, c.uf AS c_uf';
const doCliente = (r) => ({ cep: r.c_cep, endereco: r.c_endereco, numero: r.c_numero, bairro: r.c_bairro, cidade: r.c_cidade, uf: r.c_uf });
const limpaPrefixo = (r) => { Object.keys(r).forEach((k) => { if (k.startsWith('c_')) delete r[k]; }); return r; };
// Endereço efetivo do extintor: o próprio, ou (se não tiver) o fixo do cliente
function enderecoExtintor(r) {
  const proprio = !!r.endereco;
  r.endereco_proprio = proprio;
  r.endereco_texto = enderecoTexto(proprio ? r : doCliente(r));
  return limpaPrefixo(r);
}

const like = (s) => `%${String(s).trim()}%`;

module.exports = {
  HttpErro, wrap, hojeISO, somaDias, linhas, texto, inteiro, decimal, data, hora, opcao,
  endereco, enderecoTexto, enderecoExtintor, COLS_END_CLIENTE, doCliente, limpaPrefixo,
  paginacao, resposta, getConfig, CONFIG_PADRAO, atualizaAtrasos, like,
};
