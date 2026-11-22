/* ==========================================================
   Painel do OPERADOR - todas as abas
   Menu: Início · Vistorias · Manutenções · Ordens de Serviço ·
         Extintores · Clientes · Fotos
   ========================================================== */
(function () {
  'use strict';
  const { esc, fmtData, badge } = Ex;
  const api = Ex.apiDe('operador');

  /* ---------- formulários reutilizados em várias abas ---------- */
  async function formVistoria({ codigo = '', resultado = '' } = {}) {
    return Ex.formModal({
      titulo: 'Registrar vistoria', textoSalvar: 'Registrar', valores: { codigo, resultado },
      campos: [
        { nome: 'codigo', rotulo: 'Código do extintor', obrig: true, max: 20, maiusculas: true, placeholder: 'EXT-001', largura: 'cheio' },
        { nome: 'resultado', rotulo: 'Resultado', tipo: 'select', obrig: true, opcoes: Ex.opcoesDe('vist'), largura: 'cheio' },
        { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', max: 300, largura: 'cheio', ajuda: 'Obrigatória quando o resultado for “Não conforme”.' },
      ],
      aoMontar: (form) => Ex.autocompleteExtintor('operador', form.elements.codigo),
      salvar: (v) => api('/vistorias', { method: 'POST', body: v }),
    });
  }
  async function formManutencao({ codigo = '' } = {}) {
    return Ex.formModal({
      titulo: 'Registrar manutenção', textoSalvar: 'Registrar', valores: { codigo, tipo: 'Recarga' },
      campos: [
        { nome: 'codigo', rotulo: 'Código do extintor', obrig: true, max: 20, maiusculas: true, placeholder: 'EXT-001' },
        { nome: 'tipo', rotulo: 'Tipo de serviço', tipo: 'select', obrig: true, opcoes: Ex.TIPOS_MANUT },
        { nome: 'custo', rotulo: 'Custo (R$)', tipo: 'number', min: 0, step: '0.01' },
        { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea', max: 300, largura: 'cheio' },
      ],
      introHTML: '<p class="mudo" style="margin-bottom:12px;font-size:12px">Após registrar, o extintor volta ao status “Em dia” e a próxima vistoria é recalculada.</p>',
      aoMontar: (form) => Ex.autocompleteExtintor('operador', form.elements.codigo),
      salvar: (v) => api('/manutencoes', { method: 'POST', body: v }),
    });
  }

  /* ---------------------------------------------------------
     INÍCIO
  --------------------------------------------------------- */
  async function inicio(cont) {
    const d = await api('/dashboard');
    cont.innerHTML = `
      <div class="titulo"><div><h2>Vistorias e Manutenções</h2><p class="sub">Resumo do dia e extintores que precisam de atenção.</p></div></div>
      <div class="acoes">
        <button class="acao acaoVerde" data-acao="vistoria"><div style="font-size:22px">✓</div><h3>Registrar Vistoria</h3><p>Verificar e atualizar o status do extintor</p></button>
        <button class="acao acaoAzul" data-acao="manutencao"><div style="font-size:22px">🔧</div><h3>Registrar Manutenção</h3><p>Adicionar manutenção ou recarga</p></button>
        <button class="acao acaoCinza" data-acao="novoext"><div style="font-size:22px">＋</div><h3>Adicionar Extintor</h3><p>Cadastrar um novo extintor, com foto</p></button>
      </div>
      <div class="cards quatro">
        ${Ex.card({ icone: '⚠', cor: 'amarelo', titulo: 'Em atraso', valor: d.atrasados, info: 'Extintores com vistoria vencida' })}
        ${Ex.card({ icone: '✓', cor: 'verde', titulo: 'Vistorias hoje', valor: d.vistorias_hoje, info: 'Registradas hoje' })}
        ${Ex.card({ icone: '🔧', cor: 'azul', titulo: 'Manutenções no mês', valor: d.manutencoes_mes, info: 'Desde o dia 1º' })}
        ${Ex.card({ icone: '▣', cor: 'vermelho', titulo: 'OS em aberto', valor: d.os_abertas, info: 'Pendentes ou em andamento' })}
      </div>
      <div class="box">
        <div class="boxTitulo">Extintores para Verificação <span class="verTodos link" data-ir="extintores">Ver todos</span></div>
        <div class="tabela-scroll"><table><thead><tr><th>Código</th><th>Cliente</th><th>Tipo</th><th>Status</th><th>Próx. vistoria</th><th>Ação</th></tr></thead><tbody>
          ${d.extintores.map((e) => `<tr><td><strong>${esc(e.codigo)}</strong></td><td>${esc(e.cliente)}</td><td>${esc(e.tipo)}</td><td>${badge('ext', e.status)}</td><td>${fmtData(e.proxima_vistoria)}</td>
            <td><div class="acoes-linha"><button class="btn btn-sm btn-verde" data-rapido="conforme" data-codigo="${esc(e.codigo)}">✓ Conforme</button>
            <button class="btn btn-sm btn-perigo" data-rapido="nao_conforme" data-codigo="${esc(e.codigo)}">✗ Não conforme</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum extintor.</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="box">
        <div class="boxTitulo">Últimas Vistorias <span class="verTodos link" data-ir="vistorias">Ver todas</span></div>
        ${Ex.tabelaSimples(['Data', 'Extintor', 'Cliente', 'Resultado'], d.vistorias.map((v) => [fmtData(v.data), esc(v.codigo), esc(v.cliente), badge('vist', v.resultado)]), 'Nenhuma vistoria.')}
      </div>
      ${d.alerta ? `<div class="infoBox"><strong>ⓘ &nbsp; Lembrete</strong><br><br>O extintor ${esc(d.alerta)} está em não conformidade. Verifique o motivo e registre a manutenção.</div>` : ''}`;

    cont.addEventListener('click', async (e) => {
      const ir = e.target.closest('[data-ir]');
      if (ir) { location.hash = '#' + ir.dataset.ir; return; }
      const ac = e.target.closest('[data-acao]');
      if (ac) {
        if (ac.dataset.acao === 'novoext') { location.hash = '#extintores?novo'; return; }
        const ok = ac.dataset.acao === 'vistoria' ? await formVistoria() : await formManutencao();
        if (ok) { Ex.toast('Registrado com sucesso.'); Ex.recarregarPagina(); }
        return;
      }
      const rp = e.target.closest('[data-rapido]');
      if (rp) {
        const codigo = rp.dataset.codigo;
        if (rp.dataset.rapido === 'conforme') {
          if (!(await Ex.confirmar(`Registrar ${codigo} como CONFORME?`, { textoOk: 'Registrar' }))) return;
          try { await api('/vistorias', { method: 'POST', body: { codigo, resultado: 'conforme' } }); Ex.toast('Vistoria registrada.'); Ex.recarregarPagina(); }
          catch (err) { Ex.toast(err.message, true); }
        } else if (await formVistoria({ codigo, resultado: 'nao_conforme' })) { Ex.toast('Vistoria registrada.'); Ex.recarregarPagina(); }
      }
    });
  }

  /* ---------------------------------------------------------
     VISTORIAS
  --------------------------------------------------------- */
  function vistorias(cont) {
    Ex.lista(cont, {
      filtros: [
        { nome: 'q', tipo: 'busca', placeholder: 'Extintor ou cliente' },
        { nome: 'resultado', tipo: 'select', opcoes: Ex.opcoesDe('vist'), todos: 'Todos os resultados' },
      ],
      botoes: [{ texto: '+ Registrar vistoria', classe: 'btn-verde', aoClicar: async (c) => { if (await formVistoria()) { Ex.toast('Vistoria registrada.'); c.recarregar(); } } }],
      carregar: (p) => api('/vistorias', { params: p }),
      colunas: [
        { t: 'Data', f: (l) => fmtData(l.data) },
        { t: 'Extintor', f: (l, i) => `<button class="link" data-acao="ver" data-i="${i}"><strong>${esc(l.codigo)}</strong></button>` },
        { t: 'Cliente', f: (l) => esc(l.cliente) },
        { t: 'Operador', f: (l) => esc(l.operador || '—') },
        { t: 'Resultado', f: (l) => badge('vist', l.resultado) },
        { t: 'Observação', f: (l) => esc(l.observacao || '') },
      ],
      aoAcao: async (acao, l) => {
        if (acao === 'ver') { const e = await api('/extintores', { params: { q: l.codigo, limit: 1 } }); if (e.itens[0]) Ex.verExtintor('operador', e.itens[0].id); }
      },
    });
  }

  /* ---------------------------------------------------------
     MANUTENÇÕES
  --------------------------------------------------------- */
  function manutencoes(cont) {
    Ex.lista(cont, {
      filtros: [
        { nome: 'q', tipo: 'busca', placeholder: 'Extintor ou cliente' },
        { nome: 'tipo', tipo: 'select', opcoes: Ex.TIPOS_MANUT, todos: 'Todos os tipos' },
      ],
      botoes: [{ texto: '+ Registrar manutenção', aoClicar: async (c) => { if (await formManutencao()) { Ex.toast('Manutenção registrada.'); c.recarregar(); } } }],
      carregar: (p) => api('/manutencoes', { params: p }),
      colunas: [
        { t: 'Data', f: (l) => fmtData(l.data) },
        { t: 'Extintor', f: (l) => `<strong>${esc(l.codigo)}</strong>` },
        { t: 'Cliente', f: (l) => esc(l.cliente) },
        { t: 'Tipo', f: (l) => esc(l.tipo) },
        { t: 'Descrição', f: (l) => esc(l.descricao || '') },
        { t: 'Custo', classe: 'num nowrap', f: (l) => Ex.moeda(l.custo) || '—' },
        { t: 'Operador', f: (l) => esc(l.operador || '—') },
      ],
    });
  }

  /* ---------------------------------------------------------
     ORDENS DE SERVIÇO
  --------------------------------------------------------- */
  function os(cont) {
    Ex.lista(cont, {
      filtros: [
        { nome: 'q', tipo: 'busca', placeholder: 'Nº da OS ou cliente' },
        { nome: 'status', tipo: 'select', opcoes: Ex.opcoesDe('os'), todos: 'Todos os status' },
        { nome: 'tipo', tipo: 'select', opcoes: Ex.TIPOS_OS, todos: 'Todos os tipos' },
      ],
      carregar: (p) => api('/os', { params: p }),
      colunas: [
        { t: 'Nº OS', f: (l) => `<strong>${esc(l.numero)}</strong>` },
        { t: 'Cliente', f: (l) => esc(l.cliente) },
        { t: 'Tipo', f: (l) => esc(l.tipo) },
        { t: 'Extintores', f: (l) => esc(l.extintores_codigos || '—') },
        { t: 'Data', f: (l) => fmtData(l.data) },
        { t: 'Descrição', f: (l) => esc(l.descricao || '') },
        { t: 'Status', f: (l) => badge('os', l.status) },
      ],
      acoes: (l) => [
        ...(l.status === 'pendente' ? [{ rotulo: 'Iniciar', acao: 'em_andamento' }] : []),
        ...(l.status !== 'concluida' ? [{ rotulo: 'Concluir', acao: 'concluida', classe: 'btn-verde' }] : []),
        ...(l.status === 'concluida' ? [{ rotulo: 'Reabrir', acao: 'pendente' }] : []),
      ],
      aoAcao: async (novoStatus, l, c) => {
        try { await api(`/os/${l.id}/status`, { method: 'PUT', body: { status: novoStatus } }); Ex.toast(`${l.numero}: ${Ex.rotulo('os', novoStatus)}.`); c.recarregar(); }
        catch (e) { Ex.toast(e.message, true); }
      },
    });
  }

  /* ---------------------------------------------------------
     EXTINTORES (consulta)
  --------------------------------------------------------- */
  async function extintores(cont, { query }) {
    const op = await api('/opcoes');
    async function novo(recarregar) {
      let sel;
      const ok = await Ex.formModal({
        titulo: 'Novo extintor', largo: true,
        valores: { status: 'em_dia', ...Ex.valoresLocalizacao(null) },
        aoMontar: (form, m) => {
          Ex.aoMontarLocalizacao(form, m); sel = Ex.seletorFoto(form, { rotulo: 'Foto do extintor (opcional)' });
          Ex.botaoNovoCliente(form.elements.cliente_id, 'operador');
        },
        campos: [
          { nome: 'codigo', rotulo: 'Código', max: 20, maiusculas: true, placeholder: 'Automático', ajuda: 'Em branco = gera EXT-### automaticamente.' },
          { nome: 'cliente_id', rotulo: 'Cliente', tipo: 'select', obrig: true, opcoes: op.clientes.map((c) => ({ v: c.id, t: c.nome })) },
          { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', obrig: true, opcoes: Ex.TIPOS_EXT },
          { nome: 'capacidade', rotulo: 'Capacidade', max: 30, placeholder: 'Ex.: 6 kg' },
          { nome: 'status', rotulo: 'Status', tipo: 'select', obrig: true, opcoes: Ex.opcoesDe('ext') },
          { nome: 'proxima_vistoria', rotulo: 'Próxima vistoria', tipo: 'date' },
          ...Ex.camposLocalizacao(),
        ],
        salvar: (v) => api('/extintores', { method: 'POST', body: { ...v, imagem: sel.obter() || undefined } }),
      });
      if (ok) { Ex.toast('Extintor cadastrado.'); recarregar(); }
    }
    const lista = Ex.lista(cont, {
      botoes: [{ texto: '+ Novo extintor', aoClicar: (c) => novo(c.recarregar) }],
      filtros: [
        { nome: 'q', tipo: 'busca', placeholder: 'Código, cliente ou local' },
        { nome: 'status', tipo: 'select', opcoes: Ex.opcoesDe('ext'), todos: 'Todos os status' },
        { nome: 'tipo', tipo: 'select', opcoes: Ex.TIPOS_EXT, todos: 'Todos os tipos' },
      ],
      carregar: (p) => api('/extintores', { params: p }),
      colunas: [
        { t: 'Código', f: (l, i) => `<button class="link" data-acao="ver" data-i="${i}"><strong>${esc(l.codigo)}</strong></button>` },
        { t: 'Cliente', f: (l) => esc(l.cliente) },
        { t: 'Tipo', f: (l) => esc(l.tipo) },
        { t: 'Local / endereço', f: (l) => `${esc(l.local || '—')}<div class="mudo" style="font-size:11px">${esc(l.endereco_texto || 'Sem endereço')}${l.endereco_proprio ? '' : ' (do cliente)'}</div>` },
        { t: 'Status', f: (l) => badge('ext', l.status) },
        { t: 'Próx. vistoria', f: (l) => fmtData(l.proxima_vistoria) || '—' },
        { t: 'Fotos', classe: 'num', f: (l, i) => `<button class="link" data-acao="ver" data-i="${i}">${l.fotos}</button>` },
      ],
      acoes: () => [{ rotulo: 'Vistoria', acao: 'vistoria', classe: 'btn-verde' }, { rotulo: 'Manutenção', acao: 'manutencao' }, { rotulo: 'Localização', acao: 'localizacao' }],
      aoAcao: async (acao, l, c) => {
        if (acao === 'ver') return Ex.verExtintor('operador', l.id);
        if (acao === 'localizacao') {
          const ok = await Ex.formModal({
            titulo: `Localização de ${l.codigo}`, largo: true, valores: Ex.valoresLocalizacao(l), campos: Ex.camposLocalizacao(),
            aoMontar: Ex.aoMontarLocalizacao,
            salvar: (v) => api(`/extintores/${l.id}/localizacao`, { method: 'PUT', body: v }),
          });
          if (ok) { Ex.toast('Localização atualizada.'); c.recarregar(); }
          return;
        }
        const ok = acao === 'vistoria' ? await formVistoria({ codigo: l.codigo }) : await formManutencao({ codigo: l.codigo });
        if (ok) { Ex.toast('Registrado com sucesso.'); c.recarregar(); }
      },
    });
    if (query.has('novo')) novo(lista.recarregar);
  }

  /* ---------------------------------------------------------
     CLIENTES (consulta)
  --------------------------------------------------------- */
  function clientes(cont, { query }) {
    const novo = async (c) => { if (await Ex.novoCliente('operador')) { Ex.toast('Cliente cadastrado.'); c.recarregar(); } };
    const lista = Ex.lista(cont, {
      filtros: [{ nome: 'q', tipo: 'busca', placeholder: 'Nome, cidade, telefone ou e-mail' }],
      botoes: [{ texto: '+ Novo cliente', aoClicar: novo }],
      carregar: (p) => api('/clientes', { params: p }),
      colunas: [
        { t: 'Nome', f: (l, i) => `<button class="link" data-acao="ver" data-i="${i}"><strong>${esc(l.nome)}</strong></button>` },
        { t: 'Telefone', f: (l) => esc(l.telefone || '—') },
        { t: 'Endereço fixo', f: (l) => esc(l.endereco_texto || '—') },
        { t: 'Extintores', classe: 'num', f: (l) => l.extintores },
      ],
      aoAcao: (acao, l) => { if (acao === 'ver') Ex.verCliente('operador', l.id); },
    });
    if (query.has('novo')) novo(lista);
  }

  /* ---------------------------------------------------------
     FOTOS
  --------------------------------------------------------- */
  const formFoto = () => Ex.formFoto({
    titulo: 'Enviar foto do serviço',
    extras: [
      { nome: 'codigo', rotulo: 'Extintor (opcional)', max: 20, maiusculas: true, placeholder: 'EXT-001' },
      { nome: 'os', rotulo: 'Nº da OS (opcional)', max: 12, maiusculas: true, placeholder: 'OS-0048' },
    ],
    aoMontar: (form) => Ex.autocompleteExtintor('operador', form.elements.codigo),
    salvar: (v, imagem) => api('/fotos', { method: 'POST', body: { imagem, codigo: v.codigo, os: v.os, descricao: v.descricao } }),
  });
  async function fotos(cont, { sessao, query }) {
    let page = 1;
    cont.innerHTML = `<div class="toolbar"><span class="contagem" id="ft-cont"></span><span class="espaco"></span><button class="btn btn-primario" id="ft-nova">+ Enviar foto</button></div>
      <div class="box"><div id="ft-grade"></div><div id="ft-pag"></div></div>`;
    const grade = cont.querySelector('#ft-grade'), pag = cont.querySelector('#ft-pag');
    let itens = [];
    async function carregar() {
      grade.innerHTML = '<div class="carregando-pag">Carregando…</div>';
      try {
        const d = await api('/fotos', { params: { page, limit: 12 } });
        itens = d.itens;
        grade.innerHTML = itens.length ? `<div class="galeria">${itens.map((f, i) => `<div class="foto-card">
            <img src="${f.imagem}" alt="${esc(f.descricao || 'Foto do serviço')}" data-ampliar="${i}">
            <div class="info"><strong>${esc(f.descricao || 'Sem descrição')}</strong>
              ${f.codigo ? `Extintor ${esc(f.codigo)}<br>` : ''}${f.os ? `${esc(f.os)}<br>` : ''}${fmtData(f.data)} · ${esc(f.operador || '')}
              ${f.operador_id === sessao.id ? `<div style="margin-top:6px"><button class="btn btn-sm btn-perigo" data-excluir="${i}">Excluir</button></div>` : ''}</div></div>`).join('')}</div>`
          : '<div class="aviso-vazio">Nenhuma foto enviada ainda.</div>';
        pag.innerHTML = Ex.paginacaoHTML(d);
      } catch (e) { grade.innerHTML = `<div class="aviso-vazio">${esc(e.message)}</div>`; }
    }
    async function enviar() { if (await formFoto()) { Ex.toast('Foto enviada.'); page = 1; carregar(); } }
    cont.querySelector('#ft-nova').onclick = enviar;
    cont.addEventListener('click', async (e) => {
      const pg = e.target.closest('[data-pag]');
      if (pg && !pg.disabled) { page = Number(pg.dataset.pag); carregar(); return; }
      const am = e.target.closest('[data-ampliar]');
      if (am) {
        const f = itens[Number(am.dataset.ampliar)];
        Ex.modal({ titulo: f.descricao || 'Foto', largo: true, corpo: `<img src="${f.imagem}" alt="" style="max-width:100%;border-radius:6px">`, botoes: [{ texto: 'Fechar', aoClicar: (m) => m.fechar() }] });
        return;
      }
      const ex = e.target.closest('[data-excluir]');
      if (ex) {
        const f = itens[Number(ex.dataset.excluir)];
        if (!(await Ex.confirmar('Excluir esta foto?', { textoOk: 'Excluir', perigo: true }))) return;
        try { await api(`/fotos/${f.id}`, { method: 'DELETE' }); Ex.toast('Foto excluída.'); carregar(); }
        catch (err) { Ex.toast(err.message, true); }
      }
    });
    await carregar();
    if (query.has('nova')) enviar();
  }

  Ex.app({ perfil: 'operador', paginas: { inicio, vistorias, manutencoes, os, extintores, clientes, fotos } });
})();
