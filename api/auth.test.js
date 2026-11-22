const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { hashPin, verificaPin, nomeConfere, normalizarNome, PIN_REGEX } = require('./auth');

test('verificaPin valida formato scrypt padrao', () => {
  const h = hashPin('1111');
  assert.equal(verificaPin('1111', h), true);
  assert.equal(verificaPin('2222', h), false);
  assert.equal(verificaPin('', h), false);
});

test('verificaPin valida formato pbkdf2$iter$salt$hash (SHA-256)', () => {
  const salt = crypto.randomBytes(16);
  const dk = crypto.pbkdf2Sync('2222', salt, 10000, 32, 'sha256');
  const armazenado = `pbkdf2$10000$${salt.toString('hex')}$${dk.toString('hex')}`;
  assert.equal(verificaPin('2222', armazenado), true);
  assert.equal(verificaPin('3333', armazenado), false);
  assert.equal(verificaPin('2222', 'pbkdf2$abc$1234$1234'), false);
});

test('verificaPin valida PIN legado em texto puro (4 a 8 digitos)', () => {
  assert.equal(verificaPin('1111', '1111'), true);
  assert.equal(verificaPin('1112', '1111'), false);
  assert.equal(verificaPin('1111', '11110'), false);
  assert.equal(verificaPin('abcd', 'abcd'), false);
});

test('nomeConfere aceita primeiro nome, nome completo, sem acento e caixa livre', () => {
  assert.equal(nomeConfere('Carlos', 'Carlos Silva'), true);
  assert.equal(nomeConfere('  carlos   silva ', 'Carlos Silva'), true);
  assert.equal(nomeConfere('joao', 'João Pereira'), true);
  assert.equal(nomeConfere('JOÃO PEREIRA', 'João Pereira'), true);
  assert.equal(nomeConfere('Silva', 'Carlos Silva'), false);
  assert.equal(nomeConfere('', 'Carlos Silva'), false);
});

test('normalizarNome e PIN_REGEX', () => {
  assert.equal(normalizarNome('  João   Álvaro '), 'joao alvaro');
  assert.equal(PIN_REGEX.test('1111'), true);
  assert.equal(PIN_REGEX.test('12345678'), true);
  assert.equal(PIN_REGEX.test('123'), false);
  assert.equal(PIN_REGEX.test('12a4'), false);
});
