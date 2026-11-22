/* ==========================================================
   Painel do GERENTE - todas as abas
   Menu: Início · Extintores · Clientes · Ordens de Serviço ·
         Relatórios · Funcionários · Veículos · Configurações
   ========================================================== */
(function () {
  'use strict';
  const { esc, fmtData, badge } = Ex;
  const opcoesCliente = (op) => op.clientes.map((c) => ({ v: c.id, t: c.nome }));

  const salvou = (msg, recarregar) => { Ex.toast(msg); if (recarregar) recarregar(); };
  const verbo = (editar) => (editar ? 'atualizado' : 'cadastrado');

  /* ---------------------------------------------------------
     INÍCIO
  --------------------------------------------------------- */
  async function inicio(cont, { sessao, api }) {
    const d = await api('/dashboard');
    const dt = Ex.dataExtensa();
    const a = d.total ? (d.em_dia / d.total) * 100 : 0;
    const b = d.total ? ((d.em_dia + d.em_atraso) / d.total) * 100 : 0;
    cont.innerHTML = `
      <div class="titulo">
        <div class="saudar"><h2>Olá, ${esc(sessao.nome.split(' ')[0])}!</h2><p>Aqui está o resumo do sistema hoje.</p></div>
        <p>${dt.dia}<br>${dt.semana}</p>
      </div>
      <div class="cards quatro">
        <div data-ir="extintores" class="link-card">${Ex.card({ icone: '▣', cor: 'vermelho', titulo: 'Total de Extintores', valor: d.total, info: 'Em todas as unidades' })}</div>
        <div data-ir="extintores">${Ex.card({ icone: '✓', cor: 'verde', titulo: 'Em Dia', valor: d.em_dia, info: Ex.pct(d.em_dia, d.total) + ' do total' })}</div>
        <div data-ir="extintores">${Ex.card({ icone: '⚠', cor: 'amarelo', titulo: 'Em Atraso', valor: d.em_atraso, info: Ex.pct(d.em_atraso, d.total) + ' do total' })}</div>
        <div data-ir="relatorios">${Ex.card({ icone: '▣', cor: 'azul', titulo: 'Próximas Vistorias', valor: d.proximas_vistorias, info: `Nos próximos ${d.dias} dias` })}</div>
      </div>
      <div class="grade-2">
        <div class="box">
          <div class="boxTitulo">Status dos Extintores</div>
          <div class="grafico">
            <div class="donut" style="background:conic-gradient(#16a36d 0 ${a}%, #f5aa16 ${a}% ${b}%, #68778a ${b}% 100%)">
              <div class="donutTexto"><span>${d.total}</span><span>Total</span></div>
            </div>
            <div class="legenda">
              <div><span class="bola" style="background:#16a36d"></span>Em dia &nbsp; ${d.em_dia} (${Ex.pct(d.em_dia, d.total)})</div>
              <div><span class="bola" style="background:#f5aa16"></span>Em atraso &nbsp; ${d.em_atraso} (${Ex.pct(d.em_atraso, d.total)})</div>
              <div><span class="bola" style="background:#68778a"></span>Inativo &nbsp; ${d.inativo} (${Ex.pct(d.inativo, d.total)})</div>
            </div>
          </div>
        </div>
        <div class="box">
          <div class="boxTitulo">Ordens em aberto</div>
          <div class="cardNumero" style="font-size:34px;margin:14px 0 4px">${d.os_abertas}</div>
          <div class="mudo" style="font-size:12px">pendentes ou em andamento</div>
          <div style="margin-top:14px"><button class="btn btn-primario" data-ir="os">Ver ordens de serviço</button></div>
        </div>
      </div>
      <div class="box">
        <div class="boxTitulo">Ordens de Serviço Recentes <span class="verTodos link" data-ir="os">Ver todas</span></div>
        ${Ex.tabelaSimples(['Nº OS', 'Cliente', 'Tipo', 'Status', 'Data'], d.ordens_recentes.map((o) => [esc(o.numero), esc(o.cliente), esc(o.tipo), badge('os', o.status), fmtData(o.data)]), 'Nenhuma ordem de serviço.')}
      </div>
      <div class="box">
        <div class="boxTitulo">Vencimentos (próximos ${d.dias} dias) <span class="verTodos link" data-ir="relatorios">Ver relatório</span></div>
        ${Ex.tabelaSimples(['Extintor', 'Cliente', 'Vistoria em'], d.vencimentos.map((v) => [esc(v.codigo), esc(v.cliente), fmtData(v.data)]), 'Nenhum vencimento no período.')}
      </div>
      <div class="botoesInferiores">
        <div class="botaoInferior" data-ir="clientes?novo"><span>♟</span>Novo Cliente<br><small>Cadastrar um cliente</small></div>
        <div class="botaoInferior" data-ir="os?novo"><span>▣</span>Nova OS<br><small>Criar ordem de serviço</small></div>
        <div class="botaoInferior" data-ir="relatorios"><span>▤</span>Relatórios<br><small>Gerar relatórios</small></div>
      </div>`;
    cont.addEventListener('click', (e) => {
      const alvo = e.target.closest('[data-ir]');
      if (alvo) location.hash = '#' + alvo.dataset.ir;
    });
  }

  /* ---------------------------------------------------------
     EXTINTORES
  --------------------------------------------------------- */
  async function extintores(cont, { api, query }) {
    const op = await api('/opcoes');
    async function form(linha, recarregar) {
      const editar = !!linha;
      let sel;
      const ok = await Ex.formModal({
        titulo: editar ? `Editar ${linha.codigo}` : 'Novo extintor', largo: true,
        valores: editar ? { ...linha, ...Ex.valoresLocalizacao(linha) } : { status: 'em_dia', ...Ex.valoresLocalizacao(null) },
        aoMontar: (form, m) => { Ex.aoMontarLocalizacao(form, m); Ex.botaoNovoCliente(form.elements.cliente_id, 'gerente'); if (!editar) sel = Ex.seletorFoto(form, { rotulo: 'Foto do extintor (opcional)' }); },
        campos: [
          { nome: 'codigo', rotulo: 'Código', max: 20, leitura: editar, maiusculas: true, placeholder: 'Automático', ajuda: editar ? '' : 'Em branco = gera EXT-### automaticamente.' },
          { nome: 'cliente_id', rotulo: 'Cliente', tipo: 'select', obrig: true, opcoes: opcoesCliente(op) },
          { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', obrig: true, opcoes: Ex.TIPOS_EXT },
          { nome: 'capacidade', rotulo: 'Capacidade', max: 30, placeholder: 'Ex.: 6 kg' },
          { nome: 'status', rotulo: 'Status', tipo: 'select', obrig: true, opcoes: Ex.opcoesDe('ext') },
          { nome: 'proxima_vistoria', rotulo: 'Próxima vistoria', tipo: 'date' },
          ...Ex.camposLocalizacao(),
        ],
        salvar: (v) => api(editar ? `/extintores/${linha.id}` : '/extintores', { method: editar ? 'PUT' : 'POST', body: editar ? v : { ...v, imagem: sel.obter() || undefined } }),
      });
      if (ok) salvou(`Extintor ${verbo(editar)}.`, recarregar);
    }
    const lista = Ex.lista(cont, {
      filtros: [
        { nome: 'q', tipo: 'busca', placeholder: 'Código, cliente ou local' },
        { nome: 'status', tipo: 'select', opcoes: Ex.opcoesDe('ext'), todos: 'Todos os status' },
        { nome: 'tipo', tipo: 'select', opcoes: Ex.TIPOS_EXT, todos: 'Todos os tipos' },
        { nome: 'cliente_id', tipo: 'select', opcoes: opcoesCliente(op), todos: 'Todos os clientes' },
      ],
      botoes: [{ texto: '+ Novo extintor', aoClicar: (c) => form(null, c.recarregar) }],
      carregar: (p) => api('/extintores', { params: p }),
      colunas: [
        { t: 'Código', f: (l, i) => `<button class="link" data-acao="ver" data-i="${i}"><strong>${esc(l.codigo)}</strong></button>` },
        { t: 'Cliente', f: (l) => esc(l.cliente) },
        { t: 'Tipo', f: (l) => esc(l.tipo) },
        { t: 'Capacidade', f: (l) => esc(l.capacidade || '—') },
        { t: 'Local / endereço', f: (l) => `${esc(l.local || '—')}<div class="mudo" style="font-size:11px">${esc(l.endereco_texto || 'Sem endereço')}${l.endereco_proprio ? '' : ' (do cliente)'}</div>` },
        { t: 'Status', f: (l) => badge('ext', l.status) },
        { t: 'Próx. vistoria', f: (l) => fmtData(l.proxima_vistoria) || '—' },
        { t: 'Fotos', classe: 'num', f: (l, i) => `<button class="link" data-acao="ver" data-i="${i}">${l.fotos}</button>` },
      ],
      acoes: () => [{ rotulo: 'Editar', acao: 'editar' }, { rotulo: 'Excluir', acao: 'excluir', classe: 'btn-perigo' }],
      aoAcao: async (acao, l, c) => {
        if (acao === 'ver') return Ex.verExtintor('gerente', l.id);
        if (acao === 'editar') return form(l, c.recarregar);
        if (acao === 'excluir') {
          if (!(await Ex.confirmar(`Excluir o extintor ${l.codigo}? Todo o histórico dele (vistorias, manutenções e fotos) também será apagado. Isso não pode ser desfeito.`, { textoOk: 'Excluir', perigo: true }))) return;
          try {
            await api(`/extintores/${l.id}`, { method: 'DELETE' });
            salvou('Extintor excluído.', c.recarregar);
          } catch (e) { Ex.toast(e.message, true); }
        }
      },
    });
    if (query.has('novo')) form(null, lista.recarregar);
  }

  /* ---------------------------------------------------------
     CLIENTES
  --------------------------------------------------------- */
  async function clientes(cont, { api, query }) {
    async function form(linha, recarregar) {
      const editar = !!linha;
      const ok = await Ex.formModal({
        titulo: editar ? 'Editar cliente' : 'Novo cliente', valores: linha || {}, largo: true,
        introHTML: '<h4 style="margin:0 0 8px">Dados do cliente</h4>',
        aoMontar: Ex.viaCep,
        campos: [
          { nome: 'nome', rotulo: 'Nome', obrig: true, max: 100, largura: 'cheio' },
          { nome: 'telefone', rotulo: 'Telefone', tipo: 'tel', max: 30, placeholder: '(11) 99999-9999' },
          { nome: 'email', rotulo: 'E-mail', tipo: 'email', max: 100 },
          ...Ex.camposEndereco(),
        ],
        salvar: (v) => api(editar ? `/clientes/${linha.id}` : '/clientes', { method: editar ? 'PUT' : 'POST', body: v }),
      });
      if (ok) salvou(`Cliente ${verbo(editar)}.`, recarregar);
    }
    const lista = Ex.lista(cont, {
      filtros: [{ nome: 'q', tipo: 'busca', placeholder: 'Nome, cidade, telefone ou e-mail' }],
      botoes: [{ texto: '+ Novo cliente', aoClicar: (c) => form(null, c.recarregar) }],
      carregar: (p) => api('/clientes', { params: p }),
      colunas: [
        { t: 'Nome', f: (l, i) => `<button class="link" data-acao="ver" data-i="${i}"><strong>${esc(l.nome)}</strong></button>` },
        { t: 'Telefone', f: (l) => esc(l.telefone || '—') },
        { t: 'E-mail', f: (l) => esc(l.email || '—') },
        { t: 'Endereço fixo', f: (l) => esc(l.endereco_texto || '—') },
        { t: 'Extintores', classe: 'num', f: (l) => l.extintores },
        { t: 'OS', classe: 'num', f: (l) => l.os },
      ],
      acoes: () => [{ rotulo: 'Editar', acao: 'editar' }, { rotulo: 'Excluir', acao: 'excluir', classe: 'btn-perigo' }],
      aoAcao: async (acao, l, c) => {
        if (acao === 'ver') return Ex.verCliente('gerente', l.id);
        if (acao === 'editar') return form(l, c.recarregar);
        if (acao === 'excluir') {
          if (!(await Ex.confirmar(`Excluir o cliente "${l.nome}"? Os extintores dele (com histórico), as ordens de serviço e os comprovantes também serão apagados. Isso não pode ser desfeito.`, { textoOk: 'Excluir', perigo: true }))) return;
          try { await api(`/clientes/${l.id}`, { method: 'DELETE' }); salvou('Cliente excluído.', c.recarregar); }
          catch (e) { Ex.toast(e.message, true); }
        }
      },
    });
    if (query.has('novo')) form(null, lista.recarregar);
  }

  /* ---------------------------------------------------------
     ORDENS DE SERVIÇO
  --------------------------------------------------------- */
  async function os(cont, { api, query }) {
    const op = await api('/opcoes');
    async function form(linha, recarregar) {
      const editar = !!linha;
      const extSel = new Set((linha && linha.extintores_codigos ? linha.extintores_codigos.split(',') : []).map((x) => x.trim()).filter(Boolean));
      const ok = await Ex.formModal({
        titulo: editar ? `Editar ${linha.numero}` : 'Nova ordem de serviço', largo: true,
        valores: linha ? { ...linha, extintores: linha.extintores_codigos || '' } : { status: 'pendente', data: Ex.hoje() },
        campos: [
          { nome: 'cliente_id', rotulo: 'Cliente', tipo: 'select', obrig: true, opcoes: opcoesCliente(op) },
          { nome: 'tipo', rotulo: 'Tipo de serviço', tipo: 'select', obrig: true, opcoes: Ex.TIPOS_OS },
          { nome: 'data', rotulo: 'Data', tipo: 'date', obrig: true },
          { nome: 'status', rotulo: 'Status', tipo: 'select', obrig: true, opcoes: Ex.opcoesDe('os') },
          { nome: 'hora_inicio', rotulo: 'Hora inicial', tipo: 'time' },
          { nome: 'hora_fim', rotulo: 'Hora final', tipo: 'time' },
          { nome: 'motorista_id', rotulo: 'Motorista', tipo: 'select', opcoes: op.motoristas.map((m) => ({ v: m.id, t: m.nome })) },
          { nome: 'veiculo_id', rotulo: 'Veículo', tipo: 'select', opcoes: op.veiculos.map((v) => ({ v: v.id, t: `${v.placa} · ${v.modelo}` })) },
          { nome: 'ordem_rota', rotulo: 'Ordem na rota', tipo: 'number', min: 1, max: 99, ajuda: 'Em branco = última da rota do dia.' },
          { nome: 'descricao', rotulo: 'Descrição / observações', tipo: 'textarea', max: 300, largura: 'cheio' },
        ],
        aoMontar: (form) => {
          const selecionados = extSel;
          const caixa = document.createElement('div');
          caixa.className = 'cheio';
          caixa.innerHTML = `<label>Extintores da OS</label>
            <div class="ext-seletor" style="border:1px solid #d5dae1;border-radius:6px;max-height:180px;overflow:auto;padding:6px 10px;background:#fff"></div>
            <div class="ajuda">Opcional. Só aparecem os extintores do cliente escolhido; definem o destino da entrega (o endereço de cada um).</div>`;
          (form.querySelector('.form-grid') || form).appendChild(caixa);
          const area = caixa.querySelector('.ext-seletor'), selCliente = form.elements.cliente_id;
          const aviso = (t) => { area.innerHTML = `<div class="mudo" style="padding:6px 0">${t}</div>`; };
          const pinta = (lista) => {
            if (!lista.length) return aviso('Este cliente não tem extintores cadastrados.');
            area.innerHTML = lista.map((e) => `<label style="display:flex;gap:8px;align-items:center;margin:4px 0;font-weight:normal;cursor:pointer">
              <input type="checkbox" value="${esc(e.codigo)}"${selecionados.has(e.codigo) ? ' checked' : ''} style="width:auto"> <strong>${esc(e.codigo)}</strong>
              <span class="mudo">${esc(e.tipo)}${e.local ? ' · ' + esc(e.local) : ''}</span></label>`).join('');
            area.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => { if (i.checked) selecionados.add(i.value); else selecionados.delete(i.value); }));
          };
          let tok = 0;
          async function carregar() {
            const cid = selCliente.value, meu = ++tok;
            if (!cid) { aviso('⚠ Selecione o cliente primeiro.'); return; }
            aviso('Carregando extintores…');
            try {
              let todos = [], pg = 1, paginas = 1;
              do { const d = await api('/extintores', { params: { cliente_id: cid, limit: 100, page: pg } }); todos = todos.concat(d.itens); paginas = d.paginas; pg++; } while (pg <= paginas);
              if (meu !== tok) return;
              const codigos = new Set(todos.map((e) => e.codigo));
              [...selecionados].forEach((c) => { if (!codigos.has(c)) selecionados.delete(c); });   // mudou de cliente: tira os que não são dele
              pinta(todos);
            } catch (e) { if (meu === tok) aviso(esc(e.message)); }
          }
          selCliente.addEventListener('change', carregar);
          area.addEventListener('click', () => { if (!selCliente.value) { Ex.toast('Selecione o cliente primeiro para escolher os extintores.', true); selCliente.focus(); } });
          carregar();
        },
        salvar: (v) => api(editar ? `/os/${linha.id}` : '/os', { method: editar ? 'PUT' : 'POST', body: { ...v, extintores: [...extSel].join(', ') } }),
      });
      if (ok) salvou(`Ordem de serviço ${verbo(editar)}.`, recarregar);
    }
    const lista = Ex.lista(cont, {
      filtros: [
        { nome: 'q', tipo: 'busca', placeholder: 'Nº da OS ou cliente' },
        { nome: 'status', tipo: 'select', opcoes: Ex.opcoesDe('os'), todos: 'Todos os status' },
        { nome: 'tipo', tipo: 'select', opcoes: Ex.TIPOS_OS, todos: 'Todos os tipos' },
        { nome: 'data', tipo: 'data', placeholder: 'Data' },
      ],
      botoes: [{ texto: '+ Nova OS', aoClicar: (c) => form(null, c.recarregar) }],
      carregar: (p) => api('/os', { params: p }),
      colunas: [
        { t: 'Nº OS', f: (l) => `<strong>${esc(l.numero)}</strong>` },
        { t: 'Cliente', f: (l) => esc(l.cliente) },
        { t: 'Tipo', f: (l) => esc(l.tipo) },
        { t: 'Extintores', f: (l) => esc(l.extintores_codigos || '—') },
        { t: 'Data', f: (l) => fmtData(l.data) },
        { t: 'Horário', classe: 'nowrap', f: (l) => (l.hora_inicio ? `${esc(l.hora_inicio)} - ${esc(l.hora_fim || '')}` : '—') },
        { t: 'Motorista', f: (l) => esc(l.motorista || '—') },
        { t: 'Veículo', f: (l) => esc(l.veiculo || '—') },
        { t: 'Status', f: (l) => badge('os', l.status) },
      ],
      acoes: () => [{ rotulo: 'Editar', acao: 'editar' }, { rotulo: 'Excluir', acao: 'excluir', classe: 'btn-perigo' }],
      aoAcao: async (acao, l, c) => {
        if (acao === 'editar') return form(l, c.recarregar);
        if (acao === 'excluir') {
          if (!(await Ex.confirmar(`Excluir a ${l.numero}? O comprovante de entrega (se houver) também será removido.`, { textoOk: 'Excluir', perigo: true }))) return;
          try { await api(`/os/${l.id}`, { method: 'DELETE' }); salvou('Ordem de serviço excluída.', c.recarregar); }
          catch (e) { Ex.toast(e.message, true); }
        }
      },
    });
    if (query.has('novo')) form(null, lista.recarregar);
  }

  /* ---------------------------------------------------------
     RELATÓRIOS
  --------------------------------------------------------- */
  const RELATORIOS = [
    { v: 'extintores', t: 'Extintores (situação)', periodo: false, status: true },
    { v: 'os', t: 'Ordens de serviço', periodo: true },
    { v: 'vistorias', t: 'Vistorias realizadas', periodo: true },
    { v: 'vencimentos', t: 'Vencimentos de vistoria', periodo: true, futuro: true },
    { v: 'manutencoes', t: 'Manutenções e custos', periodo: true },
    { v: 'clientes', t: 'Resumo por cliente', periodo: false },
  ];
  async function relatorios(cont, { api }) {
    cont.innerHTML = `
      <div class="titulo"><div><h2>Relatórios</h2><p class="sub">Escolha o relatório, o período e gere. Você pode exportar em CSV ou imprimir.</p></div></div>
      <div class="toolbar">
        <select id="rel-tipo">${RELATORIOS.map((r) => `<option value="${r.v}">${esc(r.t)}</option>`).join('')}</select>
        <label class="mudo" data-per>De <input type="date" id="rel-de"></label>
        <label class="mudo" data-per>até <input type="date" id="rel-ate"></label>
        <select id="rel-status" style="display:none"><option value="">Todos os status</option>${Ex.opcoesDe('ext').map((o) => `<option value="${o.v}">${esc(o.t)}</option>`).join('')}</select>
        <button class="btn btn-primario" id="rel-gerar">Gerar</button>
        <span class="espaco"></span>
        <button class="btn" id="rel-csv" disabled>CSV</button>
        <button class="btn" id="rel-print" disabled>Imprimir</button>
      </div>
      <div class="box" id="rel-saida"><div class="aviso-vazio">Escolha as opções e clique em <strong>Gerar</strong>.</div></div>`;
    const $ = (id) => cont.querySelector('#' + id);
    let ultimo = null, tipoAtual = null;

    function ajustaCampos() {
      const r = RELATORIOS.find((x) => x.v === $('rel-tipo').value);
      cont.querySelectorAll('[data-per]').forEach((e) => { e.style.display = r.periodo ? '' : 'none'; });
      $('rel-status').style.display = r.status ? '' : 'none';
      $('rel-de').value = r.futuro ? Ex.hoje() : Ex.somaDias(-30);
      $('rel-ate').value = r.futuro ? Ex.somaDias(30) : Ex.hoje();
    }
    $('rel-tipo').addEventListener('change', ajustaCampos);
    ajustaCampos();

    async function gerar() {
      const r = RELATORIOS.find((x) => x.v === $('rel-tipo').value);
      const saida = $('rel-saida');
      saida.innerHTML = '<div class="carregando-pag">Gerando…</div>';
      try {
        const d = await api('/relatorios/' + r.v, { params: { de: r.periodo ? $('rel-de').value : '', ate: r.periodo ? $('rel-ate').value : '', status: r.status ? $('rel-status').value : '' } });
        ultimo = d; tipoAtual = r.v;
        saida.innerHTML = `<div class="boxTitulo">${esc(d.titulo)}</div>
          <div class="rel-resumo">${d.resumo.map((x) => `<div>${esc(x.rotulo)}<strong>${esc(x.valor)}</strong></div>`).join('')}</div>
          ${Ex.tabelaSimples(d.colunas, d.linhas.map((l) => l.map((c) => esc(c))), 'Nenhum registro no período.')}`;
        $('rel-csv').disabled = $('rel-print').disabled = false;
      } catch (e) { saida.innerHTML = `<div class="aviso-vazio">${esc(e.message)}</div>`; ultimo = null; }
    }
    $('rel-gerar').addEventListener('click', gerar);
    $('rel-csv').addEventListener('click', () => { if (ultimo) Ex.csv(`relatorio-${tipoAtual}-${Ex.hoje()}.csv`, ultimo.colunas, ultimo.linhas); });
    $('rel-print').addEventListener('click', () => {
      if (!ultimo) return;
      Ex.imprimir(ultimo.titulo, `<h1>Extinsul Extintores</h1><h2>${esc(ultimo.titulo)}</h2>
        <div class="linha">${ultimo.resumo.map((x) => `<span><strong>${esc(x.rotulo)}:</strong> ${esc(x.valor)}</span>`).join('')}</div>
        ${Ex.tabelaSimples(ultimo.colunas, ultimo.linhas.map((l) => l.map((c) => esc(c))))}
        <p style="margin-top:18px;color:#667085">Gerado em ${Ex.fmtData(Ex.hoje())}</p>`);
    });
    gerar();
  }

  /* ---------------------------------------------------------
     FUNCIONÁRIOS
  --------------------------------------------------------- */
  async function funcionarios(cont, { api, sessao }) {
    const meuId = sessao.id;   // para destacar "você" e esconder o botão Excluir
    async function form(linha, recarregar) {
      const editar = !!linha;
      const ok = await Ex.formModal({
        titulo: editar ? `Editar ${linha.nome}` : 'Novo funcionário',
        valores: linha ? { ...linha, ativo: !!linha.ativo } : { ativo: true },
        campos: [
          { nome: 'nome', rotulo: 'Nome', obrig: true, max: 100, largura: 'cheio' },
          { nome: 'perfil', rotulo: 'Perfil de acesso', tipo: 'select', obrig: true, opcoes: Ex.opcoesDe('perfil') },
          { nome: 'pin', rotulo: editar ? 'Novo PIN' : 'PIN de acesso', tipo: 'password', obrig: !editar, inputmode: 'numeric', max: 8, ajuda: editar ? 'Deixe em branco para manter o PIN atual.' : '4 a 8 números. Cada pessoa precisa de um PIN diferente.' },
          ...(editar ? [{ nome: 'ativo', rotulo: 'Acesso ativo', tipo: 'checkbox', largura: 'cheio' }] : []),
        ],
        aoMontar: editar ? (form) => {
          const caixa = document.createElement('div');
          caixa.className = 'cheio';
          caixa.innerHTML = '<label>PIN atual</label><div><strong class="pin-atual" style="letter-spacing:3px;font-size:16px">••••</strong> &nbsp; <button type="button" class="btn btn-sm">Mostrar</button></div>';
          form.elements.pin.closest('div').before(caixa);
          const val = caixa.querySelector('.pin-atual'), btn = caixa.querySelector('button');
          let visivel = false, pin;
          btn.onclick = async () => {
            if (visivel) { val.textContent = '••••'; btn.textContent = 'Mostrar'; visivel = false; return; }
            try {
              if (pin === undefined) pin = (await api(`/funcionarios/${linha.id}/pin`)).pin;
              val.textContent = pin || 'Não registrado ainda'; val.style.letterSpacing = pin ? '3px' : '0'; btn.textContent = 'Ocultar'; visivel = true;
              if (!pin) Ex.toast('O PIN aparece depois que a pessoa entrar no sistema ou se você definir um novo PIN.');
            } catch (e) { Ex.toast(e.message, true); }
          };
        } : undefined,
        salvar: (v) => api(editar ? `/funcionarios/${linha.id}` : '/funcionarios', { method: editar ? 'PUT' : 'POST', body: v }),
      });
      if (ok) salvou(`Funcionário ${verbo(editar)}.`, recarregar);
    }
    Ex.lista(cont, {
      filtros: [{ nome: 'q', tipo: 'busca', placeholder: 'Nome do funcionário' }],
      botoes: [{ texto: '+ Novo funcionário', aoClicar: (c) => form(null, c.recarregar) }],
      carregar: (p) => api('/funcionarios', { params: p }),
      colunas: [
        { t: 'Nome', f: (l) => `<strong>${esc(l.nome)}</strong>${l.id === meuId ? ' <span class="mudo">(você)</span>' : ''}` },
        { t: 'Perfil', f: (l) => badge('perfil', l.perfil) },
        { t: 'Situação', f: (l) => badge('ativo', l.ativo ? 1 : 0) },
      ],
      acoes: (l) => [{ rotulo: 'Editar', acao: 'editar' }, ...(l.id === meuId ? [] : [{ rotulo: 'Excluir', acao: 'excluir', classe: 'btn-perigo' }])],
      aoAcao: async (acao, l, c) => {
        if (acao === 'editar') return form(l, c.recarregar);
        if (acao === 'excluir') {
          if (!(await Ex.confirmar(`Excluir ${l.nome}? Quem tem histórico no sistema é apenas desativado.`, { textoOk: 'Excluir', perigo: true }))) return;
          try {
            const r = await api(`/funcionarios/${l.id}`, { method: 'DELETE' });
            salvou(r.inativado ? 'O funcionário possui histórico e foi desativado.' : 'Funcionário excluído.', c.recarregar);
          } catch (e) { Ex.toast(e.message, true); }
        }
      },
    });
  }

  /* ---------------------------------------------------------
     VEÍCULOS
  --------------------------------------------------------- */
  async function veiculos(cont, { api }) {
    const op = await api('/opcoes');
    async function form(linha, recarregar) {
      const editar = !!linha;
      const ok = await Ex.formModal({
        titulo: editar ? `Editar ${linha.placa}` : 'Novo veículo', valores: linha || { status: 'disponivel', km_atual: 0 },
        campos: [
          { nome: 'placa', rotulo: 'Placa', obrig: true, max: 8, maiusculas: true, placeholder: 'ABC-1D23' },
          { nome: 'modelo', rotulo: 'Modelo', obrig: true, max: 60 },
          { nome: 'ano', rotulo: 'Ano', tipo: 'number', min: 1980, max: 2100 },
          { nome: 'km_atual', rotulo: 'Quilometragem atual', tipo: 'number', min: 0 },
          { nome: 'status', rotulo: 'Situação', tipo: 'select', obrig: true, opcoes: Ex.opcoesDe('veic') },
          { nome: 'motorista_id', rotulo: 'Motorista responsável', tipo: 'select', opcoes: op.motoristas.map((m) => ({ v: m.id, t: m.nome })) },
        ],
        salvar: (v) => api(editar ? `/veiculos/${linha.id}` : '/veiculos', { method: editar ? 'PUT' : 'POST', body: v }),
      });
      if (ok) salvou(`Veículo ${verbo(editar)}.`, recarregar);
    }
    Ex.lista(cont, {
      filtros: [{ nome: 'q', tipo: 'busca', placeholder: 'Placa ou modelo' }],
      botoes: [{ texto: '+ Novo veículo', aoClicar: (c) => form(null, c.recarregar) }],
      carregar: (p) => api('/veiculos', { params: p }),
      colunas: [
        { t: 'Placa', f: (l) => `<strong>${esc(l.placa)}</strong>` },
        { t: 'Modelo', f: (l) => esc(l.modelo) },
        { t: 'Ano', f: (l) => l.ano || '—' },
        { t: 'Km', classe: 'num', f: (l) => Number(l.km_atual).toLocaleString('pt-BR') },
        { t: 'Situação', f: (l) => badge('veic', l.status) },
        { t: 'Motorista', f: (l) => esc(l.motorista || '—') },
      ],
      acoes: () => [{ rotulo: 'Editar', acao: 'editar' }, { rotulo: 'Excluir', acao: 'excluir', classe: 'btn-perigo' }],
      aoAcao: async (acao, l, c) => {
        if (acao === 'editar') return form(l, c.recarregar);
        if (acao === 'excluir') {
          if (!(await Ex.confirmar(`Excluir o veículo ${l.placa}?`, { textoOk: 'Excluir', perigo: true }))) return;
          try { await api(`/veiculos/${l.id}`, { method: 'DELETE' }); salvou('Veículo excluído.', c.recarregar); }
          catch (e) { Ex.toast(e.message, true); }
        }
      },
    });
  }

  /* ---------------------------------------------------------
     CONFIGURAÇÕES
  --------------------------------------------------------- */
  async function config(cont, { api }) {
    const [cfg, prefPecas] = await Promise.all([
      api('/config'),
      api('/pecas/preferencia').catch(() => ({ recebe_alertas: false })),
    ]);
    cont.innerHTML = `
      <div class="titulo"><div><h2>Configurações</h2><p class="sub">Dados da empresa, regras de vistoria e segurança da sua conta.</p></div></div>
      <div class="grade-2">
        <div class="box"><div class="boxTitulo">Empresa e regras</div>
          <form id="f-cfg" class="form-grid">
            <div class="cheio"><label>Nome da empresa *</label><input name="empresa_nome" required maxlength="100" value="${esc(cfg.empresa_nome)}"></div>
            <div><label>Telefone</label><input name="empresa_telefone" maxlength="30" value="${esc(cfg.empresa_telefone)}"></div>
            <div><label>E-mail</label><input name="empresa_email" type="email" maxlength="100" value="${esc(cfg.empresa_email)}"></div>
            <div><label>Alertar vencimentos (dias) *</label><input name="dias_alerta" type="number" min="1" max="60" required value="${esc(cfg.dias_alerta)}">
              <div class="ajuda">Janela usada em “Próximas vistorias” e “Vencimentos”.</div></div>
            <div><label>Intervalo entre vistorias (dias) *</label><input name="intervalo_vistoria_dias" type="number" min="30" max="730" required value="${esc(cfg.intervalo_vistoria_dias)}">
              <div class="ajuda">Define a próxima vistoria após uma conforme ou manutenção.</div></div>
            <div class="cheio"><div class="form-erro" style="display:none"></div><button class="btn btn-primario" type="submit">Salvar configurações</button></div>
          </form></div>
        <div class="box"><div class="boxTitulo">Alterar meu PIN</div>
          <form id="f-pin" class="form-grid">
            <div class="cheio"><label>PIN atual *</label><input name="atual" type="password" inputmode="numeric" maxlength="8" required autocomplete="off"></div>
            <div><label>Novo PIN *</label><input name="novo" type="password" inputmode="numeric" maxlength="8" required autocomplete="off"></div>
            <div><label>Confirmar novo PIN *</label><input name="confirma" type="password" inputmode="numeric" maxlength="8" required autocomplete="off"></div>
            <div class="cheio"><div class="ajuda">4 a 8 números. O PIN é o que identifica você no login — não pode repetir o de outra pessoa.</div>
              <div class="form-erro" style="display:none"></div><button class="btn btn-primario" type="submit">Alterar PIN</button></div>
          </form></div>
      </div>
      <div class="box" style="margin-top:10px">
        <div class="boxTitulo">Alertas e acesso ao módulo Peças</div>
        <form id="f-pecas-pref" class="form-grid">
          <div class="cheio">
            <label class="check" style="margin:0;cursor:pointer">
              <input type="checkbox" id="cfg-recebe-alertas" name="recebe_alertas"${prefPecas && prefPecas.recebe_alertas ? ' checked' : ''}>
              <span>Receber alertas de peças</span>
            </label>
            <div class="ajuda">Desligado por padrão. Ative esta opção para liberar a aba Peças no seu menu e exibir o sininho de notificações no topo direito.</div>
          </div>
          <div class="cheio">
            <div class="form-erro" style="display:none"></div>
            <button class="btn btn-primario" type="submit">Salvar preferência de alertas</button>
          </div>
        </form>
      </div>`;
    function envio(form, fn, ok) {
      const erro = form.querySelector('.form-erro');
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); erro.style.display = 'none';
        const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
        try { await fn(Object.fromEntries(new FormData(form))); Ex.toast(ok); form.querySelectorAll('[type=password]').forEach((i) => { i.value = ''; }); }
        catch (err) { erro.textContent = err.message; erro.style.display = 'block'; }
        btn.disabled = false;
      });
    }
    envio(cont.querySelector('#f-cfg'), (v) => api('/config', { method: 'PUT', body: v }), 'Configurações salvas.');
    envio(cont.querySelector('#f-pin'), async (v) => {
      if (v.novo !== v.confirma) throw new Error('A confirmação não confere com o novo PIN.');
      await Ex.api('/eu/pin', { method: 'PUT', body: { atual: v.atual, novo: v.novo } });
    }, 'PIN alterado com sucesso.');
    envio(cont.querySelector('#f-pecas-pref'), async () => {
      const ativo = cont.querySelector('#cfg-recebe-alertas').checked;
      const resp = await api('/pecas/preferencia', { method: 'PUT', body: { recebe_alertas: ativo } });
      if (window.ExGerentePecas) window.ExGerentePecas.atualizarPreferencia(Boolean(resp.recebe_alertas));
    }, 'Preferência de alertas de peças atualizada.');
  }

  // Módulos externos (reservas.js e pecas.js carregados antes deste arquivo).
  const reservas = window.ExReservas ? window.ExReservas.pagina : undefined;
  const pecas = window.ExGerentePecas ? window.ExGerentePecas.pagina : undefined;
  Ex.app({ perfil: 'gerente', paginas: { inicio, extintores, clientes, os, relatorios, funcionarios, veiculos, ...(reservas ? { reservas } : {}), ...(pecas ? { pecas } : {}), config } });
  if (window.ExGerentePecas) window.ExGerentePecas.iniciar(Ex.apiDe('gerente'));
})();
