// Autenticação em duas etapas (PIN + confirmação do nome), sessão assinada e bloqueio progressivo persistido
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const { HttpErro, wrap } = require('./util');

// Lido sob demanda (no Cloudflare Workers os secrets só existem depois que o Worker inicia)
let segredoAleatorio = null;
function segredo() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (!segredoAleatorio) {
    segredoAleatorio = crypto.randomBytes(32).toString('hex');
    console.warn('[aviso] SESSION_SECRET não definido: sessões serão invalidadas a cada reinício.');
  }
  return segredoAleatorio;
}

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;   // 8 horas (sessão completa)
const DESAFIO_TTL_MS = 5 * 60 * 1000;      // 5 minutos (etapa intermediária)

const MAX_FALHAS = 3;
const BLOQUEIO_1_MS = 2 * 60 * 1000;       // 1º bloqueio: 2 minutos
const BLOQUEIO_2_MS = 5 * 60 * 1000;       // 2º bloqueio: 5 minutos
const DECAIMENTO_MS = 60 * 60 * 1000;      // 1 hora sem falhas reinicia o nível progressivo
const MSG_BLOQUEIO = 'Você atingiu o limite de tentativas de acesso. Aguarde o tempo indicado antes de tentar novamente.';

/* ---------- PIN ---------- */
function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pin), salt, 64, { N: 16384, r: 8, p: 1 });
  return salt.toString('hex') + ':' + h.toString('hex');
}
function verificaPin(pin, armazenado) {
  try {
    const raw = String(armazenado || '').trim();
    const pinStr = String(pin ?? '');
    if (!raw || !pinStr) return false;

    // Formato 1: scrypt (<saltHex>:<hashHex>)
    if (raw.includes(':')) {
      const partes = raw.split(':');
      if (partes.length !== 2) return false;
      const saltHex = partes[0].trim();
      const hashHex = partes[1].trim();
      if (!saltHex || !hashHex || !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;
      const calc = crypto.scryptSync(pinStr, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
      const esperado = Buffer.from(hashHex, 'hex');
      return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
    }

    // Formato 2: PBKDF2-SHA256 (pbkdf2$<iter>$<saltHex>$<hashHex>, usado no Worker/WebCrypto)
    if (raw.startsWith('pbkdf2$')) {
      const partes = raw.split('$');
      if (partes.length !== 4) return false;
      const iter = Number(partes[1]);
      const saltHex = partes[2].trim();
      const hashHex = partes[3].trim();
      if (!Number.isInteger(iter) || iter < 1000 || iter > 1000000) return false;
      if (!saltHex || !hashHex || saltHex.length % 2 !== 0 || hashHex.length % 2 !== 0) return false;
      if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false;
      const esperado = Buffer.from(hashHex, 'hex');
      const calc = crypto.pbkdf2Sync(pinStr, Buffer.from(saltHex, 'hex'), iter, esperado.length, 'sha256');
      return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
    }

    // Formato 3: legado em texto puro (4 a 8 dígitos inseridos manualmente no banco)
    if (/^\d{4,8}$/.test(raw) && /^\d{4,8}$/.test(pinStr)) {
      const a = Buffer.from(pinStr, 'utf8');
      const b = Buffer.from(raw, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    return false;
  } catch {
    return false;
  }
}
// O login identifica o usuário pelo PIN; por isso ele precisa ser único.
async function pinEmUso(pin, ignorarId = null) {
  const r = await db.execute('SELECT id, pin_hash FROM usuarios');
  return r.rows.some((u) => u.id !== ignorarId && verificaPin(pin, u.pin_hash));
}
const PIN_REGEX = /^\d{4,8}$/;

// PIN visível ao gerente: cópia cifrada (AES-256-GCM, chave derivada do SESSION_SECRET).
const chavePin = () => crypto.createHash('sha256').update('pin-v1:' + segredo()).digest();
function cifraPin(pin) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chavePin(), iv);
  const enc = Buffer.concat([c.update(String(pin), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('hex')).join(':');
}
function decifraPin(txt) {
  try {
    const [iv, tag, enc] = String(txt || '').split(':').map((h) => Buffer.from(h, 'hex'));
    const d = crypto.createDecipheriv('aes-256-gcm', chavePin(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}

/* ---------- confirmação de nome (1º nome ou nome completo, sem diferenciar maiúsculas) ---------- */
function normalizarNome(txt) {
  return String(txt || '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
function nomeConfere(informado, cadastrado) {
  const inf = normalizarNome(informado);
  const cad = normalizarNome(cadastrado);
  if (!inf || !cad) return false;
  const primeiro = cad.split(' ')[0];
  return inf === cad || inf === primeiro;
}

/* ---------- token ---------- */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function assina(payload) {
  const corpo = b64(payload);
  const sig = crypto.createHmac('sha256', segredo()).update(corpo).digest('base64url');
  return corpo + '.' + sig;
}
function le(token) {
  const [corpo, sig] = String(token || '').split('.');
  if (!corpo || !sig) return null;
  const esp = crypto.createHmac('sha256', segredo()).update(corpo).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(esp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

// Middleware: exige sessão completa válida (rejeita token intermediário da Etapa 1) e perfil autorizado
function exige(...perfis) {
  return async (req, res, next) => {
    const h = req.headers.authorization || '';
    const u = le(h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!u || u.tipo !== 'sessao') return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
    try {
      const r = await db.execute({ sql: 'SELECT nome, perfil, ativo FROM usuarios WHERE id = ?', args: [u.id] });
      const x = r.rows[0];
      if (!x || !x.ativo) return res.status(401).json({ erro: 'Usuário inativo.' });
      req.user = { id: u.id, nome: x.nome, perfil: x.perfil };
      if (perfis.length && !perfis.includes(x.perfil)) return res.status(403).json({ erro: 'Sem permissão.' });
      next();
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: 'Erro ao validar a sessão.' });
    }
  };
}

/* ---------- controle persistido de tentativas e bloqueio progressivo ---------- */
function obterIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return String(req.ip || req.socket?.remoteAddress || 'desconhecido').trim();
}
const chaveIp = (ip) => `ip:${ip}`;
const chaveUser = (id) => `user:${Number(id)}`;

let tabelaGarantida = false;
async function garantirTabelaTentativas() {
  if (tabelaGarantida) return;
  await db.batch([
    `CREATE TABLE IF NOT EXISTS auth_tentativas (
      chave_escopo        TEXT PRIMARY KEY,
      tipo_escopo         TEXT NOT NULL CHECK (tipo_escopo IN ('ip','user')),
      usuario_id          INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      falhas_consecutivas INTEGER NOT NULL DEFAULT 0 CHECK (falhas_consecutivas >= 0),
      nivel_bloqueio      INTEGER NOT NULL DEFAULT 0 CHECK (nivel_bloqueio IN (0, 1, 2)),
      bloqueado_em        INTEGER,
      bloqueado_ate       INTEGER,
      ultima_tentativa_em INTEGER NOT NULL,
      atualizado_em       INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_auth_tentativas_usuario ON auth_tentativas(usuario_id)',
    'CREATE INDEX IF NOT EXISTS idx_auth_tentativas_bloq ON auth_tentativas(bloqueado_ate)',
    `CREATE TABLE IF NOT EXISTS auth_logs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      etapa          TEXT NOT NULL CHECK (etapa IN ('pin','nome')),
      resultado      TEXT NOT NULL CHECK (resultado IN ('sucesso','falha','bloqueado')),
      motivo_tecnico TEXT NOT NULL,
      origem         TEXT,
      criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    'CREATE INDEX IF NOT EXISTS idx_auth_logs_usuario ON auth_logs(usuario_id, criado_em)',
    'CREATE INDEX IF NOT EXISTS idx_auth_logs_criado ON auth_logs(criado_em)',
  ], 'write');
  const cols = await db.execute('PRAGMA table_info(auth_tentativas)');
  if (!cols.rows.some((c) => c.name === 'bloqueado_em')) {
    await db.execute('ALTER TABLE auth_tentativas ADD COLUMN bloqueado_em INTEGER');
  }
  tabelaGarantida = true;
}

async function registrarLog({ usuarioId = null, etapa, resultado, motivo, origem = null }) {
  try {
    await garantirTabelaTentativas();
    await db.execute({
      sql: 'INSERT INTO auth_logs(usuario_id, etapa, resultado, motivo_tecnico, origem) VALUES (?, ?, ?, ?, ?)',
      args: [usuarioId != null ? Number(usuarioId) : null, etapa, resultado, motivo, origem ? String(origem).slice(0, 120) : null],
    });
  } catch (e) {
    console.error('[auth_logs] Falha ao registrar log:', e.message);
  }
}

async function lerEstado(chave, agora = Date.now()) {
  await garantirTabelaTentativas();
  const r = await db.execute({
    sql: 'SELECT falhas_consecutivas, nivel_bloqueio, bloqueado_em, bloqueado_ate, ultima_tentativa_em FROM auth_tentativas WHERE chave_escopo = ?',
    args: [chave],
  });
  const row = r.rows[0];
  if (!row) return { falhas: 0, nivel: 0, bloqueadoEm: null, bloqueadoAte: null, bloqueado: false, restanteSeg: 0 };

  const bloqueadoEm = row.bloqueado_em ? Number(row.bloqueado_em) : null;
  const bloqueadoAte = row.bloqueado_ate ? Number(row.bloqueado_ate) : null;
  let nivel = Number(row.nivel_bloqueio) || 0;
  let falhas = Number(row.falhas_consecutivas) || 0;

  if (bloqueadoAte && bloqueadoAte > agora) {
    return {
      falhas,
      nivel,
      bloqueadoEm,
      bloqueadoAte,
      bloqueado: true,
      restanteSeg: Math.max(1, Math.ceil((bloqueadoAte - agora) / 1000)),
    };
  }

  const refTempo = bloqueadoAte || Number(row.ultima_tentativa_em) || agora;
  if (agora - refTempo >= DECAIMENTO_MS) {
    nivel = 0;
    falhas = 0;
  }

  return { falhas, nivel, bloqueadoEm: null, bloqueadoAte: null, bloqueado: false, restanteSeg: 0 };
}

async function registrarFalha(chave, tipoEscopo, usuarioId = null, agora = Date.now()) {
  const atual = await lerEstado(chave, agora);
  if (atual.bloqueado) return atual;

  const novasFalhas = atual.falhas + 1;
  if (novasFalhas >= MAX_FALHAS) {
    const novoNivel = atual.nivel >= 1 ? 2 : 1;
    const duracao = novoNivel === 1 ? BLOQUEIO_1_MS : BLOQUEIO_2_MS;
    const bloqueadoAte = agora + duracao;
    await db.execute({
      sql: `INSERT INTO auth_tentativas(chave_escopo, tipo_escopo, usuario_id, falhas_consecutivas, nivel_bloqueio, bloqueado_em, bloqueado_ate, ultima_tentativa_em, atualizado_em)
            VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)
            ON CONFLICT(chave_escopo) DO UPDATE SET
              usuario_id = COALESCE(excluded.usuario_id, auth_tentativas.usuario_id),
              falhas_consecutivas = 0,
              nivel_bloqueio = excluded.nivel_bloqueio,
              bloqueado_em = excluded.bloqueado_em,
              bloqueado_ate = excluded.bloqueado_ate,
              ultima_tentativa_em = excluded.ultima_tentativa_em,
              atualizado_em = excluded.atualizado_em`,
      args: [chave, tipoEscopo, usuarioId, novoNivel, agora, bloqueadoAte, agora, agora],
    });
    return {
      falhas: 0,
      nivel: novoNivel,
      bloqueadoEm: agora,
      bloqueadoAte,
      bloqueado: true,
      restanteSeg: Math.ceil(duracao / 1000),
    };
  }

  await db.execute({
    sql: `INSERT INTO auth_tentativas(chave_escopo, tipo_escopo, usuario_id, falhas_consecutivas, nivel_bloqueio, bloqueado_em, bloqueado_ate, ultima_tentativa_em, atualizado_em)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)
          ON CONFLICT(chave_escopo) DO UPDATE SET
            usuario_id = COALESCE(excluded.usuario_id, auth_tentativas.usuario_id),
            falhas_consecutivas = excluded.falhas_consecutivas,
            nivel_bloqueio = excluded.nivel_bloqueio,
            bloqueado_em = NULL,
            bloqueado_ate = NULL,
            ultima_tentativa_em = excluded.ultima_tentativa_em,
            atualizado_em = excluded.atualizado_em`,
    args: [chave, tipoEscopo, usuarioId, novasFalhas, atual.nivel, agora, agora],
  });
  return { falhas: novasFalhas, nivel: atual.nivel, bloqueadoEm: null, bloqueadoAte: null, bloqueado: false, restanteSeg: 0 };
}

async function limparTentativas(chaves) {
  await garantirTabelaTentativas();
  for (const ch of chaves) {
    await db.execute({ sql: 'DELETE FROM auth_tentativas WHERE chave_escopo = ?', args: [ch] });
  }
}

function responderBloqueio(res, estado) {
  return res.status(429).json({
    erro: MSG_BLOQUEIO,
    bloqueado: true,
    restante_seg: estado.restanteSeg,
    nivel: estado.nivel,
    bloqueado_ate: estado.bloqueadoAte,
  });
}

function maiorBloqueio(a, b) {
  if (!a.bloqueado) return b;
  if (!b.bloqueado) return a;
  return a.restanteSeg >= b.restanteSeg ? a : b;
}

/* ---------- rotas ---------- */
const router = express.Router();

// Consulta o status de bloqueio persistido para o contexto do cliente atual
router.get('/login/status', wrap(async (req, res) => {
  const est = await lerEstado(chaveIp(obterIp(req)));
  res.json({
    bloqueado: est.bloqueado,
    restante_seg: est.restanteSeg,
    nivel: est.nivel,
    bloqueado_ate: est.bloqueadoAte,
  });
}));

// Etapa 1: validação do PIN (não emite sessão final; retorna token de desafio da Etapa 2)
router.post('/login', wrap(async (req, res) => {
  const ip = obterIp(req);
  const kIp = chaveIp(ip);
  const estIp = await lerEstado(kIp);
  if (estIp.bloqueado) {
    await registrarLog({ etapa: 'pin', resultado: 'bloqueado', motivo: 'bloqueio_ip_ativo', origem: ip });
    return responderBloqueio(res, estIp);
  }

  const pin = String((req.body && req.body.pin) || '').trim();
  if (!pin) throw new HttpErro(400, 'Informe seu PIN.');

  if (!PIN_REGEX.test(pin)) {
    const novo = await registrarFalha(kIp, 'ip', null);
    await registrarLog({
      etapa: 'pin',
      resultado: novo.bloqueado ? 'bloqueado' : 'falha',
      motivo: novo.bloqueado ? 'limite_tentativas_pin' : 'pin_formato_invalido',
      origem: ip,
    });
    if (novo.bloqueado) return responderBloqueio(res, novo);
    throw new HttpErro(401, 'PIN incorreto.');
  }

  const r = await db.execute('SELECT id, nome, perfil, ativo, pin_hash, pin_cifrado FROM usuarios');
  const u = r.rows.find((x) => verificaPin(pin, x.pin_hash));

  if (!u) {
    const novo = await registrarFalha(kIp, 'ip', null);
    await registrarLog({
      etapa: 'pin',
      resultado: novo.bloqueado ? 'bloqueado' : 'falha',
      motivo: novo.bloqueado ? 'limite_tentativas_pin' : 'pin_invalido',
      origem: ip,
    });
    if (novo.bloqueado) return responderBloqueio(res, novo);
    throw new HttpErro(401, 'PIN incorreto.');
  }

  const kUser = chaveUser(u.id);
  const estUser = await lerEstado(kUser);
  if (estUser.bloqueado) {
    await registrarLog({ usuarioId: u.id, etapa: 'pin', resultado: 'bloqueado', motivo: 'bloqueio_usuario_ativo', origem: ip });
    return responderBloqueio(res, estUser);
  }

  if (!u.ativo) {
    const novoIp = await registrarFalha(kIp, 'ip', Number(u.id));
    const novoUser = await registrarFalha(kUser, 'user', Number(u.id));
    const bloq = maiorBloqueio(novoIp, novoUser);
    await registrarLog({
      usuarioId: u.id,
      etapa: 'pin',
      resultado: bloq.bloqueado ? 'bloqueado' : 'falha',
      motivo: bloq.bloqueado ? 'limite_tentativas_inativo' : 'conta_inativa',
      origem: ip,
    });
    if (bloq.bloqueado) return responderBloqueio(res, bloq);
    throw new HttpErro(401, 'PIN incorreto ou acesso inativo.');
  }

  // Atualiza cópia cifrada para o gerente e converte PIN legado em texto puro para scrypt
  const precisaHash = /^\d{4,8}$/.test(String(u.pin_hash || '').trim());
  const precisaCifrado = !u.pin_cifrado || decifraPin(u.pin_cifrado) !== pin;
  if (precisaHash) {
    await db.execute({ sql: 'UPDATE usuarios SET pin_hash = ?, pin_cifrado = ? WHERE id = ?', args: [hashPin(pin), cifraPin(pin), u.id] }).catch(() => {});
  } else if (precisaCifrado) {
    await db.execute({ sql: 'UPDATE usuarios SET pin_cifrado = ? WHERE id = ?', args: [cifraPin(pin), u.id] }).catch(() => {});
  }

  await registrarLog({ usuarioId: u.id, etapa: 'pin', resultado: 'sucesso', motivo: 'pin_ok_aguardando_nome', origem: ip });

  const desafio_token = assina({
    id: Number(u.id),
    tipo: 'desafio',
    exp: Date.now() + DESAFIO_TTL_MS,
  });

  res.json({ etapa: 2, desafio_token });
}));

// Etapa 2: confirmação do primeiro nome ou nome completo vinculado ao usuário da Etapa 1
router.post('/login/confirmar-nome', wrap(async (req, res) => {
  const ip = obterIp(req);
  const kIp = chaveIp(ip);
  const estIp = await lerEstado(kIp);
  if (estIp.bloqueado) {
    await registrarLog({ etapa: 'nome', resultado: 'bloqueado', motivo: 'bloqueio_ip_ativo', origem: ip });
    return responderBloqueio(res, estIp);
  }

  const b = req.body || {};
  const desafio = le(b.desafio_token);
  if (!desafio || desafio.tipo !== 'desafio') {
    await registrarLog({ etapa: 'nome', resultado: 'falha', motivo: 'desafio_expirado', origem: ip });
    return res.status(401).json({
      erro: 'Sua validação inicial expirou. Informe seu PIN novamente.',
      desafio_expirado: true,
    });
  }

  const kUser = chaveUser(desafio.id);
  const estUser = await lerEstado(kUser);
  if (estUser.bloqueado) {
    await registrarLog({ usuarioId: desafio.id, etapa: 'nome', resultado: 'bloqueado', motivo: 'bloqueio_usuario_ativo', origem: ip });
    return responderBloqueio(res, estUser);
  }

  const nomeInformado = String(b.nome || '').trim();
  if (!nomeInformado) throw new HttpErro(400, 'Informe seu primeiro nome ou nome completo para confirmar.');

  const r = await db.execute({
    sql: 'SELECT id, nome, perfil, ativo FROM usuarios WHERE id = ?',
    args: [desafio.id],
  });
  const u = r.rows[0];
  if (!u || !u.ativo) {
    await registrarLog({ usuarioId: desafio.id, etapa: 'nome', resultado: 'falha', motivo: 'conta_indisponivel', origem: ip });
    return res.status(401).json({
      erro: 'Acesso indisponível. Informe seu PIN novamente.',
      desafio_expirado: true,
    });
  }

  if (!nomeConfere(nomeInformado, u.nome)) {
    const novoIp = await registrarFalha(kIp, 'ip', Number(u.id));
    const novoUser = await registrarFalha(kUser, 'user', Number(u.id));
    const bloq = maiorBloqueio(novoIp, novoUser);
    await registrarLog({
      usuarioId: u.id,
      etapa: 'nome',
      resultado: bloq.bloqueado ? 'bloqueado' : 'falha',
      motivo: bloq.bloqueado ? 'limite_tentativas_nome' : 'nome_divergente',
      origem: ip,
    });
    if (bloq.bloqueado) return responderBloqueio(res, bloq);
    throw new HttpErro(401, 'Nome não confere com o cadastro deste acesso.');
  }

  await limparTentativas([kIp, kUser]);
  await registrarLog({ usuarioId: u.id, etapa: 'nome', resultado: 'sucesso', motivo: 'login_concluido', origem: ip });
  const token = assina({ id: Number(u.id), tipo: 'sessao', exp: Date.now() + TOKEN_TTL_MS });
  res.json({ token, usuario: { id: Number(u.id), nome: u.nome, perfil: u.perfil } });
}));

// Dados do usuário logado (usado pelas páginas para validar a sessão)
router.get('/eu', exige(), (req, res) => res.json({ usuario: req.user }));

// Troca do próprio PIN
router.put('/eu/pin', exige(), wrap(async (req, res) => {
  const { atual, novo } = req.body || {};
  if (!PIN_REGEX.test(String(novo || ''))) throw new HttpErro(400, 'O novo PIN deve ter de 4 a 8 números.');
  const r = await db.execute({ sql: 'SELECT pin_hash FROM usuarios WHERE id = ?', args: [req.user.id] });
  if (!verificaPin(String(atual || ''), r.rows[0].pin_hash)) throw new HttpErro(400, 'PIN atual incorreto.');
  if (await pinEmUso(String(novo), req.user.id)) throw new HttpErro(409, 'Esse PIN já está em uso. Escolha outro.');
  await db.execute({ sql: 'UPDATE usuarios SET pin_hash = ?, pin_cifrado = ? WHERE id = ?', args: [hashPin(novo), cifraPin(novo), req.user.id] });
  res.json({ ok: true });
}));

module.exports = {
  router,
  exige,
  hashPin,
  cifraPin,
  decifraPin,
  verificaPin,
  pinEmUso,
  PIN_REGEX,
  nomeConfere,
  normalizarNome,
};
