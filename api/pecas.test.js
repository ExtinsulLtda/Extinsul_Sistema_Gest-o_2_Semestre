const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const P = require('./pecas');

test('validaSequencia aceita inteiros 01..99 e rejeita fora da faixa ou texto', () => {
  assert.equal(P.validaSequencia('01'), 1);
  assert.equal(P.validaSequencia(9), 9);
  assert.equal(P.validaSequencia('99'), 99);

  assert.throws(() => P.validaSequencia(''), /obrigatória/);
  assert.throws(() => P.validaSequencia('0'), /01 e 99/);
  assert.throws(() => P.validaSequencia('100'), /01 a 99/);
  assert.throws(() => P.validaSequencia('-2'), /01 a 99/);
  assert.throws(() => P.validaSequencia('1a'), /01 a 99/);
});

test('validaOS aceita somente digitos numericos de 1 a 12 caracteres', () => {
  assert.equal(P.validaOS('123456'), '123456');
  assert.equal(P.validaOS('123456789012'), '123456789012');

  assert.throws(() => P.validaOS(''), /obrigatório/);
  assert.throws(() => P.validaOS('OS-123'), /somente dígitos/);
  assert.throws(() => P.validaOS('1234567890123'), /máximo 12 dígitos/);
});

test('validaNumeroPeca aceita letras, numeros e hifen e rejeita caracteres invalidos', () => {
  assert.equal(P.validaNumeroPeca('  PC-104A  '), 'PC-104A');
  assert.equal(P.validaNumeroPeca('99812'), '99812');

  assert.throws(() => P.validaNumeroPeca(''), /obrigatório/);
  assert.throws(() => P.validaNumeroPeca('PC 104'), /letras, números e hífen/);
  assert.throws(() => P.validaNumeroPeca('PC@104'), /letras, números e hífen/);
});

test('validaLancamentoTravas exige OS valida, faixa 0..999 e nao permite ambos zero', () => {
  assert.deepEqual(P.validaLancamentoTravas({ os: '4821', qtd_travas: 2, qtd_cordoes: 0 }), {
    os: '4821',
    qtd_travas: 2,
    qtd_cordoes: 0,
  });
  assert.deepEqual(P.validaLancamentoTravas({ os: '4821', qtd_travas: 0, qtd_cordoes: 999 }), {
    os: '4821',
    qtd_travas: 0,
    qtd_cordoes: 999,
  });

  assert.throws(() => P.validaLancamentoTravas({ os: '4821', qtd_travas: 0, qtd_cordoes: 0 }), /pelo menos 1 trava/);
  assert.throws(() => P.validaLancamentoTravas({ os: '4821', qtd_travas: 1000, qtd_cordoes: 1 }), /inválido/);
  assert.throws(() => P.validaLancamentoTravas({ os: '4821', qtd_travas: -1, qtd_cordoes: 1 }), /inválido/);
});

test('validaSituacaoPayload valida enum de situacao e motivo opcional', () => {
  assert.deepEqual(P.validaSituacaoPayload({ situacao: 'nao_listado' }), {
    situacao: 'nao_listado',
    motivo_analise: undefined,
  });
  assert.deepEqual(P.validaSituacaoPayload({ situacao: 'em_analise', motivo_analise: '  Falta conferir  ' }), {
    situacao: 'em_analise',
    motivo_analise: 'Falta conferir',
  });
  assert.deepEqual(P.validaSituacaoPayload({ situacao: 'em_analise', motivo_analise: '' }), {
    situacao: 'em_analise',
    motivo_analise: null,
  });

  assert.throws(() => P.validaSituacaoPayload({ situacao: 'pendente' }), /Situação inválido/);
});

test('005_pecas.sql define exatamente 32 pecas iniciais (7 + 25) sem alterar tabelas existentes', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '005_pecas.sql'), 'utf8');
  assert.equal(/ALTER\s+TABLE|DROP\s+TABLE/i.test(sql), false);
  const mang = sql.match(/\('Mangueiras e válvulas',\s*'[^']+',\s*\d+\)/g) || [];
  const peq = sql.match(/\('Peças pequenas',\s*'(?:''|[^'])+',\s*\d+\)/g) || [];
  assert.equal(mang.length, 7);
  assert.equal(peq.length, 25);
});
