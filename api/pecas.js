// Validações, controle de permissões, notificações e rotas do módulo PEÇAS
// Abrange duas frentes independentes:
//   1) Peças Global (catálogo fixo de 32 itens, tabelas globais de até 40 linhas)
//   2) Travas e Cordões (tabelas próprias de até 40 linhas, quantidades 0..999)
const express = require('express');
const db = require('./db');
const { obterStatusPecas } = require('./migrate');
const U = require('./util');

const { wrap, HttpErro, linhas, texto, inteiro, opcao, getConfig, TZ } = U;

// Garante resposta amigável caso a migração isolada de Peças tenha falhado
function exigeModuloPecasDisponivel(_req, res, next) {
  const st = obterStatusPecas();
  if (!st.ok) {
    return res.status(503).json({
      erro: st.erro || 'O módulo Peças está temporariamente indisponível.',
    });
  }
  next();
}

const MAX_LINHAS_TABELA = 40;
const MAX_NOME_TABELA = 100;
const MAX_OS_DIGITOS = 12;
const MAX_NUM_PECA = 40;
const MAX_SEQ = 99;
const MAX_QTD_TRAVA_CORDAO = 999;
const MAX_MOTIVO_ANALISE = 250;

const SITUACOES = ['nao_listado', 'em_analise', 'conferido'];
const STATUS_TABELA = ['aberta', 'fechada'];
const REGEX_OS = /^\d{1,12}$/;
const REGEX_NUM_PECA = /^[A-Za-z0-9-]+$/;

// Mapeamento estrito de nomes de tabelas no banco (nunca interpolar entrada do usuário)
const ESQUEMA = Object.freeze({
  peca: {
    tabelas: 'pecas_tabelas_globais',
    lancamentos: 'pecas_lancamentos',
    rotulo: 'tabela de peças',
  },
  trava_cordao: {
    tabelas: 'pecas_travas_tabelas',
    lancamentos: 'pecas_travas_lancamentos',
    rotulo: 'tabela de travas e cordões',
  },
});

// Gera data e horário oficiais de Brasília (America/Sao_Paulo) no momento do registro
function agoraBrasilia(d = new Date()) {
  const criado_em = d.toISOString();
  const data = d.toLocaleDateString('en-CA', { timeZone: TZ });
  const horario = d.toLocaleTimeString('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return { criado_em, data, horario };
}

/* ================= VALIDAÇÕES DE ENTRADA ================= */

// Valida nome de criação/renomeação de tabela global ou de travas e cordões
function validaNomeTabela(valor) {
  return texto(valor, { nome: 'Nome da tabela', obrig: true, max: MAX_NOME_TABELA });
}

// Valida sequência inteira de 1 a 99 (aceita string "01".."99" ou número)
function validaSequencia(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') {
    throw new HttpErro(400, 'Sequência é obrigatória.');
  }
  const s = String(valor).trim();
  if (!/^\d{1,2}$/.test(s)) {
    throw new HttpErro(400, 'Sequência deve ser um número inteiro de 01 a 99.');
  }
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SEQ) {
    throw new HttpErro(400, 'Sequência deve estar entre 01 e 99.');
  }
  return n;
}

// Valida número da OS: apenas dígitos numéricos, de 1 a 12 dígitos
function validaOS(valor) {
  const s = valor === null || valor === undefined ? '' : String(valor).trim();
  if (!s) throw new HttpErro(400, 'Número da OS é obrigatório.');
  if (!REGEX_OS.test(s)) {
    throw new HttpErro(400, `OS deve conter somente dígitos numéricos (máximo ${MAX_OS_DIGITOS} dígitos).`);
  }
  return s;
}

// Valida Número da Peça: letras, números e hífen (repetições permitidas)
function validaNumeroPeca(valor) {
  const s = texto(valor, { nome: 'Número da peça', obrig: true, max: MAX_NUM_PECA });
  if (!REGEX_NUM_PECA.test(s)) {
    throw new HttpErro(400, 'Número da peça aceita apenas letras, números e hífen (-).');
  }
  return s;
}

// Valida lançamento de Travas e Cordões: OS válida, quantidades 0..999 e soma >= 1
function validaLancamentoTravas(body = {}) {
  const os = validaOS(body.os);
  const qtRaw = body.qtd_travas === '' || body.qtd_travas === undefined || body.qtd_travas === null ? 0 : body.qtd_travas;
  const qcRaw = body.qtd_cordoes === '' || body.qtd_cordoes === undefined || body.qtd_cordoes === null ? 0 : body.qtd_cordoes;
  const qtd_travas = inteiro(qtRaw, { nome: 'Quantidade de travas', obrig: true, min: 0, max: MAX_QTD_TRAVA_CORDAO });
  const qtd_cordoes = inteiro(qcRaw, { nome: 'Quantidade de cordões', obrig: true, min: 0, max: MAX_QTD_TRAVA_CORDAO });
  if (qtd_travas + qtd_cordoes < 1) {
    throw new HttpErro(400, 'Informe pelo menos 1 trava ou 1 cordão para lançar.');
  }
  return { os, qtd_travas, qtd_cordoes };
}

// Valida alteração de situação de conferência pelo gerente
function validaSituacaoPayload(body = {}) {
  const situacao = opcao(body.situacao, SITUACOES, { nome: 'Situação', obrig: true });
  const motivo_analise = body.motivo_analise !== undefined
    ? texto(body.motivo_analise, { nome: 'Motivo da análise', max: MAX_MOTIVO_ANALISE })
    : undefined;
  return { situacao, motivo_analise };
}

/* ================= CONTROLE DE PERMISSÕES E PREFERÊNCIAS ================= */

// Lê preferência individual do gerente; por padrão todo usuário começa com alertas desligados (0)
async function obterPreferenciaAlertas(usuarioId) {
  const r = await db.execute({
    sql: 'SELECT recebe_alertas, ultimo_visto_em FROM pecas_preferencias_usuario WHERE usuario_id = ?',
    args: [usuarioId],
  });
  const row = r.rows[0];
  return {
    recebe_alertas: Boolean(row && Number(row.recebe_alertas) === 1),
    ultimo_visto_em: row && row.ultimo_visto_em ? String(row.ultimo_visto_em) : null,
  };
}

// Atualiza a preferência "Receber alertas de peças" para o gerente autenticado
async function definirPreferenciaAlertas(usuarioId, ativo) {
  const agora = agoraBrasilia().criado_em;
  const val = ativo ? 1 : 0;
  await db.execute({
    sql: `INSERT INTO pecas_preferencias_usuario(usuario_id, recebe_alertas, atualizado_em)
          VALUES (?, ?, ?)
          ON CONFLICT(usuario_id) DO UPDATE SET
            recebe_alertas = excluded.recebe_alertas,
            atualizado_em  = excluded.atualizado_em`,
    args: [usuarioId, val, agora],
  });
  return { recebe_alertas: Boolean(val) };
}

// Middleware de autorização do módulo Peças no painel do Gerente:
// além de exigir perfil 'gerente' (via exige('gerente')), bloqueia quem não ativou alertas em Configurações.
async function exigeAlertasPecas(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ erro: 'Sessão inválida.' });
    const pref = await obterPreferenciaAlertas(req.user.id);
    if (!pref.recebe_alertas) {
      return res.status(403).json({
        erro: 'Acesso restrito. Ative "Receber alertas de peças" em Configurações para acessar este módulo.',
      });
    }
    req.pecasPreferencia = pref;
    next();
  } catch (e) {
    if (e instanceof HttpErro) return res.status(e.status).json({ erro: e.message });
    console.error(e);
    res.status(500).json({ erro: 'Erro interno ao acessar o banco de dados.' });
  }
}

/* ================= CONCORRÊNCIA E FECHAMENTO AUTOMÁTICO (40 LINHAS) ================= */

// Insere lançamento calculando a próxima ordem (1..40) dentro de transação atômica ("tudo ou nada"):
// valida tabela aberta e limite <= 40, grava o lançamento, fecha a tabela na 40ª linha
// e cria a notificação em pecas_notificacoes no mesmo commit.
async function inserirComLimite40({ tipo, tabelaId, inserirLinha }) {
  const cfg = ESQUEMA[tipo];
  const ts = agoraBrasilia();

  for (let tentativa = 0; tentativa < 6; tentativa++) {
    try {
      return await db.emTransacao(async (tx) => {
        const tRes = await tx.execute({
          sql: `SELECT id, nome, status FROM ${cfg.tabelas} WHERE id = ?`,
          args: [tabelaId],
        });
        const tab = tRes.rows[0];
        if (!tab) throw new HttpErro(404, `${cfg.rotulo.charAt(0).toUpperCase() + cfg.rotulo.slice(1)} não encontrada.`);
        if (tab.status !== 'aberta') {
          throw new HttpErro(400, `Esta ${cfg.rotulo} já está fechada.`);
        }

        const cRes = await tx.execute({
          sql: `SELECT COALESCE(MAX(ordem), 0) AS max_ordem, COUNT(*) AS total
                FROM ${cfg.lancamentos} WHERE tabela_id = ?`,
          args: [tabelaId],
        });
        const maxOrdem = Number(cRes.rows[0].max_ordem || 0);
        const total = Number(cRes.rows[0].total || 0);

        // Impede linha 41 e garante fechamento automático caso já tenha atingido 40 linhas
        if (maxOrdem >= MAX_LINHAS_TABELA || total >= MAX_LINHAS_TABELA) {
          await tx.execute({
            sql: `UPDATE ${cfg.tabelas} SET status = 'fechada', fechada_em = COALESCE(fechada_em, ?), atualizado_em = ? WHERE id = ?`,
            args: [ts.criado_em, ts.criado_em, tabelaId],
          });
          throw new HttpErro(400, `Esta ${cfg.rotulo} atingiu o limite máximo de ${MAX_LINHAS_TABELA} linhas e foi fechada.`);
        }

        const proximaOrdem = maxOrdem + 1;
        const ins = await inserirLinha(tx, proximaOrdem, ts);
        const lancamentoId = Number(ins.lastInsertRowid);
        const fechadaAgora = proximaOrdem >= MAX_LINHAS_TABELA;

        if (fechadaAgora) {
          await tx.execute({
            sql: `UPDATE ${cfg.tabelas} SET status = 'fechada', fechada_em = ?, atualizado_em = ? WHERE id = ?`,
            args: [ts.criado_em, ts.criado_em, tabelaId],
          });
        } else {
          await tx.execute({
            sql: `UPDATE ${cfg.tabelas} SET atualizado_em = ? WHERE id = ?`,
            args: [ts.criado_em, tabelaId],
          });
        }

        // Registra notificação persistente na mesma transação do lançamento
        await tx.execute({
          sql: 'INSERT INTO pecas_notificacoes(tipo, lancamento_id, criado_em) VALUES (?, ?, ?)',
          args: [tipo, lancamentoId, ts.criado_em],
        });

        return {
          id: lancamentoId,
          ordem: proximaOrdem,
          tabela_fechada: fechadaAgora,
          tabela_nome: tab.nome,
          ts,
        };
      });
    } catch (e) {
      if (e instanceof HttpErro) throw e;
      // Concorrência simultânea na mesma ordem: tenta a próxima vaga disponível
      if (/UNIQUE.*(tabela_id|ordem)/i.test(String(e.message))) continue;
      throw e;
    }
  }

  throw new HttpErro(409, 'Muitos envios simultâneos para esta tabela. Tente enviar novamente.');
}

/* ================= CONSULTAS COMPARTILHADAS ================= */

async function listarTabelas(tipo) {
  const cfg = ESQUEMA[tipo];
  const r = await db.execute(`
    SELECT t.id, t.nome, t.status, t.criado_em, t.data_criacao, t.horario_criacao,
           t.fechada_em, t.atualizado_em, u.nome AS criado_por_nome,
           COUNT(l.id) AS total_linhas,
           COALESCE(SUM(CASE WHEN l.baixa = 1 THEN 1 ELSE 0 END), 0) AS total_baixas,
           COALESCE(SUM(CASE WHEN l.situacao = 'nao_listado' THEN 1 ELSE 0 END), 0) AS total_nao_listado,
           COALESCE(SUM(CASE WHEN l.situacao = 'em_analise' THEN 1 ELSE 0 END), 0) AS total_em_analise,
           COALESCE(SUM(CASE WHEN l.situacao = 'conferido' THEN 1 ELSE 0 END), 0) AS total_conferido
    FROM ${cfg.tabelas} t
    LEFT JOIN usuarios u ON u.id = t.criado_por
    LEFT JOIN ${cfg.lancamentos} l ON l.tabela_id = t.id
    GROUP BY t.id
    ORDER BY (t.status = 'aberta') DESC, t.id DESC
  `);
  return linhas(r).map((row) => ({
    ...row,
    total_linhas: Number(row.total_linhas || 0),
    total_baixas: Number(row.total_baixas || 0),
    total_nao_listado: Number(row.total_nao_listado || 0),
    total_em_analise: Number(row.total_em_analise || 0),
    total_conferido: Number(row.total_conferido || 0),
  }));
}

async function carregarTabelaDetalhe(tipo, tabelaId, gerenteNome) {
  const cfg = ESQUEMA[tipo];
  const tRes = await db.execute({
    sql: `SELECT t.*, u.nome AS criado_por_nome
          FROM ${cfg.tabelas} t
          LEFT JOIN usuarios u ON u.id = t.criado_por
          WHERE t.id = ?`,
    args: [tabelaId],
  });
  const tabela = tRes.rows[0];
  if (!tabela) throw new HttpErro(404, `${cfg.rotulo.charAt(0).toUpperCase() + cfg.rotulo.slice(1)} não encontrada.`);

  const colsExtra = tipo === 'peca'
    ? 'l.catalogo_id, l.peca_nome, l.sequencia, l.os, l.numero_peca'
    : 'l.os, l.qtd_travas, l.qtd_cordoes';

  const lRes = await db.execute({
    sql: `SELECT l.id, l.tabela_id, l.ordem, ${colsExtra},
                 l.operador_id, u.nome AS operador_nome,
                 l.criado_em, l.data_envio, l.horario_envio,
                 l.situacao, l.motivo_analise, l.baixa, l.baixa_em,
                 ub.nome AS baixa_por_nome
          FROM ${cfg.lancamentos} l
          JOIN usuarios u ON u.id = l.operador_id
          LEFT JOIN usuarios ub ON ub.id = l.baixa_por
          WHERE l.tabela_id = ?
          ORDER BY l.ordem ASC`,
    args: [tabelaId],
  });

  const cfgEmpresa = await getConfig();
  return {
    tabela: { ...tabela, total_linhas: lRes.rows.length },
    linhas: linhas(lRes).map((row) => ({ ...row, baixa: Number(row.baixa || 0) === 1 })),
    empresa_nome: cfgEmpresa.empresa_nome || 'Extinsul Extintores Ltda.',
    gerente_nome: gerenteNome,
    baixado_em: agoraBrasilia(),
  };
}

// Atualiza situação de uma linha com auditoria (atualizado_por / atualizado_em).
// Ao sair de 'conferido', remove automaticamente a baixa para manter: "dar baixa já marca como Conferido".
async function atualizarSituacaoLinha({ tipo, lancamentoId, body, usuarioId }) {
  const cfg = ESQUEMA[tipo];
  const { situacao, motivo_analise } = validaSituacaoPayload(body);
  const agora = agoraBrasilia().criado_em;

  const atualRes = await db.execute({
    sql: `SELECT id, tabela_id, situacao, motivo_analise, baixa FROM ${cfg.lancamentos} WHERE id = ?`,
    args: [lancamentoId],
  });
  const atual = atualRes.rows[0];
  if (!atual) throw new HttpErro(404, 'Lançamento não encontrado.');

  const novoMotivo = motivo_analise !== undefined ? motivo_analise : atual.motivo_analise;

  if (situacao === 'conferido') {
    await db.execute({
      sql: `UPDATE ${cfg.lancamentos}
            SET situacao = 'conferido', motivo_analise = ?, atualizado_por = ?, atualizado_em = ?
            WHERE id = ?`,
      args: [novoMotivo || null, usuarioId, agora, lancamentoId],
    });
  } else {
    // Se voltar para 'nao_listado' ou 'em_analise', desfaz a baixa se estava riscada
    await db.execute({
      sql: `UPDATE ${cfg.lancamentos}
            SET situacao = ?, motivo_analise = ?, baixa = 0, baixa_em = NULL, baixa_por = NULL,
                atualizado_por = ?, atualizado_em = ?
            WHERE id = ?`,
      args: [situacao, novoMotivo || null, usuarioId, agora, lancamentoId],
    });
  }
  return { ok: true, id: lancamentoId, situacao, motivo_analise: novoMotivo || null };
}

// Dá baixa (baixa=1 e situacao='conferido' automático) ou desfaz a baixa (baixa=0 e volta a 'nao_listado')
async function atualizarBaixaLinha({ tipo, lancamentoId, darBaixa, usuarioId }) {
  const cfg = ESQUEMA[tipo];
  const atualRes = await db.execute({
    sql: `SELECT id FROM ${cfg.lancamentos} WHERE id = ?`,
    args: [lancamentoId],
  });
  if (!atualRes.rows.length) throw new HttpErro(404, 'Lançamento não encontrado.');

  const agora = agoraBrasilia().criado_em;
  if (darBaixa) {
    await db.execute({
      sql: `UPDATE ${cfg.lancamentos}
            SET baixa = 1, situacao = 'conferido', baixa_em = ?, baixa_por = ?,
                atualizado_por = ?, atualizado_em = ?
            WHERE id = ?`,
      args: [agora, usuarioId, usuarioId, agora, lancamentoId],
    });
    return { ok: true, baixa: true, situacao: 'conferido' };
  }

  await db.execute({
    sql: `UPDATE ${cfg.lancamentos}
          SET baixa = 0, situacao = 'nao_listado', baixa_em = NULL, baixa_por = NULL,
              atualizado_por = ?, atualizado_em = ?
          WHERE id = ?`,
    args: [usuarioId, agora, lancamentoId],
  });
  return { ok: true, baixa: false, situacao: 'nao_listado' };
}

async function riscarTodasTabela({ tipo, tabelaId, usuarioId }) {
  const cfg = ESQUEMA[tipo];
  return db.emTransacao(async (tx) => {
    const tRes = await tx.execute({ sql: `SELECT id FROM ${cfg.tabelas} WHERE id = ?`, args: [tabelaId] });
    if (!tRes.rows.length) throw new HttpErro(404, `${cfg.rotulo.charAt(0).toUpperCase() + cfg.rotulo.slice(1)} não encontrada.`);

    const agora = agoraBrasilia().criado_em;
    const r = await tx.execute({
      sql: `UPDATE ${cfg.lancamentos}
            SET baixa = 1, situacao = 'conferido',
                baixa_em = COALESCE(baixa_em, ?), baixa_por = COALESCE(baixa_por, ?),
                atualizado_por = ?, atualizado_em = ?
            WHERE tabela_id = ? AND (baixa = 0 OR situacao != 'conferido')`,
      args: [agora, usuarioId, usuarioId, agora, tabelaId],
    });
    return { ok: true, atualizadas: Number(r.rowsAffected || 0) };
  });
}

// Exclui tabela, suas linhas e notificações vinculadas em uma única transação
async function excluirTabelaComNotificacoes({ tipo, tabelaId, msgNaoEncontrada }) {
  const cfg = ESQUEMA[tipo];
  return db.emTransacao(async (tx) => {
    const cur = await tx.execute({ sql: `SELECT id FROM ${cfg.tabelas} WHERE id = ?`, args: [tabelaId] });
    if (!cur.rows.length) throw new HttpErro(404, msgNaoEncontrada);

    await tx.execute({
      sql: `DELETE FROM pecas_notificacoes
            WHERE tipo = ? AND lancamento_id IN (SELECT id FROM ${cfg.lancamentos} WHERE tabela_id = ?)`,
      args: [tipo, tabelaId],
    });
    await tx.execute({ sql: `DELETE FROM ${cfg.tabelas} WHERE id = ?`, args: [tabelaId] });
    return { ok: true };
  });
}

// Regras de notificação do sino do Gerente usando pecas_notificacoes + pecas_notificacoes_lidas:
// - Une lançamentos de Peças (vermelho) e Travas e Cordões (azul), ordenados por criado_em DESC
// - Ponto vermelho acende enquanto existir item não conferido ou notificação ainda não lida pelo gerente
async function listarNotificacoesGerente(usuarioId) {
  const [itensRes, pendRes, naoLidasRes] = await Promise.all([
    db.execute({
      sql: `
        SELECT * FROM (
          SELECT 'peca' AS tipo, l.id, l.tabela_id, t.nome AS tabela_nome, l.ordem,
                 l.peca_nome, l.sequencia, l.os, l.numero_peca,
                 NULL AS qtd_travas, NULL AS qtd_cordoes,
                 u.nome AS operador_nome, l.criado_em, l.data_envio, l.horario_envio,
                 l.situacao, l.motivo_analise, l.baixa,
                 CASE WHEN nl.notificacao_id IS NULL THEN 1 ELSE 0 END AS nao_lido
          FROM pecas_lancamentos l
          JOIN pecas_tabelas_globais t ON t.id = l.tabela_id
          JOIN usuarios u ON u.id = l.operador_id
          LEFT JOIN pecas_notificacoes n ON n.tipo = 'peca' AND n.lancamento_id = l.id
          LEFT JOIN pecas_notificacoes_lidas nl ON nl.notificacao_id = n.id AND nl.usuario_id = ?

          UNION ALL

          SELECT 'trava_cordao' AS tipo, l.id, l.tabela_id, t.nome AS tabela_nome, l.ordem,
                 NULL AS peca_nome, NULL AS sequencia, l.os, NULL AS numero_peca,
                 l.qtd_travas, l.qtd_cordoes,
                 u.nome AS operador_nome, l.criado_em, l.data_envio, l.horario_envio,
                 l.situacao, l.motivo_analise, l.baixa,
                 CASE WHEN nl.notificacao_id IS NULL THEN 1 ELSE 0 END AS nao_lido
          FROM pecas_travas_lancamentos l
          JOIN pecas_travas_tabelas t ON t.id = l.tabela_id
          JOIN usuarios u ON u.id = l.operador_id
          LEFT JOIN pecas_notificacoes n ON n.tipo = 'trava_cordao' AND n.lancamento_id = l.id
          LEFT JOIN pecas_notificacoes_lidas nl ON nl.notificacao_id = n.id AND nl.usuario_id = ?
        )
        ORDER BY criado_em DESC, id DESC
        LIMIT 60
      `,
      args: [usuarioId, usuarioId],
    }),
    db.execute(`
      SELECT
        (SELECT COUNT(*) FROM pecas_lancamentos WHERE situacao != 'conferido') +
        (SELECT COUNT(*) FROM pecas_travas_lancamentos WHERE situacao != 'conferido') AS n
    `),
    db.execute({
      sql: `
        SELECT COUNT(*) AS n
        FROM pecas_notificacoes n
        LEFT JOIN pecas_notificacoes_lidas nl ON nl.notificacao_id = n.id AND nl.usuario_id = ?
        WHERE nl.notificacao_id IS NULL
      `,
      args: [usuarioId],
    }),
  ]);

  const nao_conferidos = Number(pendRes.rows[0].n || 0);
  const novos = Number(naoLidasRes.rows[0].n || 0);
  const itens = linhas(itensRes).map((x) => ({
    ...x,
    baixa: Number(x.baixa || 0) === 1,
    nao_lido: Number(x.nao_lido || 0) === 1,
  }));

  return {
    nao_conferidos,
    novos,
    mostrar_ponto: nao_conferidos > 0 || novos > 0,
    itens,
  };
}

/* ================= ROTAS DO OPERADOR ================= */
function rotasOperador() {
  const r = express.Router();
  r.use(exigeModuloPecasDisponivel);

  // Resumo inicial da aba Peças: catálogo fixo ativo + tabelas atualmente abertas (Peças e Travas e Cordões)
  r.get('/resumo', wrap(async (_req, res) => {
    const [catRes, tabPecasRes, tabTravasRes] = await Promise.all([
      db.execute('SELECT id, categoria, nome, ordem FROM pecas_catalogo WHERE ativo = 1 ORDER BY ordem ASC'),
      db.execute({
        sql: `
          SELECT t.id, t.nome, t.data_criacao, t.horario_criacao, COUNT(l.id) AS total_linhas
          FROM pecas_tabelas_globais t
          LEFT JOIN pecas_lancamentos l ON l.tabela_id = t.id
          WHERE t.status = 'aberta'
          GROUP BY t.id
          HAVING COUNT(l.id) < ?
          ORDER BY t.id ASC
        `,
        args: [MAX_LINHAS_TABELA],
      }),
      db.execute({
        sql: `
          SELECT t.id, t.nome, t.data_criacao, t.horario_criacao, COUNT(l.id) AS total_linhas
          FROM pecas_travas_tabelas t
          LEFT JOIN pecas_travas_lancamentos l ON l.tabela_id = t.id
          WHERE t.status = 'aberta'
          GROUP BY t.id
          HAVING COUNT(l.id) < ?
          ORDER BY t.id ASC
        `,
        args: [MAX_LINHAS_TABELA],
      }),
    ]);

    res.json({
      catalogo: linhas(catRes),
      tabelas_pecas_abertas: linhas(tabPecasRes).map((x) => ({ ...x, total_linhas: Number(x.total_linhas || 0) })),
      tabelas_travas_abertas: linhas(tabTravasRes).map((x) => ({ ...x, total_linhas: Number(x.total_linhas || 0) })),
    });
  }));

  // Histórico próprio (somente leitura) filtrado estritamente por req.user.id:
  // operador nunca acessa lançamentos de outros operadores.
  r.get('/meus', wrap(async (req, res) => {
    const [pecasRes, travasRes] = await Promise.all([
      db.execute({
        sql: `SELECT l.id, l.tabela_id, t.nome AS tabela_nome, l.ordem, l.peca_nome,
                     l.sequencia, l.os, l.numero_peca, l.data_envio, l.horario_envio,
                     l.situacao, l.motivo_analise, l.baixa
              FROM pecas_lancamentos l
              JOIN pecas_tabelas_globais t ON t.id = l.tabela_id
              WHERE l.operador_id = ?
              ORDER BY l.id DESC
              LIMIT 40`,
        args: [req.user.id],
      }),
      db.execute({
        sql: `SELECT l.id, l.tabela_id, t.nome AS tabela_nome, l.ordem, l.os,
                     l.qtd_travas, l.qtd_cordoes, l.data_envio, l.horario_envio,
                     l.situacao, l.motivo_analise, l.baixa
              FROM pecas_travas_lancamentos l
              JOIN pecas_travas_tabelas t ON t.id = l.tabela_id
              WHERE l.operador_id = ?
              ORDER BY l.id DESC
              LIMIT 40`,
        args: [req.user.id],
      }),
    ]);

    res.json({
      pecas: linhas(pecasRes).map((x) => ({ ...x, baixa: Number(x.baixa || 0) === 1 })),
      travas: linhas(travasRes).map((x) => ({ ...x, baixa: Number(x.baixa || 0) === 1 })),
    });
  }));

  // Envia lançamento de Peça para uma tabela global aberta (em transação única com notificação)
  r.post('/', wrap(async (req, res) => {
    const b = req.body || {};
    const tabela_id = inteiro(b.tabela_id, { nome: 'Tabela de peças', obrig: true, min: 1 });
    const catalogo_id = inteiro(b.catalogo_id, { nome: 'Tipo da peça', obrig: true, min: 1 });
    const sequencia = validaSequencia(b.sequencia);
    const os = validaOS(b.os);
    const numero_peca = validaNumeroPeca(b.numero_peca);

    const catRes = await db.execute({
      sql: 'SELECT id, nome FROM pecas_catalogo WHERE id = ? AND ativo = 1',
      args: [catalogo_id],
    });
    const peca = catRes.rows[0];
    if (!peca) throw new HttpErro(400, 'Tipo de peça inválido no catálogo.');

    const gravado = await inserirComLimite40({
      tipo: 'peca',
      tabelaId: tabela_id,
      inserirLinha: (tx, ordem, ts) => tx.execute({
        sql: `INSERT INTO pecas_lancamentos
                (tabela_id, ordem, catalogo_id, peca_nome, sequencia, os, numero_peca,
                 operador_id, criado_em, data_envio, horario_envio, situacao, baixa,
                 atualizado_por, atualizado_em)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nao_listado', 0, ?, ?)`,
        args: [
          tabela_id, ordem, peca.id, peca.nome, sequencia, os, numero_peca,
          req.user.id, ts.criado_em, ts.data, ts.horario, req.user.id, ts.criado_em,
        ],
      }),
    });

    res.status(201).json({
      ok: true,
      mensagem: 'Peça enviada para a tabela de peças.',
      ...gravado,
    });
  }));

  // Envia lançamento de Travas e Cordões para uma tabela aberta (em transação única com notificação)
  r.post('/travas', wrap(async (req, res) => {
    const b = req.body || {};
    const tabela_id = inteiro(b.tabela_id, { nome: 'Tabela de travas e cordões', obrig: true, min: 1 });
    const { os, qtd_travas, qtd_cordoes } = validaLancamentoTravas(b);

    const gravado = await inserirComLimite40({
      tipo: 'trava_cordao',
      tabelaId: tabela_id,
      inserirLinha: (tx, ordem, ts) => tx.execute({
        sql: `INSERT INTO pecas_travas_lancamentos
                (tabela_id, ordem, os, qtd_travas, qtd_cordoes,
                 operador_id, criado_em, data_envio, horario_envio, situacao, baixa,
                 atualizado_por, atualizado_em)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'nao_listado', 0, ?, ?)`,
        args: [
          tabela_id, ordem, os, qtd_travas, qtd_cordoes,
          req.user.id, ts.criado_em, ts.data, ts.horario, req.user.id, ts.criado_em,
        ],
      }),
    });

    res.status(201).json({
      ok: true,
      mensagem: 'Travas e cordões enviados com sucesso.',
      ...gravado,
    });
  }));

  return r;
}

/* ================= ROTAS DO GERENTE ================= */
function rotasGerente() {
  const r = express.Router();
  r.use(exigeModuloPecasDisponivel);

  // Preferência individual de alertas (única rota acessível antes de ativar os alertas)
  r.get('/preferencia', wrap(async (req, res) => {
    const pref = await obterPreferenciaAlertas(req.user.id);
    res.json({ recebe_alertas: pref.recebe_alertas });
  }));

  r.put('/preferencia', wrap(async (req, res) => {
    const raw = req.body ? req.body.recebe_alertas : undefined;
    const ativo = raw === true || raw === 1 || raw === '1' || raw === 'true';
    const salvo = await definirPreferenciaAlertas(req.user.id, ativo);
    res.json({ ok: true, ...salvo });
  }));

  // A partir daqui, TODAS as rotas de Peças, Travas e Sino exigem "Receber alertas de peças" ativo
  r.use(exigeAlertasPecas);

  /* --- Notificações do sino --- */
  r.get('/notificacoes', wrap(async (req, res) => {
    res.json(await listarNotificacoesGerente(req.user.id));
  }));

  r.post('/notificacoes/visto', wrap(async (req, res) => {
    const agora = agoraBrasilia().criado_em;
    await db.emTransacao(async (tx) => {
      await tx.execute({
        sql: `INSERT INTO pecas_preferencias_usuario(usuario_id, recebe_alertas, ultimo_visto_em, atualizado_em)
              VALUES (?, 1, ?, ?)
              ON CONFLICT(usuario_id) DO UPDATE SET
                ultimo_visto_em = excluded.ultimo_visto_em,
                atualizado_em = excluded.atualizado_em`,
        args: [req.user.id, agora, agora],
      });
      await tx.execute({
        sql: `INSERT OR IGNORE INTO pecas_notificacoes_lidas(notificacao_id, usuario_id, lida_em)
              SELECT id, ?, ? FROM pecas_notificacoes`,
        args: [req.user.id, agora],
      });
    });
    res.json({ ok: true, ultimo_visto_em: agora });
  }));

  /* --- Peças Global: CRUD de tabelas e conferência --- */
  r.get('/tabelas', wrap(async (_req, res) => {
    res.json({ itens: await listarTabelas('peca') });
  }));

  r.post('/tabelas', wrap(async (req, res) => {
    const nome = validaNomeTabela((req.body || {}).nome);
    const ts = agoraBrasilia();
    const ins = await db.execute({
      sql: `INSERT INTO pecas_tabelas_globais(nome, status, criado_por, criado_em, data_criacao, horario_criacao, atualizado_em)
            VALUES (?, 'aberta', ?, ?, ?, ?, ?)`,
      args: [nome, req.user.id, ts.criado_em, ts.data, ts.horario, ts.criado_em],
    });
    res.status(201).json(await carregarTabelaDetalhe('peca', Number(ins.lastInsertRowid), req.user.nome));
  }));

  r.get('/tabelas/:id', wrap(async (req, res) => {
    const id = inteiro(req.params.id, { obrig: true, nome: 'Tabela', min: 1 });
    res.json(await carregarTabelaDetalhe('peca', id, req.user.nome));
  }));

  r.put('/tabelas/:id', wrap(async (req, res) => {
    const id = inteiro(req.params.id, { obrig: true, nome: 'Tabela', min: 1 });
    const b = req.body || {};
    const curRes = await db.execute({ sql: 'SELECT * FROM pecas_tabelas_globais WHERE id = ?', args: [id] });
    const cur = curRes.rows[0];
    if (!cur) throw new HttpErro(404, 'Tabela de peças não encontrada.');

    const nome = b.nome !== undefined ? validaNomeTabela(b.nome) : cur.nome;
    const status = b.status !== undefined ? opcao(b.status, STATUS_TABELA, { nome: 'Status' }) : cur.status;
    if (status === 'aberta') {
      const cnt = Number((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM pecas_lancamentos WHERE tabela_id = ?', args: [id] })).rows[0].n);
      if (cnt >= MAX_LINHAS_TABELA) {
        throw new HttpErro(400, `Não é possível reabrir uma tabela que já atingiu ${MAX_LINHAS_TABELA} linhas.`);
      }
    }
    const agora = agoraBrasilia().criado_em;
    const fechadaEm = status === 'fechada' ? (cur.fechada_em || agora) : null;
    await db.execute({
      sql: 'UPDATE pecas_tabelas_globais SET nome = ?, status = ?, fechada_em = ?, atualizado_em = ? WHERE id = ?',
      args: [nome, status, fechadaEm, agora, id],
    });
    res.json(await carregarTabelaDetalhe('peca', id, req.user.nome));
  }));

  r.delete('/tabelas/:id', wrap(async (req, res) => {
    const id = inteiro(req.params.id, { obrig: true, nome: 'Tabela', min: 1 });
    res.json(await excluirTabelaComNotificacoes({
      tipo: 'peca',
      tabelaId: id,
      msgNaoEncontrada: 'Tabela de peças não encontrada.',
    }));
  }));

  r.put('/lancamentos/:id/situacao', wrap(async (req, res) => {
    const lancamentoId = inteiro(req.params.id, { obrig: true, nome: 'Lançamento', min: 1 });
    res.json(await atualizarSituacaoLinha({ tipo: 'peca', lancamentoId, body: req.body || {}, usuarioId: req.user.id }));
  }));

  r.put('/lancamentos/:id/baixa', wrap(async (req, res) => {
    const lancamentoId = inteiro(req.params.id, { obrig: true, nome: 'Lançamento', min: 1 });
    const b = req.body || {};
    const darBaixa = b.baixa === undefined ? true : Boolean(b.baixa);
    res.json(await atualizarBaixaLinha({ tipo: 'peca', lancamentoId, darBaixa, usuarioId: req.user.id }));
  }));

  r.post('/tabelas/:id/riscar-todas', wrap(async (req, res) => {
    const tabelaId = inteiro(req.params.id, { obrig: true, nome: 'Tabela', min: 1 });
    res.json(await riscarTodasTabela({ tipo: 'peca', tabelaId, usuarioId: req.user.id }));
  }));

  /* --- Travas e Cordões: CRUD de tabelas (40 linhas) e conferência --- */
  r.get('/travas/tabelas', wrap(async (_req, res) => {
    res.json({ itens: await listarTabelas('trava_cordao') });
  }));

  r.post('/travas/tabelas', wrap(async (req, res) => {
    const nome = validaNomeTabela((req.body || {}).nome);
    const ts = agoraBrasilia();
    const ins = await db.execute({
      sql: `INSERT INTO pecas_travas_tabelas(nome, status, criado_por, criado_em, data_criacao, horario_criacao, atualizado_em)
            VALUES (?, 'aberta', ?, ?, ?, ?, ?)`,
      args: [nome, req.user.id, ts.criado_em, ts.data, ts.horario, ts.criado_em],
    });
    res.status(201).json(await carregarTabelaDetalhe('trava_cordao', Number(ins.lastInsertRowid), req.user.nome));
  }));

  r.get('/travas/tabelas/:id', wrap(async (req, res) => {
    const id = inteiro(req.params.id, { obrig: true, nome: 'Tabela', min: 1 });
    res.json(await carregarTabelaDetalhe('trava_cordao', id, req.user.nome));
  }));

  r.put('/travas/tabelas/:id', wrap(async (req, res) => {
    const id = inteiro(req.params.id, { obrig: true, nome: 'Tabela', min: 1 });
    const b = req.body || {};
    const curRes = await db.execute({ sql: 'SELECT * FROM pecas_travas_tabelas WHERE id = ?', args: [id] });
    const cur = curRes.rows[0];
    if (!cur) throw new HttpErro(404, 'Tabela de travas e cordões não encontrada.');

    const nome = b.nome !== undefined ? validaNomeTabela(b.nome) : cur.nome;
    const status = b.status !== undefined ? opcao(b.status, STATUS_TABELA, { nome: 'Status' }) : cur.status;
    if (status === 'aberta') {
      const cnt = Number((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM pecas_travas_lancamentos WHERE tabela_id = ?', args: [id] })).rows[0].n);
      if (cnt >= MAX_LINHAS_TABELA) {
        throw new HttpErro(400, `Não é possível reabrir uma tabela que já atingiu ${MAX_LINHAS_TABELA} linhas.`);
      }
    }
    const agora = agoraBrasilia().criado_em;
    const fechadaEm = status === 'fechada' ? (cur.fechada_em || agora) : null;
    await db.execute({
      sql: 'UPDATE pecas_travas_tabelas SET nome = ?, status = ?, fechada_em = ?, atualizado_em = ? WHERE id = ?',
      args: [nome, status, fechadaEm, agora, id],
    });
    res.json(await carregarTabelaDetalhe('trava_cordao', id, req.user.nome));
  }));

  r.delete('/travas/tabelas/:id', wrap(async (req, res) => {
    const id = inteiro(req.params.id, { obrig: true, nome: 'Tabela', min: 1 });
    res.json(await excluirTabelaComNotificacoes({
      tipo: 'trava_cordao',
      tabelaId: id,
      msgNaoEncontrada: 'Tabela de travas e cordões não encontrada.',
    }));
  }));

  r.put('/travas/lancamentos/:id/situacao', wrap(async (req, res) => {
    const lancamentoId = inteiro(req.params.id, { obrig: true, nome: 'Lançamento', min: 1 });
    res.json(await atualizarSituacaoLinha({ tipo: 'trava_cordao', lancamentoId, body: req.body || {}, usuarioId: req.user.id }));
  }));

  r.put('/travas/lancamentos/:id/baixa', wrap(async (req, res) => {
    const lancamentoId = inteiro(req.params.id, { obrig: true, nome: 'Lançamento', min: 1 });
    const b = req.body || {};
    const darBaixa = b.baixa === undefined ? true : Boolean(b.baixa);
    res.json(await atualizarBaixaLinha({ tipo: 'trava_cordao', lancamentoId, darBaixa, usuarioId: req.user.id }));
  }));

  r.post('/travas/tabelas/:id/riscar-todas', wrap(async (req, res) => {
    const tabelaId = inteiro(req.params.id, { obrig: true, nome: 'Tabela', min: 1 });
    res.json(await riscarTodasTabela({ tipo: 'trava_cordao', tabelaId, usuarioId: req.user.id }));
  }));

  return r;
}

module.exports = {
  MAX_LINHAS_TABELA,
  MAX_NOME_TABELA,
  MAX_OS_DIGITOS,
  MAX_NUM_PECA,
  MAX_SEQ,
  MAX_QTD_TRAVA_CORDAO,
  SITUACOES,
  STATUS_TABELA,
  agoraBrasilia,
  validaNomeTabela,
  validaSequencia,
  validaOS,
  validaNumeroPeca,
  validaLancamentoTravas,
  validaSituacaoPayload,
  obterPreferenciaAlertas,
  definirPreferenciaAlertas,
  exigeAlertasPecas,
  rotasOperador,
  rotasGerente,
};
