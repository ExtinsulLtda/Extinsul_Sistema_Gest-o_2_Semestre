/* ==========================================================
   Painel do MOTORISTA - todas as abas
   Menu: Início · Rotas · Ordens de Serviço · Clientes ·
         Comprovantes · Veículo · Reservas
   ========================================================== */
(function () {
  'use strict';
  const { esc, fmtData, badge } = Ex;
  const api = Ex.apiDe('motorista');

  /*
   * ROTAS DE ENTREGA — base pronta, planejamento completo ainda NÃO implementado.
   * Cada OS chega da API com `destinos`: o endereço de cada extintor da OS (ou o fixo do cliente).
   * Hoje cada destino ganha links de rota (Google Maps) que partem da posição atual do aparelho.
   * Fica para uma próxima etapa: ordenar paradas, rota com várias paradas, tempo/distância estimados.
   */
  const destinosDe = (o) => o.destinos || [];
  const destinoHTML = (d) => `<div style="margin-top:4px">${esc(d.endereco_texto)}
      ${d.extintores.length ? `<span class="mudo">(${esc(d.extintores.join(', '))})</span>` : ''}
      <span class="mudo">· ${d.origem === 'extintor' ? 'endereço do extintor' : 'endereço fixo do cliente'}</span><br>
      <span style="font-size:11px">Rota até aqui: ${Ex.linksRota(d.endereco_texto, { waze: false })}</span></div>`;
  function abrirRota(o) {
    Ex.modal({
      titulo: `Rota de entrega · ${o.numero}`,
      corpo: `<p class="mudo" style="font-size:12px;margin-bottom:8px">A rota parte da sua localização atual até o endereço onde o extintor está.</p>
        <strong>${esc(o.cliente)}</strong>${destinosDe(o).map(destinoHTML).join('') || '<p class="mudo">Nenhum endereço cadastrado para esta OS.</p>'}`,
      botoes: [{ texto: 'Fechar', aoClicar: (m) => m.fechar() }],
    });
  }
  const horario = (o) => (o.status === 'concluida' && o.hora_fim ? `Entregue às ${esc(o.hora_fim)}` : o.hora_inicio ? `${esc(o.hora_inicio)} - ${esc(o.hora_fim || '')}` : 'Sem horário');

  /* ---------- ações sobre uma OS (iniciar / entregar) ---------- */
  async function iniciar(o) {
    try { await api(`/os/${o.id}/iniciar`, { method: 'PUT' }); Ex.toast(`${o.numero} iniciada.`); return true; }
    catch (e) { Ex.toast(e.message, true); return false; }
  }
  async function entregar(o) {
    const ok = await Ex.formModal({
      titulo: `Entregar ${o.numero} · ${o.cliente}`, textoSalvar: 'Concluir entrega',
      introHTML: '<p class="mudo" style="font-size:12px;margin-bottom:12px">Registre quem recebeu o serviço. Isso gera o comprovante e conclui a ordem de serviço.</p>',
      campos: [
        { nome: 'recebedor', rotulo: 'Nome de quem recebeu', obrig: true, max: 100, largura: 'cheio' },
        { nome: 'documento', rotulo: 'Documento (RG/CPF)', max: 30 },
        { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', max: 300, largura: 'cheio' },
      ],
      salvar: (v) => api(`/os/${o.id}/entregar`, { method: 'POST', body: v }),
    });
    if (ok) Ex.toast(`${o.numero} concluída. Comprovante gerado.`);
    return ok;
  }
  // botões de ação conforme o status
  const botoesOS = (o) => [
    ...(o.status === 'pendente' ? [{ rotulo: 'Iniciar', acao: 'iniciar' }] : []),
    ...(o.status !== 'concluida' ? [{ rotulo: 'Entregar', acao: 'entregar', classe: 'btn-verde' }] : []),
    ...(destinosDe(o).length ? [{ rotulo: 'Rota', acao: 'navegar' }] : []),
  ];
  async function executa(acao, o, depois) {
    if (acao === 'navegar') { abrirRota(o); return; }
    const ok = acao === 'iniciar' ? await iniciar(o) : await entregar(o);
    if (ok) depois();
  }

  /* ---------- rota (lista lateral + mapa ilustrativo) ---------- */
  function rotaHTML(itens) {
    const classe = (s) => (s === 'concluida' ? 'feito' : s === 'em_andamento' ? 'andamento' : 'aberto');
    return `<div class="mapaArea">
        <div><div class="mapa" id="mapa-caixa" style="z-index:0"></div>
          <div id="mapa-info" class="mudo" style="margin-top:8px;font-size:13px">${Ex.carregando({ tamanho: 'sm', inline: true, texto: 'Carregando mapa…' })}</div></div>
        <div class="rotas">${itens.length ? itens.map((o, i) => `<div class="rota"><div class="numero ${classe(o.status)}">${i + 1}</div>
          <div class="rotaTexto"><strong>${esc(o.cliente)}</strong><span>${esc(o.numero)} · ${esc(o.tipo)}<br>${horario(o)}${o.data < Ex.hoje() ? ' · <b style="color:#c32727">atrasada</b>' : ''}</span></div></div>`).join('')
          : '<div class="vazio">Nenhuma ordem de serviço na rota.</div>'}</div>
      </div>`;
  }

  /* ---------------------------------------------------------
     INÍCIO
  --------------------------------------------------------- */
  /* ---------- mapa de Varginha + rota até o extintor mais próximo (OS em andamento) ----------
     Mapa: OpenStreetMap (Leaflet). Endereço→coordenada: Nominatim. Rota: OSRM público. Tudo gratuito e sem chave. */
  const VARGINHA = [-21.5513, -45.4303];
  const haversine = (a, b) => {
    const R = 6371, rad = (x) => x * Math.PI / 180, dLa = rad(b[0] - a[0]), dLo = rad(b[1] - a[1]);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  // Variações do endereço, da mais exata à mais geral (o serviço de mapas nem sempre acha "rua + número").
  function variacoes(endereco) {
    const partes = endereco.split(',').map((s) => s.trim()).filter(Boolean);
    const cep = (endereco.match(/\d{5}-?\d{3}/) || [])[0];
    const semNumero = partes.filter((p, k) => k === 0 || !/^\d+[A-Za-z]?$/.test(p) && !/^s\/?n$/i.test(p));
    const v = [endereco, semNumero.join(', '), cep, partes.slice(-2).join(', '), partes.slice(-1)[0]];
    // só acrescenta "Varginha, MG" quando o endereço não traz cidade/UF (ex.: "Campinas - SP")
    const temCidade = (q) => /varginha/i.test(q) || /[-,]\s*[A-Z]{2}(\s*,|\s*$)/.test(q);
    return [...new Set(v.filter(Boolean))].map((q) => (temCidade(q) ? q : q + ', Varginha, MG'));
  }
  async function buscaNominatim(q) {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&accept-language=pt-BR&q=' + encodeURIComponent(q));
    const j = await r.json();
    return j[0] ? [Number(j[0].lat), Number(j[0].lon)] : null;
  }
  async function geocodificar(endereco) {
    const chave = 'geo2:' + endereco;
    try { const c = localStorage.getItem(chave); if (c) return JSON.parse(c); } catch { /* sem cache */ }
    for (const q of variacoes(endereco)) {
      let pos = null;
      try { pos = await buscaNominatim(q); } catch { /* tenta a próxima variação */ }
      await espera(1100);                  // limite do serviço: 1 busca por segundo
      if (pos) {
        const res = { pos, aproximado: q !== variacoes(endereco)[0] };
        try { localStorage.setItem(chave, JSON.stringify(res)); } catch { /* sem cache */ }
        return res;
      }
    }
    return null;
  }
  async function percurso(origem, destino) {   // OSRM; null se não conseguir
    for (let t = 0; t < 2; t++) {
      try {
        const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${origem[1]},${origem[0]};${destino[1]},${destino[0]}?overview=full&geometries=geojson`);
        const j = await r.json();
        if (j.routes && j.routes[0]) return j.routes[0];
      } catch { /* tenta de novo */ }
      await espera(600);
    }
    return null;
  }
  const posicaoAtual = () => new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition((p) => ok([p.coords.latitude, p.coords.longitude]), () => ok(null), { timeout: 8000, maximumAge: 60000 });
  });
  async function mapaRota(cont, rota) {
    const caixa = cont.querySelector('#mapa-caixa'), info = cont.querySelector('#mapa-info');
    if (!caixa) return;
    if (!window.L) { info.textContent = 'Não foi possível carregar o mapa (sem internet?).'; return; }
    const mapa = L.map(caixa).setView(VARGINHA, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    setTimeout(() => mapa.invalidateSize(), 200);
    const destinos = [];
    rota.filter((o) => o.status === 'em_andamento').forEach((o) => destinosDe(o).forEach((d) => destinos.push({ ...d, os: o.numero, cliente: o.cliente })));
    if (!destinos.length) { info.innerHTML = 'Nenhuma entrega <strong>em andamento</strong>. Toque em “Iniciar” em uma OS para ver a rota aqui.'; return; }
    info.innerHTML = Ex.carregando({ tamanho: 'sm', inline: true, texto: 'Buscando sua localização…' });
    let origem = await posicaoAtual(), origemTxt = 'sua localização';
    if (!origem) { origem = VARGINHA; origemTxt = 'o centro de Varginha (localização não autorizada)'; }
    L.circleMarker(origem, { radius: 8, color: '#1681ef', fillOpacity: 0.9 }).addTo(mapa).bindPopup('Você está aqui');
    mapa.setView(origem, 13);
    const linhas = destinos.map((d) => ({ d, estado: 'buscando' }));
    const desenha = () => {
      info.innerHTML = `<div class="mudo" style="font-size:11px;margin-bottom:4px">Saindo de ${origemTxt}. A rota vermelha é a do destino mais próximo.</div>` + linhas.map((l, k) => {
        const d = l.d, ext = d.extintores.length ? ` (${esc(d.extintores.join(', '))})` : '';
        const st = l.estado === 'ok' ? `${l.km} km · ~${l.min} min${l.aprox ? ' · local aproximado' : ''}`
          : l.estado === 'sem-percurso' ? 'não foi possível traçar o percurso (linha reta no mapa)'
          : l.estado === 'nao-achado' ? '⚠ endereço não encontrado no mapa — confira o cadastro'
          : 'localizando…';
        return `<div style="margin:3px 0">${l.proximo ? '★ ' : ''}<strong>${esc(d.os)}</strong> · ${esc(d.cliente)}${ext}<br>${esc(d.endereco_texto)} — ${st}
          · ${Ex.linksRota(d.endereco_texto, { waze: false })}</div>`;
      }).join('');
    };
    desenha();
    // 1) localiza todos os endereços (um por vez)
    for (const l of linhas) {
      try { const g = await geocodificar(l.d.endereco_texto); if (g) { l.pos = g.pos; l.aprox = g.aproximado; } else l.estado = 'nao-achado'; }
      catch { l.estado = 'nao-achado'; }
      if (l.pos) L.marker(l.pos).addTo(mapa).bindPopup(`<strong>${esc(l.d.os)}</strong> · ${esc(l.d.cliente)}<br>${esc(l.d.endereco_texto)}`);
      desenha();
    }
    const achados = linhas.filter((l) => l.pos).sort((a, b) => haversine(origem, a.pos) - haversine(origem, b.pos));
    if (!achados.length) return;
    achados[0].proximo = true;
    // 2) traça a rota de CADA destino localizado; o mais próximo em vermelho, os outros em azul
    const limites = L.latLngBounds([origem]);
    for (const [k, l] of achados.entries()) {
      const rt = await percurso(origem, l.pos);
      const estilo = k === 0 ? { color: '#e52b35', weight: 5 } : { color: '#1681ef', weight: 4, opacity: 0.75 };
      if (rt) {
        const g = L.geoJSON(rt.geometry, { style: estilo }).addTo(mapa);
        if (k === 0) g.bringToFront();
        limites.extend(g.getBounds());
        l.estado = 'ok'; l.km = (rt.distance / 1000).toFixed(1).replace('.', ','); l.min = Math.max(1, Math.round(rt.duration / 60));
      } else {
        L.polyline([origem, l.pos], { ...estilo, dashArray: '6 8' }).addTo(mapa);
        limites.extend(l.pos); l.estado = 'sem-percurso';
      }
      mapa.fitBounds(limites.pad(0.15));
      desenha();
      await espera(300);
    }
  }

  async function inicio(cont) {
    const d = await api('/dashboard');
    const dt = Ex.dataExtensa();
    cont.innerHTML = `
      <div class="titulo"><div><h2>Minha Rota de Hoje</h2><p class="sub">Inclui pendências de dias anteriores.</p></div><p>${dt.dia}<br>${dt.semana}</p></div>
      <div class="resumoMotorista">
        <div class="miniCard"><div class="miniIcon">▣</div><div><strong>${d.rota.length}</strong><span>Ordens de Serviço</span></div></div>
        <div class="miniCard"><div class="miniIcon">♟</div><div><strong>${d.clientes}</strong><span>Clientes</span></div></div>
        <div class="miniCard"><div class="miniIcon">✓</div><div><strong>${d.concluidas_hoje}</strong><span>Entregas concluídas hoje</span></div></div>
      </div>
      <div class="box">${rotaHTML(d.rota)}</div>
      <div class="box">
        <div class="boxTitulo">▣ &nbsp; Ordens de Serviço do Dia <span class="verTodos link" data-ir="os">Ver todas</span></div>
        <div class="tabela-scroll"><table><thead><tr><th>Nº OS</th><th>Cliente</th><th>Tipo</th><th>Horário</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        ${d.rota.map((o, i) => `<tr><td><strong>${esc(o.numero)}</strong></td><td>${esc(o.cliente)}</td><td>${esc(o.tipo)}</td><td class="nowrap">${horario(o)}</td><td>${badge('os', o.status)}</td>
          <td><div class="acoes-linha">${botoesOS(o).map((a) => `<button class="btn btn-sm ${a.classe || ''}" data-acao="${a.acao}" data-i="${i}">${a.rotulo}</button>`).join('')}</div></td></tr>`).join('')
          || '<tr><td colspan="6" class="vazio">Nenhuma ordem de serviço para hoje.</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="box"><div class="boxTitulo">Meu veículo</div>
        ${d.veiculo ? `<div class="detalhe-grid"><div><span>Placa</span>${esc(d.veiculo.placa)}</div><div><span>Modelo</span>${esc(d.veiculo.modelo)}</div>
          <div><span>Quilometragem</span>${Number(d.veiculo.km_atual).toLocaleString('pt-BR')} km</div><div><span>Situação</span>${badge('veic', d.veiculo.status)}</div></div>`
          : '<div class="vazio">Nenhum veículo atribuído a você.</div>'}
      </div>
      <div class="infoBox"><strong>ⓘ &nbsp; Dicas</strong><br><br>Mantenha os comprovantes de entrega e peça o nome de quem recebeu. Em caso de imprevistos, entre em contato com o gerente.</div>`;
    cont.addEventListener('click', (e) => {
      const ir = e.target.closest('[data-ir]');
      if (ir) { location.hash = '#' + ir.dataset.ir; return; }
      const ac = e.target.closest('[data-acao]');
      if (ac) executa(ac.dataset.acao, d.rota[Number(ac.dataset.i)], Ex.recarregarPagina);
    });
    mapaRota(cont, d.rota).catch((e) => { console.error(e); const i = cont.querySelector('#mapa-info'); if (i) i.textContent = 'Não foi possível montar a rota no mapa.'; });
  }

  /* ---------------------------------------------------------
     ROTAS (por dia)
  --------------------------------------------------------- */
  async function rotas(cont) {
    let dia = Ex.hoje();
    cont.innerHTML = `<div class="toolbar">
        <button class="btn" id="r-ant">‹ Dia anterior</button>
        <input type="date" id="r-dia" value="${dia}">
        <button class="btn" id="r-prox">Próximo dia ›</button>
        <button class="btn" id="r-hoje">Hoje</button>
        <span class="contagem" id="r-info"></span></div>
      <div id="r-lista"></div>`;
    const lista = cont.querySelector('#r-lista');
    let itens = [];
    async function carregar() {
      lista.innerHTML = Ex.carregando({ texto: 'Carregando rotas…' });
      try {
        const d = await api('/rota', { params: { data: dia } });
        itens = d.itens;
        cont.querySelector('#r-info').textContent = `${itens.length} parada${itens.length === 1 ? '' : 's'}`;
        lista.innerHTML = itens.length ? itens.map((o, i) => `<div class="box"><div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
            <div class="numero ${o.status === 'concluida' ? 'feito' : o.status === 'em_andamento' ? 'andamento' : 'aberto'}" style="width:28px;height:28px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">${i + 1}</div>
            <div style="flex:1;min-width:220px"><div style="font-size:14px;font-weight:bold">${esc(o.cliente)} ${badge('os', o.status)}</div>
              <div class="mudo" style="font-size:12px;margin-top:3px">${esc(o.numero)} · ${esc(o.tipo)} · ${horario(o)}${o.data < Ex.hoje() ? ` · <b style="color:#c32727">atrasada (${fmtData(o.data)})</b>` : ''}</div>
              <div style="font-size:12px;margin-top:2px">${destinosDe(o).map(destinoHTML).join('') || '<span class="mudo">Endereço não informado</span>'}${o.telefone ? `<div style="margin-top:4px">☎ <a class="link" href="tel:${esc(o.telefone.replace(/[^\d+]/g, ''))}">${esc(o.telefone)}</a></div>` : ''}</div>
              ${o.descricao ? `<div class="mudo" style="font-size:12px;margin-top:4px">${esc(o.descricao)}</div>` : ''}</div>
            <div class="acoes-linha">${botoesOS(o).map((a) => `<button class="btn btn-sm ${a.classe || ''}" data-acao="${a.acao}" data-i="${i}">${a.rotulo}</button>`).join('')}</div>
          </div></div>`).join('') : '<div class="box"><div class="aviso-vazio">Nenhuma parada nesse dia.</div></div>';
      } catch (e) { lista.innerHTML = `<div class="aviso-vazio">${esc(e.message)}</div>`; }
    }
    const ir = (nova) => { dia = nova; cont.querySelector('#r-dia').value = dia; carregar(); };
    cont.querySelector('#r-ant').onclick = () => ir(Ex.somaDias(-1, dia));
    cont.querySelector('#r-prox').onclick = () => ir(Ex.somaDias(1, dia));
    cont.querySelector('#r-hoje').onclick = () => ir(Ex.hoje());
    cont.querySelector('#r-dia').onchange = (e) => { if (e.target.value) ir(e.target.value); };
    lista.addEventListener('click', (e) => {
      const ac = e.target.closest('[data-acao]');
      if (ac) executa(ac.dataset.acao, itens[Number(ac.dataset.i)], carregar);
    });
    carregar();
  }

  /* ---------------------------------------------------------
     ORDENS DE SERVIÇO
  --------------------------------------------------------- */
  function os(cont) {
    Ex.lista(cont, {
      filtros: [
        { nome: 'q', tipo: 'busca', placeholder: 'Nº da OS ou cliente' },
        { nome: 'status', tipo: 'select', opcoes: Ex.opcoesDe('os'), todos: 'Todos os status' },
      ],
      carregar: (p) => api('/os', { params: p }),
      colunas: [
        { t: 'Nº OS', f: (l) => `<strong>${esc(l.numero)}</strong>` },
        { t: 'Cliente', f: (l) => esc(l.cliente) },
        { t: 'Tipo', f: (l) => esc(l.tipo) },
        { t: 'Data', f: (l) => fmtData(l.data) },
        { t: 'Horário', classe: 'nowrap', f: (l) => horario(l) },
        { t: 'Status', f: (l) => badge('os', l.status) },
      ],
      acoes: botoesOS,
      aoAcao: (acao, l, c) => executa(acao, l, c.recarregar),
    });
  }

  /* ---------------------------------------------------------
     CLIENTES
  --------------------------------------------------------- */
  function clientes(cont) {
    Ex.lista(cont, {
      filtros: [{ nome: 'q', tipo: 'busca', placeholder: 'Nome ou cidade' }],
      carregar: (p) => api('/clientes', { params: p }),
      vazio: 'Você ainda não tem clientes nas suas ordens de serviço.',
      colunas: [
        { t: 'Cliente', f: (l) => `<strong>${esc(l.nome)}</strong>` },
        { t: 'Telefone', f: (l) => (l.telefone ? `<a class="link" href="tel:${esc(l.telefone.replace(/[^\d+]/g, ''))}">${esc(l.telefone)}</a>` : '—') },
        { t: 'Endereço fixo', f: (l) => (l.endereco_texto ? `${esc(l.endereco_texto)}<div style="font-size:11px">${Ex.linksRota(l.endereco_texto, { waze: false })}</div>` : '—') },
        { t: 'OS abertas', classe: 'num', f: (l) => l.os_abertas || 0 },
        { t: 'OS no total', classe: 'num', f: (l) => l.os_total },
      ],
    });
  }

  /* ---------------------------------------------------------
     COMPROVANTES
  --------------------------------------------------------- */
  function imprimirComprovante(c) {
    Ex.imprimir(`Comprovante ${c.numero}`, `<h1>Extinsul Extintores</h1><h2>Comprovante de entrega de serviço</h2>
      <div class="linha"><span><strong>OS:</strong> ${esc(c.numero)}</span><span><strong>Serviço:</strong> ${esc(c.tipo)}</span></div>
      <div class="linha"><span><strong>Cliente:</strong> ${esc(c.cliente)}</span></div>
      <div class="linha"><span><strong>Endereço:</strong> ${esc(c.endereco_texto || '—')}</span></div>
      <div class="linha"><span><strong>Data/hora:</strong> ${fmtData(c.data)} ${esc(c.hora || '')}</span></div>
      <div class="linha"><span><strong>Recebido por:</strong> ${esc(c.recebedor)}</span><span><strong>Documento:</strong> ${esc(c.documento || '—')}</span></div>
      ${c.observacao ? `<div class="linha"><span><strong>Observações:</strong> ${esc(c.observacao)}</span></div>` : ''}
      <div class="assin"><div>Assinatura de quem recebeu</div><div>Assinatura do motorista</div></div>`);
  }
  function comprovantes(cont) {
    Ex.lista(cont, {
      filtros: [{ nome: 'q', tipo: 'busca', placeholder: 'OS, cliente ou recebedor' }],
      carregar: (p) => api('/comprovantes', { params: p }),
      vazio: 'Nenhum comprovante ainda. Eles são gerados ao entregar uma OS.',
      colunas: [
        { t: 'Data', classe: 'nowrap', f: (l) => `${fmtData(l.data)} ${esc(l.hora || '')}` },
        { t: 'Nº OS', f: (l) => `<strong>${esc(l.numero)}</strong>` },
        { t: 'Cliente', f: (l) => esc(l.cliente) },
        { t: 'Serviço', f: (l) => esc(l.tipo) },
        { t: 'Recebido por', f: (l) => esc(l.recebedor) },
        { t: 'Documento', f: (l) => esc(l.documento || '—') },
        { t: 'Observação', f: (l) => esc(l.observacao || '') },
      ],
      acoes: () => [{ rotulo: 'Imprimir', acao: 'imprimir' }],
      aoAcao: (acao, l) => { if (acao === 'imprimir') imprimirComprovante(l); },
    });
  }

  /* ---------------------------------------------------------
     VEÍCULO
  --------------------------------------------------------- */
  async function veiculo(cont) {
    const { veiculo: v } = await api('/veiculo');
    if (!v) { cont.innerHTML = '<div class="titulo"><h2>Veículo</h2></div><div class="box"><div class="aviso-vazio">Nenhum veículo está atribuído a você. Peça ao gerente para vincular um veículo.</div></div>'; return; }
    cont.innerHTML = `<div class="titulo"><div><h2>Meu veículo</h2><p class="sub">Atualize a quilometragem e a situação ao iniciar e finalizar o dia.</p></div></div>
      <div class="grade-2">
        <div class="box"><div class="boxTitulo">Dados do veículo</div>
          <div class="detalhe-grid"><div><span>Placa</span>${esc(v.placa)}</div><div><span>Modelo</span>${esc(v.modelo)}</div>
            <div><span>Ano</span>${v.ano || '—'}</div><div><span>Situação</span>${badge('veic', v.status)}</div>
            <div><span>Quilometragem atual</span>${Number(v.km_atual).toLocaleString('pt-BR')} km</div></div></div>
        <div class="box"><div class="boxTitulo">Atualizar</div>
          <form id="f-veic" class="form-grid">
            <div><label>Quilometragem (km) *</label><input name="km_atual" type="number" min="${v.km_atual}" required value="${v.km_atual}"></div>
            <div><label>Situação *</label><select name="status" required>${Ex.opcoesDe('veic').map((o) => `<option value="${o.v}"${o.v === v.status ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select></div>
            <div class="cheio"><div class="form-erro" style="display:none"></div><button class="btn btn-primario" type="submit">Salvar</button></div>
          </form></div>
      </div>`;
    const form = cont.querySelector('#f-veic'), erro = form.querySelector('.form-erro');
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.style.display = 'none';
      try { await api('/veiculo', { method: 'PUT', body: Object.fromEntries(new FormData(form)) }); Ex.toast('Veículo atualizado.'); Ex.recarregarPagina(); }
      catch (err) { erro.textContent = err.message; erro.style.display = 'block'; }
    });
  }

  /* ---------------------------------------------------------
     RESERVAS (empréstimos registrados pelo motorista)
  --------------------------------------------------------- */
  function fmtDataHoraBR(iso) {
    if (!iso) return '—';
    const d = new Date(/Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function reservas(cont) {
    cont.innerHTML = `
      <div class="titulo"><div><h2>Empréstimos de Reservas</h2><p class="sub">Informe o número do extintor reserva e o ID do cliente atendido.</p></div></div>
      <div class="box" style="margin-bottom:14px">
        <div class="boxTitulo">Registrar empréstimo</div>
        <form id="f-emp" class="form-grid">
          <div>
            <label for="emp-num">Número da reserva *</label>
            <input id="emp-num" name="numero_reserva" type="text" inputmode="numeric" maxlength="9" required autocomplete="off" placeholder="Ex.: 1042">
            <div class="ajuda">Somente números inteiros.</div>
          </div>
          <div>
            <label for="emp-cli">ID do cliente *</label>
            <input id="emp-cli" name="cliente_id" type="number" min="1" step="1" required autocomplete="off" placeholder="Ex.: 1">
            <div class="ajuda">Digite o código numérico (ID) do cliente.</div>
          </div>
          <div class="cheio">
            <div class="form-erro" style="display:none"></div>
            <button class="btn btn-primario" type="submit">Registrar empréstimo</button>
          </div>
        </form>
      </div>
      <div id="emp-lista"></div>`;

    const form = cont.querySelector('#f-emp');
    const inpNum = cont.querySelector('#emp-num');
    const erro = form.querySelector('.form-erro');
    const btnSub = form.querySelector('button[type=submit]');

    inpNum.addEventListener('input', () => {
      const limpo = inpNum.value.replace(/\D/g, '').slice(0, 9);
      if (limpo !== inpNum.value) inpNum.value = limpo;
    });

    const lista = Ex.lista(cont.querySelector('#emp-lista'), {
      filtros: [
        { nome: 'q', tipo: 'busca', placeholder: 'Nº da reserva ou cliente' },
        { nome: 'status', tipo: 'select', opcoes: [{ v: 'aberto', t: 'Em aberto' }, { v: 'devolvido', t: 'Devolvido' }], todos: 'Todas as situações' },
      ],
      carregar: (p) => api('/reservas', { params: p }),
      vazio: 'Você ainda não registrou nenhum empréstimo de reserva.',
      colunas: [
        { t: 'Nº Reserva', f: (l) => `<strong>${esc(l.numero_reserva)}</strong>` },
        { t: 'Cliente', f: (l) => `${esc(l.cliente)} <span class="mudo">(#${l.cliente_id})</span>` },
        { t: 'Registrado em', classe: 'nowrap', f: (l) => fmtDataHoraBR(l.criado_em) },
        { t: 'Devolvido em', classe: 'nowrap', f: (l) => fmtDataHoraBR(l.devolvido_em) },
        {
          t: 'Situação',
          f: (l) => (l.devolvido_em
            ? '<span class="status verde">Devolvido</span>'
            : '<span class="status amarelo">Em aberto</span>'),
        },
      ],
      acoes: (l) => (l.devolvido_em ? [] : [{ rotulo: 'Registrar devolução', acao: 'devolver', classe: 'btn-verde' }]),
      aoAcao: async (acao, l, c) => {
        if (acao !== 'devolver') return;
        if (!(await Ex.confirmar(`Confirmar a devolução da reserva ${l.numero_reserva}?`, { textoOk: 'Confirmar devolução' }))) return;
        try {
          await api(`/reservas/${l.id}/devolver`, { method: 'PUT' });
          Ex.toast('Devolução registrada.');
          c.recarregar();
        } catch (err) { Ex.toast(err.message, true); }
      },
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erro.style.display = 'none';
      btnSub.disabled = true;
      btnSub.innerHTML = Ex.carregando({ tamanho: 'sm', inline: true, texto: 'Registrando…' });
      try {
        const vals = Object.fromEntries(new FormData(form));
        const r = await api('/reservas', { method: 'POST', body: vals });
        Ex.toast(`Reserva ${r.numero_reserva} registrada para ${r.cliente}.`);
        form.reset();
        lista.recarregar();
      } catch (err) {
        erro.textContent = err.message;
        erro.style.display = 'block';
      } finally {
        btnSub.disabled = false;
        btnSub.textContent = 'Registrar empréstimo';
      }
    });
  }

  Ex.app({ perfil: 'motorista', paginas: { inicio, rotas, os, clientes, comprovantes, veiculo, reservas } });
})();
