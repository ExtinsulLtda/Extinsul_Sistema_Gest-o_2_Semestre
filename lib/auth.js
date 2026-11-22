// Autenticação por PIN (scrypt) + token assinado (HMAC-SHA256)
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[aviso] SESSION_SECRET não definido: sessões serão invalidadas a cada reinício.');
}
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(String(pin), salt, 64).toString('hex');
}
function verificaPin(pin, armazenado) {
  const [saltHex, hashHex] = String(armazenado).split(':');
  if (!saltHex || !hashHex) return false;
  const calc = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 64);
  const esperado = Buffer.from(hashHex, 'hex');
  return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function assina(payload) {
  const corpo = b64(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(corpo).digest('base64url');
  return corpo + '.' + sig;
}
function le(token) {
  const [corpo, sig] = String(token || '').split('.');
  if (!corpo || !sig) return null;
  const esp = crypto.createHmac('sha256', SECRET).update(corpo).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(esp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
/** Middleware: exige sessão válida e (opcional) um dos perfis informados. */
function exige(...perfis) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const u = le(h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!u) return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
    if (perfis.length && !perfis.includes(u.perfil)) return res.status(403).json({ erro: 'Sem permissão.' });
    req.user = u;
    next();
  };
}
const novoToken = (u) => assina({ id: Number(u.id), nome: u.nome, perfil: u.perfil, exp: Date.now() + TOKEN_TTL_MS });

module.exports = { hashPin, verificaPin, exige, novoToken };
