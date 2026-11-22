/* ==========================================================
   Módulo PEÇAS — Painel do GERENTE
   - Controle de acesso por preferência ("Receber alertas de peças")
   - Sino de notificações SVG no topo direito (atualiza a cada 30s e ao clicar)
   - Sub-aba Peças (tabelas globais até 40 linhas)
   - Sub-aba Travas e Cordões (tabelas próprias até 40 linhas)
   - Conferência, baixa automática para Conferido, Riscar todas, PDF/Impressão e CSV
   ========================================================== */
(function (raiz) {
  'use strict';

  const { esc } = Ex;

  const ROTULO_SIT = Object.freeze({
    nao_listado: 'Não listado',
    em_analise: 'Em análise',
    conferido: 'Conferido',
  });

  const pad2 = (n) => String(n).padStart(2, '0');
  const dataBR = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—');
  };

  function badgeSituacao(sit) {
    return `<span class="pec-badge pec-badge-${esc(sit)}">${esc(ROTULO_SIT[sit] || sit)}</span>`;
  }

  let apiGerente = null;
  let alertasAtivos = false;
  let timerPolling = null;
  let painelAberto = false;
  let dadosNoti = { nao_conferidos: 0, novos: 0, mostrar_ponto: false, itens: [] };
  let aoAtualizarPagina = null;
  let sinoWrap = null;
  let ouvinteDocRegistrado = false;

  async function pedirMotivoAnalise(atual = '') {
    let resultado = null;
    const ok = await Ex.formModal({
      titulo: 'Marcar como Em análise',
      textoSalvar: 'Salvar situação',
      valores: { motivo: atual || '' },
      campos: [
        {
          nome: 'motivo',
          rotulo: 'Motivo / comentário da análise (opcional)',
          tipo: 'textarea',
          max: 250,
          largura: 'cheio',
          placeholder: 'Ex.: Conferir código da peça na bancada… (pode deixar em branco)',
        },
      ],
      salvar: (v) => {
        resultado = String(v.motivo || '').trim();
        return Promise.resolve(true);
      },
    });
    return ok ? resultado : null;
  }

  async function alterarSituacaoItem({ tipo, id, novaSituacao, motivoAtual = '' }) {
    let motivo;
    if (novaSituacao === 'em_analise') {
      const respMot = await pedirMotivoAnalise(motivoAtual);
      if (respMot === null) return false; // cancelou modal
      motivo = respMot;
    }
    const base = tipo === 'trava_cordao' ? `/pecas/travas/lancamentos/${id}/situacao` : `/pecas/lancamentos/${id}/situacao`;
    await apiGerente(base, {
      method: 'PUT',
      body: { situacao: novaSituacao, ...(motivo !== undefined ? { motivo_analise: motivo } : {}) },
    });
    Ex.toast('Situação atualizada.');
    return true;
  }

  /* ================= SINO DE NOTIFICAÇÕES ================= */

  function pararPolling() {
    if (timerPolling) {
      clearInterval(timerPolling);
      timerPolling = null;
    }
  }

  function iniciarPolling() {
    pararPolling();
    if (!alertasAtivos) return;
    timerPolling = setInterval(() => {
      if (alertasAtivos && document.visibilityState !== 'hidden') {
        atualizarNotificacoes().catch(() => {});
      }
    }, 30000);
  }

  function desenharSino() {
    const barra = document.querySelector('.barra');
    if (!barra) return;

    if (!alertasAtivos) {
      if (sinoWrap) sinoWrap.remove();
      sinoWrap = null;
      painelAberto = false;
      return;
    }

    if (!sinoWrap) {
      sinoWrap = document.createElement('div');
      sinoWrap.className = 'pec-sino-wrap';
      barra.appendChild(sinoWrap);
    }

    if (!ouvinteDocRegistrado) {
      ouvinteDocRegistrado = true;
      document.addEventListener('click', (ev) => {
        if (painelAberto && sinoWrap && !sinoWrap.contains(ev.target)) {
          painelAberto = false;
          desenharSino();
        }
      });
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && painelAberto) {
          painelAberto = false;
          desenharSino();
        }
      });
    }

    const itensHtml = dadosNoti.itens.length
      ? dadosNoti.itens.map((n, idx) => {
          const ehPeca = n.tipo === 'peca';
          const cls = ehPeca ? 'pec-noti-peca' : 'pec-noti-trava';
          const tag = ehPeca
            ? '<span class="pec-badge pec-badge-peca">Peça</span>'
            : '<span class="pec-badge pec-badge-trava">Travas e Cordões</span>';
          const resumo = ehPeca
            ? `<strong>${esc(n.peca_nome)}</strong> · Seq. <strong>${esc(pad2(n.sequencia))}</strong> · Nº <strong>${esc(n.numero_peca)}</strong>`
            : `Travas: <strong>${n.qtd_travas}</strong> · Cordões: <strong>${n.qtd_cordoes}</strong>`;

          return `<div class="pec-noti-item ${cls}" data-noti-idx="${idx}">
            <div class="pec-noti-topo">
              ${tag}
              <span class="pec-noti-meta">${esc(dataBR(n.data_envio))} ${esc(n.horario_envio)}</span>
            </div>
            <div>OS <strong>${esc(n.os)}</strong> — ${resumo}</div>
            <div class="pec-noti-meta">Operador: <strong>${esc(n.operador_nome)}</strong> · Tabela: ${esc(n.tabela_nome)} (#${esc(pad2(n.ordem))})</div>
            ${n.motivo_analise ? `<div class="pec-motivo-chip">Motivo: ${esc(n.motivo_analise)}</div>` : ''}
            <div class="pec-noti-controles">
              <select class="pec-select-sit" data-noti-sit="${idx}" aria-label="Situação do lançamento">
                <option value="nao_listado"${n.situacao === 'nao_listado' ? ' selected' : ''}>Não listado</option>
                <option value="em_analise"${n.situacao === 'em_analise' ? ' selected' : ''}>Em análise</option>
                <option value="conferido"${n.situacao === 'conferido' ? ' selected' : ''}>Conferido</option>
              </select>
              <button type="button" class="btn btn-sm" data-noti-abrir="${idx}">Abrir tabela</button>
            </div>
          </div>`;
        }).join('')
      : '<div class="aviso-vazio" style="padding:18px 8px">Nenhum lançamento de peças registrado ainda.</div>';

    sinoWrap.innerHTML = `
      <button type="button" class="pec-sino-btn" id="pec-sino-btn" aria-label="Notificações de peças" aria-expanded="${painelAberto ? 'true' : 'false'}" title="Notificações de peças">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        ${dadosNoti.mostrar_ponto ? '<span class="pec-sino-ponto" id="pec-sino-ponto" title="Há lançamentos pendentes"></span>' : ''}
      </button>
      ${painelAberto ? `
        <div class="pec-sino-painel" id="pec-sino-painel">
          <div class="pec-sino-cab">
            <strong>Alertas de Peças (${dadosNoti.nao_conferidos} pendente${dadosNoti.nao_conferidos === 1 ? '' : 's'})</strong>
            <button type="button" class="btn btn-sm" id="pec-sino-atualizar">Atualizar</button>
          </div>
          <div class="pec-sino-lista">${itensHtml}</div>
        </div>` : ''}`;

    const btn = sinoWrap.querySelector('#pec-sino-btn');
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      painelAberto = !painelAberto;
      desenharSino();
      if (painelAberto) {
        await atualizarNotificacoes();
        await apiGerente('/pecas/notificacoes/visto', { method: 'POST' }).catch(() => {});
      }
    };

    const btnAtu = sinoWrap.querySelector('#pec-sino-atualizar');
    if (btnAtu) {
      btnAtu.onclick = async (ev) => {
        ev.stopPropagation();
        await atualizarNotificacoes();
      };
    }

    sinoWrap.querySelectorAll('[data-noti-sit]').forEach((sel) => {
      sel.onchange = async () => {
        const item = dadosNoti.itens[Number(sel.dataset.notiSit)];
        if (!item) return;
        const ok = await alterarSituacaoItem({
          tipo: item.tipo,
          id: item.id,
          novaSituacao: sel.value,
          motivoAtual: item.motivo_analise || '',
        }).catch((e) => { Ex.toast(e.message, true); return false; });
        if (!ok) {
          sel.value = item.situacao;
          return;
        }
        await atualizarNotificacoes();
        if (aoAtualizarPagina) aoAtualizarPagina();
      };
    });

    sinoWrap.querySelectorAll('[data-noti-abrir]').forEach((btnAb) => {
      btnAb.onclick = () => {
        const item = dadosNoti.itens[Number(btnAb.dataset.notiAbrir)];
        if (!item) return;
        painelAberto = false;
        desenharSino();
        const sub = item.tipo === 'trava_cordao' ? 'travas' : 'pecas';
        location.hash = `#pecas?sub=${sub}&tabela=${item.tabela_id}`;
      };
    });
  }

  async function atualizarNotificacoes() {
    if (!apiGerente || !alertasAtivos) return;
    try {
      dadosNoti = await apiGerente('/pecas/notificacoes');
      desenharSino();
    } catch {
      // ignora erro pontual de rede durante polling em segundo plano
    }
  }

  function atualizarPreferencia(ativo) {
    alertasAtivos = Boolean(ativo);
    const li = document.getElementById('menu-pecas');
    if (li) li.hidden = !alertasAtivos;
    if (alertasAtivos) {
      desenharSino();
      atualizarNotificacoes();
      iniciarPolling();
    } else {
      pararPolling();
      dadosNoti = { nao_conferidos: 0, novos: 0, mostrar_ponto: false, itens: [] };
      desenharSino();
    }
  }

  async function iniciar(api) {
    apiGerente = api;
    try {
      const pref = await apiGerente('/pecas/preferencia');
      atualizarPreferencia(Boolean(pref && pref.recebe_alertas));
    } catch {
      atualizarPreferencia(false);
    }
  }

  /* ================= PÁGINA PEÇAS DO GERENTE ================= */

  function gerarHtmlImpressao(detalhe, tipo) {
    const t = detalhe.tabela;
    const ehTrava = tipo === 'trava_cordao';
    const baixado = detalhe.baixado_em || { data: '', horario: '' };
    const colCab = ehTrava
      ? '<th>#</th><th>OS</th><th>Travas</th><th>Cordões</th><th>Operador</th><th>Data / Hora</th><th>Situação</th><th>Motivo / Comentário</th>'
      : '<th>#</th><th>Peça</th><th>Seq.</th><th>OS</th><th>Nº Peça</th><th>Operador</th><th>Data / Hora</th><th>Situação</th><th>Motivo / Comentário</th>';

    const linhasHtml = detalhe.linhas.map((l) => {
      const sit = ROTULO_SIT[l.situacao] || l.situacao;
      const sitTxt = l.baixa ? `${sit} (Baixa)` : sit;
      const cls = l.baixa ? ' class="riscada"' : '';
      if (ehTrava) {
        return `<tr${cls}>
          <td>${esc(pad2(l.ordem))}</td>
          <td>${esc(l.os)}</td>
          <td>${l.qtd_travas}</td>
          <td>${l.qtd_cordoes}</td>
          <td>${esc(l.operador_nome)}</td>
          <td>${esc(dataBR(l.data_envio))} ${esc(l.horario_envio)}</td>
          <td>${esc(sitTxt)}</td>
          <td>${esc(l.motivo_analise || '')}</td>
        </tr>`;
      }
      return `<tr${cls}>
        <td>${esc(pad2(l.ordem))}</td>
        <td>${esc(l.peca_nome)}</td>
        <td>${esc(pad2(l.sequencia))}</td>
        <td>${esc(l.os)}</td>
        <td>${esc(l.numero_peca)}</td>
        <td>${esc(l.operador_nome)}</td>
        <td>${esc(dataBR(l.data_envio))} ${esc(l.horario_envio)}</td>
        <td>${esc(sitTxt)}</td>
        <td>${esc(l.motivo_analise || '')}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="${ehTrava ? 8 : 9}" style="text-align:center">Nenhum lançamento registrado nesta tabela.</td></tr>`;

    return `
      <style>
        .pec-imp-topo{ border-bottom:2px solid #c62a1f; padding-bottom:8px; margin-bottom:10px; }
        .pec-imp-topo h1{ color:#c62a1f; margin:0; font-size:19px; }
        .pec-imp-topo h2{ color:#201d1c; margin:4px 0 6px; font-size:14px; }
        .pec-imp-meta{ display:flex; flex-wrap:wrap; gap:6px 22px; font-size:11px; color:#46505e; }
        tr.riscada td{ text-decoration:line-through; color:#667085; background:#f8fafc; }
        .pec-imp-rodape{ margin-top:14px; font-size:11px; color:#46505e; display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; }
      </style>
      <div class="pec-imp-topo">
        <h1>${esc(detalhe.empresa_nome)}</h1>
        <h2>${ehTrava ? 'Tabela de Travas e Cordões' : 'Tabela Global de Peças'}: ${esc(t.nome)}</h2>
        <div class="pec-imp-meta">
          <span><strong>Status:</strong> ${t.status === 'aberta' ? 'Aberta' : 'Fechada'} (${t.total_linhas}/40 linhas)</span>
          <span><strong>Criada em:</strong> ${esc(dataBR(t.data_criacao))} ${esc(t.horario_criacao)}</span>
          <span><strong>Gerente responsável:</strong> ${esc(detalhe.gerente_nome)}</span>
          <span><strong>Emitido em:</strong> ${esc(dataBR(baixado.data))} ${esc(baixado.horario)} (Brasília)</span>
        </div>
      </div>
      <table>
        <thead><tr>${colCab}</tr></thead>
        <tbody>${linhasHtml}</tbody>
      </table>
      <div class="pec-imp-rodape">
        <span>Baixado por: ${esc(detalhe.gerente_nome)}</span>
        <span>${esc(dataBR(baixado.data))} ${esc(baixado.horario)}</span>
      </div>`;
  }

  function exportarCsvTabela(detalhe, tipo) {
    const t = detalhe.tabela;
    const ehTrava = tipo === 'trava_cordao';
    const colunas = ehTrava
      ? ['Ordem', 'OS', 'Travas', 'Cordões', 'Operador', 'Data', 'Hora', 'Situação', 'Baixa', 'Motivo da análise']
      : ['Ordem', 'Peça', 'Sequência', 'OS', 'Nº Peça', 'Operador', 'Data', 'Hora', 'Situação', 'Baixa', 'Motivo da análise'];

    const linhas = detalhe.linhas.map((l) => {
      const sit = ROTULO_SIT[l.situacao] || l.situacao;
      const baixaTxt = l.baixa ? 'Sim' : 'Não';
      if (ehTrava) {
        return [pad2(l.ordem), l.os, l.qtd_travas, l.qtd_cordoes, l.operador_nome, dataBR(l.data_envio), l.horario_envio, sit, baixaTxt, l.motivo_analise || ''];
      }
      return [pad2(l.ordem), l.peca_nome, pad2(l.sequencia), l.os, l.numero_peca, l.operador_nome, dataBR(l.data_envio), l.horario_envio, sit, baixaTxt, l.motivo_analise || ''];
    });
    const slug = t.nome.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'tabela';
    Ex.csv(`${ehTrava ? 'travas-cordoes' : 'pecas'}-${slug}.csv`, colunas, linhas);
  }

  async function pagina(cont, { api, query }) {
    apiGerente = api;
    const pref = await api('/pecas/preferencia');
    atualizarPreferencia(Boolean(pref && pref.recebe_alertas));

    if (!pref || !pref.recebe_alertas) {
      cont.innerHTML = `
        <div class="titulo"><div><h2>Módulo Peças</h2></div></div>
        <div class="box">
          <div class="pec-alerta-bloqueado">
            <strong>Acesso restrito.</strong> Apenas gerentes com a opção <strong>"Receber alertas de peças"</strong> ativada podem acessar esta aba.
          </div>
          <button type="button" class="btn btn-primario" id="pec-ir-config">Ir para Configurações</button>
        </div>`;
      cont.querySelector('#pec-ir-config').onclick = () => { location.hash = '#config'; };
      return;
    }

    let subAba = query && query.get('sub') === 'travas' ? 'travas' : 'pecas';
    let filtroStatus = 'todas';
    const estadoSub = {
      pecas: { lista: [], selecionadaId: query && query.get('sub') !== 'travas' ? Number(query.get('tabela')) || null : null, detalhe: null },
      travas: { lista: [], selecionadaId: query && query.get('sub') === 'travas' ? Number(query.get('tabela')) || null : null, detalhe: null },
    };

    const tipoAtual = () => (subAba === 'travas' ? 'trava_cordao' : 'peca');
    const prefixoApi = () => (subAba === 'travas' ? '/pecas/travas' : '/pecas');

    async function carregarListaEDetalhe() {
      const st = estadoSub[subAba];
      const d = await api(`${prefixoApi()}/tabelas`);
      st.lista = d.itens || [];
      if (st.selecionadaId && !st.lista.some((x) => Number(x.id) === Number(st.selecionadaId))) {
        st.selecionadaId = null;
      }
      if (!st.selecionadaId && st.lista.length) {
        st.selecionadaId = st.lista[0].id;
      }
      if (st.selecionadaId) {
        st.detalhe = await api(`${prefixoApi()}/tabelas/${st.selecionadaId}`);
      } else {
        st.detalhe = null;
      }
    }

    function renderListaTabelas() {
      const st = estadoSub[subAba];
      const filtradas = st.lista.filter((t) => filtroStatus === 'todas' || t.status === filtroStatus);
      if (!filtradas.length) {
        return `<div class="aviso-vazio">Nenhuma ${subAba === 'travas' ? 'tabela de travas e cordões' : 'tabela de peças'} ${filtroStatus === 'todas' ? 'criada ainda' : 'com esse filtro'}.</div>`;
      }
      return `<div class="pec-tabelas-grid">
        ${filtradas.map((t) => {
          const ativa = Number(t.id) === Number(st.selecionadaId);
          return `<div class="pec-tab-card${ativa ? ' ativa' : ''}">
            <div class="pec-tab-card-topo">
              <strong>${esc(t.nome)}</strong>
              <span class="pec-badge pec-badge-${esc(t.status)}">${t.status === 'aberta' ? 'Aberta' : 'Fechada'}</span>
            </div>
            <div class="pec-tab-meta">
              ${t.total_linhas} / 40 linhas · Criada em ${esc(dataBR(t.data_criacao))} ${esc(t.horario_criacao)}
            </div>
            <div class="pec-tab-contadores">
              <span>Não listado: <strong>${t.total_nao_listado}</strong></span>
              <span>Em análise: <strong>${t.total_em_analise}</strong></span>
              <span>Conferido: <strong>${t.total_conferido}</strong></span>
              <span>Baixas: <strong>${t.total_baixas}</strong></span>
            </div>
            <div class="pec-tab-acoes">
              <button type="button" class="btn btn-sm${ativa ? ' btn-primario' : ''}" data-tab-abrir="${t.id}">${ativa ? 'Visualizando' : 'Abrir'}</button>
              <button type="button" class="btn btn-sm" data-tab-renomear="${t.id}">Renomear</button>
              ${t.status === 'aberta'
                ? `<button type="button" class="btn btn-sm" data-tab-status="${t.id}" data-novo-status="fechada">Fechar</button>`
                : (t.total_linhas < 40 ? `<button type="button" class="btn btn-sm" data-tab-status="${t.id}" data-novo-status="aberta">Reabrir</button>` : '')}
              <button type="button" class="btn btn-sm btn-perigo" data-tab-excluir="${t.id}">Excluir</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }

    function renderDetalheTabela() {
      const st = estadoSub[subAba];
      if (!st.detalhe) return '';
      const t = st.detalhe.tabela;
      const ehTrava = subAba === 'travas';
      const pendentesBaixa = st.detalhe.linhas.filter((l) => !l.baixa).length;

      const cabCols = ehTrava
        ? '<th>#</th><th>OS</th><th>Travas</th><th>Cordões</th><th>Operador</th><th>Data / Hora</th><th>Situação</th><th>Ações</th>'
        : '<th>#</th><th>Peça</th><th>Seq.</th><th>OS</th><th>Nº Peça</th><th>Operador</th><th>Data / Hora</th><th>Situação</th><th>Ações</th>';

      const linhasHtml = st.detalhe.linhas.map((l) => {
        const clsRow = l.baixa ? ' class="pec-linha-baixa"' : '';
        const celSit = `
          <div style="display:flex;flex-direction:column;gap:4px">
            <select class="pec-select-sit" data-linha-sit="${l.id}" aria-label="Situação da linha ${l.ordem}">
              <option value="nao_listado"${l.situacao === 'nao_listado' ? ' selected' : ''}>Não listado</option>
              <option value="em_analise"${l.situacao === 'em_analise' ? ' selected' : ''}>Em análise</option>
              <option value="conferido"${l.situacao === 'conferido' ? ' selected' : ''}>Conferido</option>
            </select>
            ${l.motivo_analise ? `<span class="pec-motivo-chip">${esc(l.motivo_analise)}</span>` : ''}
            ${l.situacao === 'em_analise' ? `<button type="button" class="link" style="font-size:11px;text-align:left" data-linha-motivo="${l.id}">${l.motivo_analise ? 'Editar motivo' : '+ Adicionar motivo'}</button>` : ''}
          </div>`;

        const celAcoes = l.baixa
          ? `<button type="button" class="btn btn-sm" data-linha-baixa="${l.id}" data-dar="0">Desfazer baixa</button>`
          : `<button type="button" class="btn btn-sm btn-verde" data-linha-baixa="${l.id}" data-dar="1">Dar baixa</button>`;

        if (ehTrava) {
          return `<tr${clsRow}>
            <td class="pec-dado"><strong>${esc(pad2(l.ordem))}</strong></td>
            <td class="pec-dado"><strong>${esc(l.os)}</strong></td>
            <td class="pec-dado">${l.qtd_travas}</td>
            <td class="pec-dado">${l.qtd_cordoes}</td>
            <td class="pec-dado">${esc(l.operador_nome)}</td>
            <td class="pec-dado nowrap">${esc(dataBR(l.data_envio))} ${esc(l.horario_envio)}</td>
            <td>${celSit}</td>
            <td>${celAcoes}</td>
          </tr>`;
        }
        return `<tr${clsRow}>
          <td class="pec-dado"><strong>${esc(pad2(l.ordem))}</strong></td>
          <td class="pec-dado">${esc(l.peca_nome)}</td>
          <td class="pec-dado"><strong>${esc(pad2(l.sequencia))}</strong></td>
          <td class="pec-dado"><strong>${esc(l.os)}</strong></td>
          <td class="pec-dado">${esc(l.numero_peca)}</td>
          <td class="pec-dado">${esc(l.operador_nome)}</td>
          <td class="pec-dado nowrap">${esc(dataBR(l.data_envio))} ${esc(l.horario_envio)}</td>
          <td>${celSit}</td>
          <td>${celAcoes}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="${ehTrava ? 8 : 9}" class="vazio">Nenhum lançamento recebido nesta tabela ainda.</td></tr>`;

      return `<div class="box">
        <div class="toolbar" style="margin-bottom:12px">
          <div>
            <strong style="font-size:15px">${esc(t.nome)}</strong>
            <span class="pec-badge pec-badge-${esc(t.status)}" style="margin-left:6px">${t.status === 'aberta' ? 'Aberta' : 'Fechada'} (${t.total_linhas}/40)</span>
          </div>
          <span class="espaco"></span>
          <button type="button" class="btn btn-perigo" id="pec-riscar-todas"${pendentesBaixa === 0 ? ' disabled' : ''}>Riscar todas (${pendentesBaixa})</button>
          <button type="button" class="btn" id="pec-exportar-csv">Exportar CSV</button>
          <button type="button" class="btn btn-primario" id="pec-baixar-pdf">Baixar tabela</button>
        </div>
        <div class="tabela-scroll">
          <table>
            <thead><tr>${cabCols}</tr></thead>
            <tbody>${linhasHtml}</tbody>
          </table>
        </div>
      </div>`;
    }

    function pintar() {
      cont.innerHTML = `
        <div class="titulo">
          <div>
            <h2>Módulo Peças</h2>
            <p class="sub">Gerencie tabelas globais (máx. 40 linhas), dê baixa nos itens e exporte relatórios.</p>
          </div>
        </div>
        <div class="pec-subabas">
          <button type="button" class="pec-subaba${subAba === 'pecas' ? ' ativo' : ''}" data-sub="pecas">Peças</button>
          <button type="button" class="pec-subaba${subAba === 'travas' ? ' ativo' : ''}" data-sub="travas">Travas e Cordões</button>
        </div>
        <div class="toolbar">
          <button type="button" class="btn btn-primario" id="pec-nova-tabela">+ Nova tabela ${subAba === 'travas' ? 'de travas e cordões' : 'de peças'}</button>
          <select id="pec-filtro-status" aria-label="Filtrar status das tabelas">
            <option value="todas"${filtroStatus === 'todas' ? ' selected' : ''}>Todas as tabelas</option>
            <option value="aberta"${filtroStatus === 'aberta' ? ' selected' : ''}>Somente abertas</option>
            <option value="fechada"${filtroStatus === 'fechada' ? ' selected' : ''}>Somente fechadas</option>
          </select>
          <span class="espaco"></span>
          <button type="button" class="btn" id="pec-recarregar">Atualizar</button>
        </div>
        ${renderListaTabelas()}
        ${renderDetalheTabela()}`;

      ligarEventos();
    }

    async function recarregarTudo() {
      await carregarListaEDetalhe();
      pintar();
      await atualizarNotificacoes();
    }

    aoAtualizarPagina = () => {
      if (document.body.contains(cont)) {
        carregarListaEDetalhe().then(pintar).catch(() => {});
      }
    };

    function ligarEventos() {
      cont.querySelectorAll('.pec-subaba').forEach((btn) => {
        btn.onclick = async () => {
          subAba = btn.dataset.sub;
          await recarregarTudo();
        };
      });

      const fil = cont.querySelector('#pec-filtro-status');
      if (fil) fil.onchange = () => { filtroStatus = fil.value; pintar(); };

      const rec = cont.querySelector('#pec-recarregar');
      if (rec) rec.onclick = () => recarregarTudo();

      const nova = cont.querySelector('#pec-nova-tabela');
      if (nova) {
        nova.onclick = async () => {
          const ok = await Ex.formModal({
            titulo: subAba === 'travas' ? 'Nova tabela de Travas e Cordões' : 'Nova tabela global de Peças',
            textoSalvar: 'Criar tabela',
            campos: [
              { nome: 'nome', rotulo: 'Nome da tabela *', obrig: true, max: 100, largura: 'cheio', placeholder: subAba === 'travas' ? 'Ex.: Travas — Semana 01' : 'Ex.: Peças — Bancada A' },
            ],
            salvar: async (v) => {
              const criada = await api(`${prefixoApi()}/tabelas`, { method: 'POST', body: { nome: v.nome } });
              estadoSub[subAba].selecionadaId = criada.tabela.id;
              return criada;
            },
          });
          if (ok) {
            Ex.toast('Tabela criada e aberta para lançamentos.');
            await recarregarTudo();
          }
        };
      }

      cont.querySelectorAll('[data-tab-abrir]').forEach((btn) => {
        btn.onclick = async () => {
          estadoSub[subAba].selecionadaId = Number(btn.dataset.tabAbrir);
          await recarregarTudo();
        };
      });

      cont.querySelectorAll('[data-tab-renomear]').forEach((btn) => {
        btn.onclick = async () => {
          const id = Number(btn.dataset.tabRenomear);
          const tab = estadoSub[subAba].lista.find((x) => Number(x.id) === id);
          const ok = await Ex.formModal({
            titulo: 'Renomear tabela',
            textoSalvar: 'Salvar nome',
            valores: { nome: tab ? tab.nome : '' },
            campos: [{ nome: 'nome', rotulo: 'Novo nome *', obrig: true, max: 100, largura: 'cheio' }],
            salvar: (v) => api(`${prefixoApi()}/tabelas/${id}`, { method: 'PUT', body: { nome: v.nome } }),
          });
          if (ok) {
            Ex.toast('Nome da tabela atualizado.');
            await recarregarTudo();
          }
        };
      });

      cont.querySelectorAll('[data-tab-status]').forEach((btn) => {
        btn.onclick = async () => {
          const id = Number(btn.dataset.tabStatus);
          const novoStatus = btn.dataset.novoStatus;
          try {
            await api(`${prefixoApi()}/tabelas/${id}`, { method: 'PUT', body: { status: novoStatus } });
            Ex.toast(novoStatus === 'fechada' ? 'Tabela fechada.' : 'Tabela reaberta.');
            await recarregarTudo();
          } catch (e) {
            Ex.toast(e.message, true);
          }
        };
      });

      cont.querySelectorAll('[data-tab-excluir]').forEach((btn) => {
        btn.onclick = async () => {
          const id = Number(btn.dataset.tabExcluir);
          const tab = estadoSub[subAba].lista.find((x) => Number(x.id) === id);
          if (!(await Ex.confirmar(`Excluir a tabela "${tab ? tab.nome : id}"? Todos os lançamentos dela serão removidos permanentemente.`, { textoOk: 'Excluir', perigo: true }))) return;
          try {
            await api(`${prefixoApi()}/tabelas/${id}`, { method: 'DELETE' });
            if (Number(estadoSub[subAba].selecionadaId) === id) estadoSub[subAba].selecionadaId = null;
            Ex.toast('Tabela excluída.');
            await recarregarTudo();
          } catch (e) {
            Ex.toast(e.message, true);
          }
        };
      });

      cont.querySelectorAll('[data-linha-sit]').forEach((sel) => {
        sel.onchange = async () => {
          const id = Number(sel.dataset.linhaSit);
          const item = estadoSub[subAba].detalhe.linhas.find((x) => Number(x.id) === id);
          if (!item) return;
          const ok = await alterarSituacaoItem({
            tipo: tipoAtual(),
            id,
            novaSituacao: sel.value,
            motivoAtual: item.motivo_analise || '',
          }).catch((e) => { Ex.toast(e.message, true); return false; });
          if (!ok) { sel.value = item.situacao; return; }
          await recarregarTudo();
        };
      });

      cont.querySelectorAll('[data-linha-motivo]').forEach((btn) => {
        btn.onclick = async () => {
          const id = Number(btn.dataset.linhaMotivo);
          const item = estadoSub[subAba].detalhe.linhas.find((x) => Number(x.id) === id);
          if (!item) return;
          const ok = await alterarSituacaoItem({
            tipo: tipoAtual(),
            id,
            novaSituacao: 'em_analise',
            motivoAtual: item.motivo_analise || '',
          }).catch((e) => { Ex.toast(e.message, true); return false; });
          if (ok) await recarregarTudo();
        };
      });

      cont.querySelectorAll('[data-linha-baixa]').forEach((btn) => {
        btn.onclick = async () => {
          const id = Number(btn.dataset.linhaBaixa);
          const dar = btn.dataset.dar === '1';
          try {
            await api(`${prefixoApi()}/lancamentos/${id}/baixa`, { method: 'PUT', body: { baixa: dar } });
            Ex.toast(dar ? 'Baixa registrada e marcada como Conferido.' : 'Baixa desfeita.');
            await recarregarTudo();
          } catch (e) {
            Ex.toast(e.message, true);
          }
        };
      });

      const riscarTodas = cont.querySelector('#pec-riscar-todas');
      if (riscarTodas) {
        riscarTodas.onclick = async () => {
          const det = estadoSub[subAba].detalhe;
          if (!det) return;
          if (!(await Ex.confirmar(`Dar baixa e marcar como Conferido em todas as linhas pendentes da tabela "${det.tabela.nome}"?`, { textoOk: 'Riscar todas' }))) return;
          try {
            await api(`${prefixoApi()}/tabelas/${det.tabela.id}/riscar-todas`, { method: 'POST' });
            Ex.toast('Todas as linhas pendentes foram baixadas e conferidas.');
            await recarregarTudo();
          } catch (e) {
            Ex.toast(e.message, true);
          }
        };
      }

      const btnPdf = cont.querySelector('#pec-baixar-pdf');
      if (btnPdf) {
        btnPdf.onclick = async () => {
          try {
            // Reconsulta o servidor para carimbar data/hora atual e o nome do gerente autenticado na sessão
            const atual = await api(`${prefixoApi()}/tabelas/${estadoSub[subAba].selecionadaId}`);
            Ex.imprimir(atual.tabela.nome, gerarHtmlImpressao(atual, tipoAtual()));
          } catch (e) {
            Ex.toast(e.message, true);
          }
        };
      }

      const btnCsv = cont.querySelector('#pec-exportar-csv');
      if (btnCsv) {
        btnCsv.onclick = () => {
          const det = estadoSub[subAba].detalhe;
          if (det) exportarCsvTabela(det, tipoAtual());
        };
      }
    }

    await carregarListaEDetalhe();
    pintar();
  }

  raiz.ExGerentePecas = {
    iniciar,
    atualizarPreferencia,
    atualizarNotificacoes,
    pagina,
  };
})(window);
