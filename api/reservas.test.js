const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('./reservas');
const { Reserva, TabelaReserva } = require('../gerente/reservas');

test('validaNumeroReserva aceita inteiros validos e rejeita formatos invalidos', () => {
  assert.equal(R.validaNumeroReserva(0, 'Reserva', true), 0);
  assert.equal(R.validaNumeroReserva('42', 'Reserva', true), 42);
  assert.equal(R.validaNumeroReserva('999999999', 'Reserva', true), 999999999);
  assert.equal(R.validaNumeroReserva('', 'Reserva', false), null);

  assert.throws(() => R.validaNumeroReserva('', 'Reserva', true), /obrigatório/);
  assert.throws(() => R.validaNumeroReserva('-1', 'Reserva', true), /inteiros/);
  assert.throws(() => R.validaNumeroReserva('12.5', 'Reserva', true), /inteiros/);
  assert.throws(() => R.validaNumeroReserva('12a', 'Reserva', true), /inteiros/);
  assert.throws(() => R.validaNumeroReserva('1000000000', 'Reserva', true), /máximo 9 dígitos/);
});

test('validaTabelaReservas descarta linhas totalmente vazias e renumera ordem', () => {
  const res = R.validaTabelaReservas({
    nome: '  Controle semanal  ',
    linhas: [
      { numero: null, motivo: '', movimentacao: '', cliente_id: null },
      { numero: '101', motivo: 'E', movimentacao: 'Vai', cliente_id: 2 },
      { numero: '', motivo: null, movimentacao: null, cliente_id: '' },
      { numero: 205, motivo: 'V', movimentacao: 'Retornou' },
    ],
  });
  assert.equal(res.nome, 'Controle semanal');
  assert.equal(res.linhas.length, 2);
  assert.deepEqual(res.linhas[0], { ordem: 1, numero: 101, motivo: 'E', movimentacao: 'Vai', cliente_id: 2 });
  assert.deepEqual(res.linhas[1], { ordem: 2, numero: 205, motivo: 'V', movimentacao: 'Retornou', cliente_id: null });
  assert.deepEqual(res.contagens, { reservas: 2, indo: 1, retornados: 1, estragados: 1, vencidos: 1 });
});

test('validaTabelaReservas rejeita mais de 100 linhas, duplicados, linha incompleta e valores invalidos', () => {
  const cem = Array.from({ length: 100 }, (_, i) => ({ numero: i + 1 }));
  assert.equal(R.validaTabelaReservas({ nome: 'Lotada', linhas: cem }).linhas.length, 100);

  const centoEUm = Array.from({ length: 101 }, (_, i) => ({ numero: i + 1 }));
  assert.throws(() => R.validaTabelaReservas({ nome: 'Excesso', linhas: centoEUm }), /máximo 100 linhas/);

  assert.throws(
    () => R.validaTabelaReservas({ nome: 'Dup', linhas: [{ numero: 10 }, { numero: 10 }] }),
    /já aparece na linha 1/,
  );

  assert.throws(
    () => R.validaTabelaReservas({ nome: 'Incompleta', linhas: [{ numero: null, motivo: 'E' }] }),
    /informe o número da reserva/,
  );

  assert.throws(
    () => R.validaTabelaReservas({ nome: 'ClienteSemNum', linhas: [{ numero: null, cliente_id: 1 }] }),
    /informe o número da reserva/,
  );

  assert.throws(
    () => R.validaTabelaReservas({ nome: 'MotivoErrado', linhas: [{ numero: 1, motivo: 'X' }] }),
    /motivo inválido/,
  );

  assert.throws(
    () => R.validaTabelaReservas({ nome: 'MovErrada', linhas: [{ numero: 1, movimentacao: 'Voltou' }] }),
    /movimentação inválida/,
  );

  assert.throws(
    () => R.validaTabelaReservas({ nome: '   ', linhas: [] }),
    /Nome da tabela é obrigatório/,
  );
});

test('TabelaReserva suporta cliente opcional, lote restrito e documento com totais', () => {
  const t = new TabelaReserva({
    id: 7,
    nome: 'Vencidos Semana',
    data_criacao: '2026-11-20',
    horario_criacao: '08:30',
    linhas: [
      { numero: 50, motivo: 'E', movimentacao: 'Vai', cliente_id: 3, cliente: 'Empresa ABC' },
      { numero: 51, motivo: 'V', movimentacao: 'Retornou' },
    ],
  });
  assert.deepEqual(t.contagens(), { reservas: 2, indo: 1, retornados: 1, estragados: 1, vencidos: 1 });

  t.aplicarMotivoEmLote('V', [0]);
  assert.equal(t.reservas[0].motivo, 'V');
  assert.equal(t.reservas[1].motivo, 'V');

  const html = t.gerarDocumento(new Date('2026-11-22T14:00:00Z'));
  assert.match(html, /Empresa ABC/);
  assert.match(html, /Total de reservas:<\/strong> 2/);
  assert.match(html, /Indo:<\/strong> 1/);
  assert.match(html, /Retornadas:<\/strong> 1/);
  assert.match(html, /Vencidas \(V\):<\/strong> 2/);

  const vazia = new Reserva({ numero: null });
  assert.equal(vazia.estaVazia(), true);
});
