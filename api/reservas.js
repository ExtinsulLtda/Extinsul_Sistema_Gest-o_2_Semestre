// Validações e utilitários compartilhados do módulo de Reservas e Empréstimos
const { HttpErro, texto, inteiro, TZ } = require('./util');

const MAX_LINHAS = 100;
const MAX_NOME = 100;
const MAX_NUMERO = 999999999;
const MOTIVOS = ['E', 'V'];
const MOVIMENTACOES = ['Vai', 'Retornou'];

// Gera carimbos de data/hora no fuso de Brasília para criação de tabelas
function agoraReservaSP(d = new Date()) {
  const criado_em = d.toISOString();
  const data_criacao = d.toLocaleDateString('en-CA', { timeZone: TZ });
  const horario_criacao = d.toLocaleTimeString('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return { criado_em, data_criacao, horario_criacao };
}

// Valida e converte o número de uma reserva (inteiro 0..999999999)
function validaNumeroReserva(valor, nome = 'Número da reserva', obrig = true) {
  if (valor === null || valor === undefined || valor === '') {
    if (obrig) throw new HttpErro(400, `${nome} é obrigatório.`);
    return null;
  }
  if (typeof valor === 'number') {
    if (!Number.isInteger(valor) || valor < 0 || valor > MAX_NUMERO) {
      throw new HttpErro(400, `${nome} deve ser um número inteiro de 0 a ${MAX_NUMERO}.`);
    }
    return valor;
  }
  const s = String(valor).trim();
  if (!s) {
    if (obrig) throw new HttpErro(400, `${nome} é obrigatório.`);
    return null;
  }
  if (!/^\d+$/.test(s)) {
    throw new HttpErro(400, `${nome} aceita somente números inteiros (sem letras, sinais ou decimais).`);
  }
  if (s.length > 9) {
    throw new HttpErro(400, `${nome} pode ter no máximo 9 dígitos.`);
  }
  return Number(s);
}

// Calcula os totais de uma lista de linhas já validadas
function contagensReservas(linhas) {
  const lista = Array.isArray(linhas) ? linhas : [];
  return {
    reservas: lista.filter((l) => l.numero !== null && l.numero !== undefined).length,
    indo: lista.filter((l) => l.movimentacao === 'Vai').length,
    retornados: lista.filter((l) => l.movimentacao === 'Retornou').length,
    estragados: lista.filter((l) => l.motivo === 'E').length,
    vencidos: lista.filter((l) => l.motivo === 'V').length,
  };
}

// Valida nome + conjunto de linhas de uma tabela de reservas
function validaTabelaReservas(body = {}) {
  const nome = texto(body.nome, { nome: 'Nome da tabela', obrig: true, max: MAX_NOME });
  const brutas = body.linhas === undefined ? [] : body.linhas;
  if (!Array.isArray(brutas)) {
    throw new HttpErro(400, 'Formato inválido para as linhas da tabela.');
  }
  if (brutas.length > MAX_LINHAS) {
    throw new HttpErro(400, `A tabela pode ter no máximo ${MAX_LINHAS} linhas.`);
  }

  const linhas = [];
  const vistos = new Map();

  for (let i = 0; i < brutas.length; i++) {
    const item = brutas[i];
    if (!item || typeof item !== 'object') {
      throw new HttpErro(400, `Linha ${i + 1}: dados inválidos.`);
    }

    const numero = validaNumeroReserva(item.numero, `Linha ${i + 1}: reserva`, false);

    let motivo = null;
    if (item.motivo !== null && item.motivo !== undefined && String(item.motivo).trim() !== '') {
      const m = String(item.motivo).trim();
      if (!MOTIVOS.includes(m)) {
        throw new HttpErro(400, `Linha ${i + 1}: motivo inválido (use E, V ou deixe vazio).`);
      }
      motivo = m;
    }

    let movimentacao = null;
    if (item.movimentacao !== null && item.movimentacao !== undefined && String(item.movimentacao).trim() !== '') {
      const mv = String(item.movimentacao).trim();
      if (!MOVIMENTACOES.includes(mv)) {
        throw new HttpErro(400, `Linha ${i + 1}: movimentação inválida (use Vai, Retornou ou deixe vazio).`);
      }
      movimentacao = mv;
    }

    const cliente_id = inteiro(item.cliente_id, { nome: `Linha ${i + 1}: cliente`, min: 1 });

    // Descarta linhas totalmente vazias
    if (numero === null && motivo === null && movimentacao === null && cliente_id === null) {
      continue;
    }

    // Rejeita linha com marcações ou cliente, mas sem número da reserva
    if (numero === null) {
      throw new HttpErro(400, `Linha ${i + 1}: informe o número da reserva (ou limpe a linha).`);
    }

    if (vistos.has(numero)) {
      throw new HttpErro(400, `Linha ${i + 1}: a reserva ${numero} já aparece na linha ${vistos.get(numero)}.`);
    }
    vistos.set(numero, i + 1);

    linhas.push({
      ordem: linhas.length + 1,
      numero,
      motivo,
      movimentacao,
      cliente_id,
    });
  }

  if (linhas.length > MAX_LINHAS) {
    throw new HttpErro(400, `A tabela pode ter no máximo ${MAX_LINHAS} linhas.`);
  }

  return { nome, linhas, contagens: contagensReservas(linhas) };
}

module.exports = {
  MAX_LINHAS,
  MAX_NOME,
  MAX_NUMERO,
  MOTIVOS,
  MOVIMENTACOES,
  agoraReservaSP,
  validaNumeroReserva,
  contagensReservas,
  validaTabelaReservas,
};
