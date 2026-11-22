// Funções utilitárias compartilhadas pela API
const FUSO = 'America/Sao_Paulo';

/** Data de hoje (AAAA-MM-DD) no fuso de Brasília, independente do fuso do servidor. */
const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
/** hoje + n dias (AAAA-MM-DD) */
function somaDias(n, base = hojeISO()) {
  const d = new Date(base + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const agoraISO = () => new Date().toLocaleString('sv-SE', { timeZone: FUSO }).replace(' ', 'T').slice(0, 16);

const linhas = (r) => r.rows.map((x) => ({ ...x }));
const um = (r) => (r.rows[0] ? { ...r.rows[0] } : null);

class ErroHttp extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const bad = (msg) => new ErroHttp(400, msg);

/** texto aparado e limitado; vazio -> null */
function txt(v, max = 200) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
}
function txtObrig(v, rotulo, max = 200) {
  const s = txt(v, max);
  if (!s) throw bad(`${rotulo} é obrigatório.`);
  return s;
}
function inteiro(v, rotulo, { obrig = false, min = -Infinity, max = Infinity } = {}) {
  if (v === undefined || v === null || v === '') {
    if (obrig) throw bad(`${rotulo} é obrigatório.`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${rotulo} inválido.`);
  return n;
}
function numero(v, rotulo, { min = 0, max = 1e9 } = {}) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${rotulo} inválido.`);
  return n;
}
function dataISO(v, rotulo, obrig = false) {
  if (v === undefined || v === null || v === '') {
    if (obrig) throw bad(`${rotulo} é obrigatória.`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || isNaN(new Date(v + 'T12:00:00Z'))) throw bad(`${rotulo} inválida.`);
  return String(v);
}
function hora(v, rotulo) {
  if (v === undefined || v === null || v === '') return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) throw bad(`${rotulo} inválida.`);
  return String(v);
}
function escolha(v, lista, rotulo) {
  if (!lista.includes(v)) throw bad(`${rotulo} inválido.`);
  return v;
}

/** Envolve handlers async para tratar erros e responder JSON. */
const rota = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof ErroHttp) return res.status(e.status).json({ erro: e.message });
    if (/UNIQUE/i.test(String(e.message))) return res.status(409).json({ erro: 'Já existe um registro com esse valor único (código, placa, nome...).' });
    console.error(e);
    res.status(500).json({ erro: 'Erro interno ao acessar o banco de dados.' });
  }
};

module.exports = { hojeISO, somaDias, agoraISO, linhas, um, ErroHttp, bad, txt, txtObrig, inteiro, numero, dataISO, hora, escolha, rota };
