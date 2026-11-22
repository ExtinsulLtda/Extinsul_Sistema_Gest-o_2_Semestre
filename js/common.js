/* ==========================================================
   Extinsul - biblioteca compartilhada pelas páginas
   (sessão, chamadas à API, modais, formulários, listas, CSV...)
   ========================================================== */
(function () {
  'use strict';

  const script = document.currentScript;
  const RAIZ = new URL('../', script.src).href;           // pasta raiz do site
  // Live Server do VS Code (5500/5501): a API continua no servidor Node (porta 3000)
  const API_BASE = ['5500', '5501'].includes(location.port) ? 'http://localhost:3000' : '';
  const CHAVE = 'extinsul_sessao';
  const Ex = (window.Ex = {});

  /* ---------- sessão ---------- */
  Ex.sessao = () => {
    try { return JSON.parse(sessionStorage.getItem(CHAVE) || localStorage.getItem(CHAVE) || 'null'); }
    catch { return null; }
  };
  Ex.limparSessao = () => {
    try { sessionStorage.removeItem(CHAVE); localStorage.removeItem(CHAVE); } catch { /* ignora */ }
  };
  Ex.salvarSessao = (s, lembrar) => {
    Ex.limparSessao();
    try { (lembrar ? localStorage : sessionStorage).setItem(CHAVE, JSON.stringify(s)); } catch { /* ignora */ }
  };
  Ex.irLogin = (motivo) => { location.href = RAIZ + 'index.html' + (motivo ? '?' + motivo + '=1' : ''); };
  Ex.irPainel = (perfil) => { location.href = RAIZ + perfil + '/index.html'; };
  Ex.sair = () => { Ex.limparSessao(); Ex.irLogin(); };

  /* ---------- API ---------- */
  Ex.api = async (caminho, { method = 'GET', body, params, ignorarExpiracao = false } = {}) => {
    let url = API_BASE + '/api' + caminho;
    if (params) {
      const q = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) q.set(k, v); });
      const s = q.toString();
      if (s) url += (url.includes('?') ? '&' : '?') + s;
    }
    const sessao = Ex.sessao();
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(sessao ? { Authorization: 'Bearer ' + sessao.token } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Sem conexão com o servidor.');
    }
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && sessao && !ignorarExpiracao && caminho !== '/login' && !caminho.startsWith('/login/')) {
      Ex.limparSessao(); Ex.irLogin('expirou');
      const err = new Error(d.erro || 'Sessão expirada.');
      err.status = r.status; err.dados = d;
      throw err;
    }
    if (!r.ok) {
      const err = new Error(d.erro || 'Erro na requisição.');
      err.status = r.status; err.dados = d;
      throw err;
    }
    return d;
  };
  // atalho: Ex.apiDe('gerente')('/extintores', {...})
  Ex.apiDe = (perfil) => (caminho, opcoes) => Ex.api('/' + perfil + caminho, opcoes);

  /* ---------- formatação ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  Ex.esc = esc;
  Ex.hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  Ex.somaDias = (n, base) => {
    const d = new Date((base || Ex.hoje()) + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  Ex.fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
  Ex.moeda = (n) => (n == null || n === '' ? '' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  Ex.pct = (n, t) => (t ? (n / t * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '0%');
  Ex.dataExtensa = () => {
    const d = new Date();
    const dia = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    const sem = d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
    return { dia, semana: sem.charAt(0).toUpperCase() + sem.slice(1) };
  };

  const MAPAS = {
    os: { pendente: ['amarelo', 'Pendente'], em_andamento: ['azulStatus', 'Em andamento'], concluida: ['verde', 'Concluída'] },
    ext: { em_dia: ['verde', 'Em dia'], em_atraso: ['amarelo', 'Em atraso'], inativo: ['cinza', 'Inativo'] },
    vist: { conforme: ['verde', 'Conforme'], nao_conforme: ['vermelhoStatus', 'Não conforme'] },
    veic: { disponivel: ['verde', 'Disponível'], em_uso: ['azulStatus', 'Em uso'], manutencao: ['amarelo', 'Em manutenção'] },
    perfil: { gerente: ['azulStatus', 'Gerente'], operador: ['verde', 'Operador'], motorista: ['cinza', 'Motorista'] },
    ativo: { 1: ['verde', 'Ativo'], 0: ['cinza', 'Inativo'] },
  };
  Ex.badge = (mapa, valor) => {
    const [cor, txt] = (MAPAS[mapa] || {})[valor] || ['cinza', valor ?? ''];
    return `<span class="status ${cor}">${esc(txt)}</span>`;
  };
  Ex.rotulo = (mapa, valor) => ((MAPAS[mapa] || {})[valor] || [, valor ?? ''])[1];
  Ex.opcoesDe = (mapa) => Object.entries(MAPAS[mapa]).map(([v, [, t]]) => ({ v, t }));
  Ex.TIPOS_EXT = ['PQS', 'CO2', 'Água'].map((t) => ({ v: t, t }));
  Ex.TIPOS_OS = ['Recarga', 'Manutenção', 'Vistoria'].map((t) => ({ v: t, t }));
  Ex.TIPOS_MANUT = ['Recarga', 'Manutenção', 'Teste hidrostático', 'Troca de peça'].map((t) => ({ v: t, t }));

  /* ---------- avisos ---------- */
  Ex.toast = (msg, erro) => {
    const t = document.createElement('div');
    t.className = 'toast' + (erro ? ' erro' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  };

  /* ---------- modal ---------- */
  Ex.modal = ({ titulo, corpo, largo = false, botoes = [], aoFechar }) => {
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `<div class="modal${largo ? ' largo' : ''}" role="dialog" aria-modal="true">
        <div class="modal-cab"><h3>${esc(titulo)}</h3><button type="button" class="modal-x" aria-label="Fechar">&times;</button></div>
        <div class="modal-corpo"></div><div class="modal-rod"></div></div>`;
    const corpoEl = fundo.querySelector('.modal-corpo');
    if (typeof corpo === 'string') corpoEl.innerHTML = corpo; else if (corpo) corpoEl.appendChild(corpo);
    const rod = fundo.querySelector('.modal-rod');
    const onKey = (e) => { if (e.key === 'Escape') api.fechar(); };
    const api = {
      el: fundo, corpo: corpoEl, botoes: [],
      fechar() {
        if (!fundo.isConnected) return;
        fundo.remove(); document.removeEventListener('keydown', onKey);
        if (aoFechar) aoFechar();
      },
    };
    botoes.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'btn ' + (b.classe || ''); el.textContent = b.texto;
      el.onclick = () => b.aoClicar(api, el);
      rod.appendChild(el); api.botoes.push(el);
    });
    if (!botoes.length) rod.remove();
    fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) api.fechar(); });
    fundo.querySelector('.modal-x').onclick = api.fechar;
    document.addEventListener('keydown', onKey);
    document.body.appendChild(fundo);
    return api;
  };

  Ex.confirmar = (msg, { titulo = 'Confirmar', textoOk = 'Confirmar', perigo = false } = {}) =>
    new Promise((resolve) => {
      Ex.modal({
        titulo, corpo: `<p>${esc(msg)}</p>`, aoFechar: () => resolve(false),
        botoes: [
          { texto: 'Cancelar', aoClicar: (m) => m.fechar() },
          { texto: textoOk, classe: perigo ? 'btn-perigo cheio' : 'btn-primario', aoClicar: (m) => { resolve(true); m.fechar(); } },
        ],
      });
    });

  /* ---------- formulário em modal ---------- */
  function campoHTML(c, valores) {
    const v = valores[c.nome] ?? c.padrao ?? '';
    const id = 'f_' + c.nome;
    const cls = c.largura === 'cheio' ? ' cheio' : '';
    const obr = c.obrig ? ' required' : '';
    const rot = `${esc(c.rotulo)}${c.obrig ? ' *' : ''}`;
    if (c.tipo === 'checkbox') {
      return `<div class="${cls.trim()} check"><input type="checkbox" id="${id}" name="${c.nome}"${v ? ' checked' : ''}><label for="${id}" style="margin:0">${esc(c.rotulo)}</label></div>`;
    }
    let ctl;
    if (c.tipo === 'select') {
      const ops = (c.opcoes || []).map((o) => `<option value="${esc(o.v)}"${String(o.v) === String(v) ? ' selected' : ''}>${esc(o.t)}</option>`).join('');
      ctl = `<select id="${id}" name="${c.nome}"${obr}><option value="">${c.obrig ? 'Selecione…' : '—'}</option>${ops}</select>`;
    } else if (c.tipo === 'textarea') {
      ctl = `<textarea id="${id}" name="${c.nome}" maxlength="${c.max || 300}"${obr} placeholder="${esc(c.placeholder || '')}">${esc(v)}</textarea>`;
    } else {
      const at = [`type="${c.tipo || 'text'}"`, `id="${id}"`, `name="${c.nome}"`, `value="${esc(v)}"`, 'autocomplete="off"'];
      if (c.placeholder) at.push(`placeholder="${esc(c.placeholder)}"`);
      if (c.max != null && (c.tipo === 'number' || c.tipo === 'date')) at.push(`max="${c.max}"`);
      else if (c.max != null) at.push(`maxlength="${c.max}"`);
      if (c.min != null) at.push(`min="${c.min}"`);
      if (c.step != null) at.push(`step="${c.step}"`);
      if (c.leitura) at.push('readonly');
      if (c.inputmode) at.push(`inputmode="${c.inputmode}"`);
      if (c.accept) at.push(`accept="${c.accept}"`);
      if (c.maiusculas) at.push('style="text-transform:uppercase"');
      ctl = `<input ${at.join(' ')}${obr}>`;
    }
    return `<div class="${cls.trim()}"><label for="${id}">${rot}</label>${ctl}${c.ajuda ? `<div class="ajuda">${esc(c.ajuda)}</div>` : ''}</div>`;
  }

  // Abre um formulário; resolve true se salvou, false se cancelou.
  Ex.formModal = ({ titulo, campos, valores = {}, textoSalvar = 'Salvar', salvar, largo = false, aoMontar, introHTML = '' }) =>
    new Promise((resolve) => {
      const form = document.createElement('form');
      form.noValidate = false;
      form.innerHTML = `${introHTML}<div class="form-grid">${campos.map((c) => campoHTML(c, valores)).join('')}</div>
        <div class="form-erro" style="display:none"></div><button type="submit" style="display:none"></button>`;
      const erroEl = form.querySelector('.form-erro');
      let salvou = false;
      const m = Ex.modal({
        titulo, corpo: form, largo, aoFechar: () => resolve(salvou),
        botoes: [
          { texto: 'Cancelar', aoClicar: (mm) => mm.fechar() },
          { texto: textoSalvar, classe: 'btn-primario', aoClicar: () => form.requestSubmit() },
        ],
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const vals = {};
        campos.forEach((c) => {
          const el = form.elements[c.nome];
          vals[c.nome] = c.tipo === 'checkbox' ? el.checked : el.value.trim();
        });
        const btn = m.botoes[1];
        btn.disabled = true; erroEl.style.display = 'none';
        try {
          await salvar(vals);
          salvou = true; m.fechar();
        } catch (err) {
          erroEl.textContent = err.message; erroEl.style.display = 'block';
          btn.disabled = false;
        }
      });
      if (aoMontar) aoMontar(form, m);
      const primeiro = form.querySelector('input:not([readonly]), select, textarea');
      if (primeiro) primeiro.focus();
    });

  /* autocompleta o código do extintor em um <input> (usa <datalist>) */
  Ex.autocompleteExtintor = (perfil, input) => {
    const dl = document.createElement('datalist');
    dl.id = 'dl_' + Math.random().toString(36).slice(2);
    input.setAttribute('list', dl.id);
    input.after(dl);
    let t;
    const buscar = () => {
      Ex.api(`/${perfil}/extintores`, { params: { q: input.value, limit: 10 } }).then((d) => {
        dl.innerHTML = d.itens.map((e) => `<option value="${esc(e.codigo)}">${esc(e.cliente)} · ${esc(e.tipo)}</option>`).join('');
      }).catch(() => {});
    };
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(buscar, 250); });
    buscar();
  };

  /* ---------- tabelas e listas ---------- */
  Ex.paginacaoHTML = (info) => {
    const { page, paginas, total } = info;
    const txt = `${total} registro${total === 1 ? '' : 's'}`;
    if (paginas <= 1) return `<div class="paginacao"><span>${txt}</span></div>`;
    return `<div class="paginacao"><span>${txt} · página ${page} de ${paginas}</span>
      <button class="btn btn-sm" data-pag="${page - 1}"${page <= 1 ? ' disabled' : ''}>‹ Anterior</button>
      <button class="btn btn-sm" data-pag="${page + 1}"${page >= paginas ? ' disabled' : ''}>Próxima ›</button></div>`;
  };

  // Tabela simples (para dentro de modais e relatórios). linhas = matriz de HTML já escapado.
  Ex.tabelaSimples = (colunas, linhas, vazio = 'Sem registros.') =>
    linhas.length
      ? `<div class="tabela-scroll"><table><thead><tr>${colunas.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : `<div class="vazio">${esc(vazio)}</div>`;

  /*
   * Lista paginada com filtros.
   * cfg = { filtros:[{nome,tipo:'busca'|'select'|'data',placeholder,opcoes,todos}], botoes:[{texto,classe,aoClicar(ctx)}],
   *         colunas:[{t, f(linha,i)->html, classe}], acoes(linha)->[{rotulo,acao,classe}], carregar(params)->{itens,total,page,paginas},
   *         aoAcao(acao, linha, ctx), vazio }
   */
  Ex.lista = (cont, cfg) => {
    const filtros = cfg.filtros || [];
    cont.innerHTML = `<div class="toolbar">
        ${filtros.map((f) => {
          if (f.tipo === 'select') {
            return `<select data-f="${f.nome}" aria-label="${esc(f.placeholder || f.nome)}"><option value="">${esc(f.todos || 'Todos')}</option>${f.opcoes.map((o) => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join('')}</select>`;
          }
          if (f.tipo === 'data') return `<input type="date" data-f="${f.nome}" aria-label="${esc(f.placeholder || f.nome)}" title="${esc(f.placeholder || '')}">`;
          return `<input type="search" data-f="${f.nome}" placeholder="🔍  ${esc(f.placeholder || 'Pesquisar...')}">`;
        }).join('')}
        <span class="contagem" data-contagem></span><span class="espaco"></span>
        <span data-botoes style="display:flex;gap:8px;flex-wrap:wrap"></span>
      </div>
      <div class="box"><div class="tabela-scroll" data-tabela></div><div data-pag></div></div>`;
    const tabelaEl = cont.querySelector('[data-tabela]');
    const pagEl = cont.querySelector('[data-pag]');
    const contEl = cont.querySelector('[data-contagem]');
    let page = 1, linhas = [];

    const ctx = { recarregar: () => carregar() };
    (cfg.botoes || []).forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'btn ' + (b.classe || 'btn-primario'); el.textContent = b.texto;
      el.onclick = () => b.aoClicar(ctx);
      cont.querySelector('[data-botoes]').appendChild(el);
    });

    const params = () => {
      const p = { page };
      cont.querySelectorAll('[data-f]').forEach((el) => { if (el.value) p[el.dataset.f] = el.value; });
      return p;
    };
    async function carregar() {
      tabelaEl.innerHTML = '<div class="carregando-pag">Carregando…</div>';
      try {
        const d = await cfg.carregar(params());
        linhas = d.itens;
        contEl.textContent = '';
        if (!linhas.length) {
          tabelaEl.innerHTML = `<div class="aviso-vazio">${esc(cfg.vazio || 'Nenhum registro encontrado.')}</div>`;
          pagEl.innerHTML = '';
          return;
        }
        const cols = cfg.colunas.map((c) => `<th>${esc(c.t)}</th>`).join('') + (cfg.acoes ? '<th>Ações</th>' : '');
        const corpo = linhas.map((l, i) => `<tr>${cfg.colunas.map((c) => `<td class="${c.classe || ''}">${c.f(l, i)}</td>`).join('')}${
          cfg.acoes ? `<td><div class="acoes-linha">${cfg.acoes(l).map((a) => `<button type="button" class="btn btn-sm ${a.classe || ''}" data-acao="${a.acao}" data-i="${i}">${esc(a.rotulo)}</button>`).join('')}</div></td>` : ''}</tr>`).join('');
        tabelaEl.innerHTML = `<table><thead><tr>${cols}</tr></thead><tbody>${corpo}</tbody></table>`;
        pagEl.innerHTML = Ex.paginacaoHTML(d);
      } catch (e) {
        tabelaEl.innerHTML = `<div class="aviso-vazio">${esc(e.message)}</div>`;
        pagEl.innerHTML = '';
      }
    }
    let t;
    cont.querySelectorAll('[data-f]').forEach((el) => {
      if (el.type === 'search') el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { page = 1; carregar(); }, 300); });
      else el.addEventListener('change', () => { page = 1; carregar(); });
    });
    cont.addEventListener('click', (e) => {
      const pg = e.target.closest('[data-pag]');
      if (pg && !pg.disabled) { page = Number(pg.dataset.pag); carregar(); return; }
      const ac = e.target.closest('[data-acao]');
      if (ac && cfg.aoAcao) cfg.aoAcao(ac.dataset.acao, linhas[Number(ac.dataset.i)], ctx);
    });
    carregar();
    return ctx;
  };

  /* ---------- cartões ---------- */
  Ex.card = ({ icone, cor, titulo, valor, info = '', id = '' }) => `<div class="card"><div class="cardTitulo">
      <div class="cardIcon ${cor}">${icone}</div><div>${esc(titulo)}<div class="cardNumero"${id ? ` id="${id}"` : ''}>${valor}</div></div>
    </div><div class="cardInfo">${info}</div></div>`;

  /* ---------- endereço, CEP e rotas (APIs públicas) ---------- */
  // ViaCEP (https://viacep.com.br): preenche o endereço a partir do CEP, sem chave de API.
  Ex.viaCep = (form) => {
    const cep = form.elements.cep;
    if (!cep) return;
    let ultimo = '';                       // último CEP já consultado (evita consultar duas vezes)
    async function buscar(forcar) {
      const d = cep.value.replace(/\D/g, '');
      if (d.length !== 8 || cep.disabled) return;
      if (d === ultimo && !forcar) return;
      ultimo = d;
      cep.value = d.slice(0, 5) + '-' + d.slice(5);
      try {
        const j = await (await fetch(`https://viacep.com.br/ws/${d}/json/`)).json();
        if (j.erro) { Ex.toast('CEP não encontrado.', true); ultimo = ''; return; }
        const poe = (nome, v) => { if (v && form.elements[nome]) form.elements[nome].value = v; };
        poe('endereco', j.logradouro); poe('bairro', j.bairro); poe('cidade', j.localidade); poe('uf', j.uf);
        if (form.elements.numero && document.activeElement !== form.elements.numero) form.elements.numero.focus();
      } catch { ultimo = ''; Ex.toast('Não consegui consultar o CEP agora. Preencha o endereço manualmente.', true); }
    }
    // consulta assim que o 8º dígito é digitado/colado, ao sair do campo, ao mudar o valor e ao apertar Enter
    cep.addEventListener('input', () => { if (cep.value.replace(/\D/g, '').length === 8) buscar(false); });
    cep.addEventListener('change', () => buscar(false));
    cep.addEventListener('blur', () => buscar(false));
    cep.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault(); ev.stopPropagation();   // Enter no CEP consulta o CEP, não salva o formulário
      buscar(true);
    });
  };
  Ex.camposEndereco = () => [
    { nome: 'cep', rotulo: 'CEP', max: 9, inputmode: 'numeric', placeholder: '00000-000', ajuda: 'Preenche o endereço automaticamente (ViaCEP).' },
    { nome: 'numero', rotulo: 'Número', max: 15 },
    { nome: 'endereco', rotulo: 'Logradouro (rua, avenida...)', max: 150, largura: 'cheio' },
    { nome: 'complemento', rotulo: 'Complemento', max: 60 },
    { nome: 'bairro', rotulo: 'Bairro', max: 60 },
    { nome: 'cidade', rotulo: 'Cidade', max: 60 },
    { nome: 'uf', rotulo: 'UF', max: 2, maiusculas: true, placeholder: 'SP' },
  ];
  // Local de instalação + endereço do extintor (ou o endereço fixo do cliente)
  Ex.camposLocalizacao = () => [
    { nome: 'local', rotulo: 'Local de instalação', max: 80, placeholder: 'Ex.: Corredor principal', largura: 'cheio' },
    { nome: 'usar_endereco_cliente', rotulo: 'Usar o endereço fixo do cliente', tipo: 'checkbox', largura: 'cheio' },
    ...Ex.camposEndereco(),
  ];
  Ex.valoresLocalizacao = (e) => (e ? { ...e, usar_endereco_cliente: !e.endereco_proprio } : { usar_endereco_cliente: true });
  Ex.aoMontarLocalizacao = (form) => {
    Ex.viaCep(form);
    const marca = form.elements.usar_endereco_cliente;
    const nomes = Ex.camposEndereco().map((c) => c.nome);
    const aplica = () => nomes.forEach((n) => { form.elements[n].disabled = marca.checked; });
    marca.addEventListener('change', aplica);
    aplica();
  };
  // Links de rota: abrem o app/site do Google Maps ou do Waze a partir da posição atual do aparelho.
  Ex.linkGoogle = (endereco) => `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(endereco)}`;
  Ex.linkWaze = (endereco) => `https://waze.com/ul?navigate=yes&q=${encodeURIComponent(endereco)}`;
  // Link de rota. O Waze só aparece fora do perfil motorista.
  Ex.linksRota = (endereco, { waze = true } = {}) => `<a class="link" target="_blank" rel="noopener" href="${Ex.linkGoogle(endereco)}">Google Maps</a>${waze ? ` · <a class="link" target="_blank" rel="noopener" href="${Ex.linkWaze(endereco)}">Waze</a>` : ''}`;

  /* ---------- fotos ---------- */
  // Lê uma imagem, reduz para até 1000 px e devolve um data URL JPEG leve.
  Ex.lerImagem = (arquivo) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(arquivo);
    img.onload = () => {
      const f = Math.min(1, 1000 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let out = '';
      for (const q of [0.75, 0.6, 0.45, 0.3]) { out = c.toDataURL('image/jpeg', q); if (out.length < 650000) break; }
      resolve(out);
    };
    img.onerror = () => reject(new Error('Não foi possível ler essa imagem.'));
    img.src = url;
  });
  // Cadastro rápido de cliente (usado pelo operador). Resolve com {id, nome} ou null se cancelou.
  Ex.novoCliente = async (perfil) => {
    let nome = '', id = null;
    const ok = await Ex.formModal({
      titulo: 'Novo cliente', largo: true,
      introHTML: '<h4 style="margin:0 0 8px">Dados do cliente</h4>',
      aoMontar: Ex.viaCep,
      campos: [
        { nome: 'nome', rotulo: 'Nome', obrig: true, max: 100, largura: 'cheio' },
        { nome: 'telefone', rotulo: 'Telefone', tipo: 'tel', max: 30, placeholder: '(11) 99999-9999' },
        { nome: 'email', rotulo: 'E-mail', tipo: 'email', max: 100 },
        ...Ex.camposEndereco(),
      ],
      salvar: async (v) => { const r = await Ex.api(`/${perfil}/clientes`, { method: 'POST', body: v }); id = r.id; nome = v.nome; },
    });
    return ok ? { id, nome } : null;
  };

  // Coloca um botão "+ Novo cliente" abaixo do <select> de clientes. Ao cadastrar, o cliente entra na lista já selecionado.
  Ex.botaoNovoCliente = (select, perfil, aoCriar) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn btn-sm'; btn.textContent = '+ Novo cliente'; btn.style.marginTop = '6px';
    select.after(btn);
    btn.onclick = async () => {
      const n = await Ex.novoCliente(perfil);
      if (!n) return;
      const o = document.createElement('option'); o.value = n.id; o.textContent = n.nome;
      select.appendChild(o); select.value = String(n.id);
      if (aoCriar) aoCriar(n);
      Ex.toast('Cliente cadastrado.');
    };
  };

  // Seletor de foto: botões "Galeria / arquivos" e "Tirar foto" (câmera). Adiciona-se ao fim do formulário.
  // Devolve { obter() -> dataURL ('' se nenhuma), limpar() }
  Ex.seletorFoto = (form, { rotulo = 'Foto' } = {}) => {
    let imagem = '';
    const caixa = document.createElement('div');
    caixa.className = 'campo cheio seletor-foto';
    caixa.innerHTML = `<label>${rotulo}</label>
      <div class="seletor-botoes">
        <button type="button" class="btn btn-sm" data-sel="galeria">🖼 Galeria / arquivos</button>
        <button type="button" class="btn btn-sm" data-sel="camera">📷 Tirar foto</button>
        <button type="button" class="btn btn-sm btn-perigo" data-sel="remover" style="display:none">Remover</button>
      </div>
      <input type="file" accept="image/*" hidden data-in="galeria">
      <input type="file" accept="image/*" capture="environment" hidden data-in="camera">
      <img class="foto-previa" style="display:none" alt="Prévia">
      <small class="mudo">A imagem é reduzida automaticamente antes do envio.</small>`;
    (form.querySelector('.form-grid') || form).appendChild(caixa);
    const prev = caixa.querySelector('img'), rem = caixa.querySelector('[data-sel=remover]');
    const limpar = () => { imagem = ''; prev.style.display = 'none'; prev.removeAttribute('src'); rem.style.display = 'none'; caixa.querySelectorAll('input').forEach((i) => { i.value = ''; }); };
    caixa.querySelectorAll('input[type=file]').forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return;
      try { imagem = await Ex.lerImagem(f); prev.src = imagem; prev.style.display = 'block'; rem.style.display = ''; }
      catch (e) { limpar(); Ex.toast(e.message, true); }
    }));
    caixa.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-sel]');
      if (!b) return;
      if (b.dataset.sel === 'remover') limpar();
      else caixa.querySelector(`[data-in=${b.dataset.sel}]`).click();
    });
    return { obter: () => imagem, limpar };
  };

  // Formulário de envio de foto. salvar(valores, imagemDataURL)
  Ex.formFoto = ({ titulo = 'Enviar foto', extras = [], aoMontar, salvar }) => {
    let sel;
    return Ex.formModal({
      titulo, textoSalvar: 'Enviar',
      campos: [...extras, { nome: 'descricao', rotulo: 'Descrição', max: 200, largura: 'cheio' }],
      aoMontar: (form, m) => { sel = Ex.seletorFoto(form); if (aoMontar) aoMontar(form, m); },
      salvar: async (v) => { if (!sel.obter()) throw new Error('Selecione uma imagem válida.'); await salvar(v, sel.obter()); },
    });
  };

  /* ---------- detalhes reutilizáveis ---------- */
  Ex.verExtintor = async (perfil, id) => {
    try {
      const comFotos = perfil === 'gerente' || perfil === 'operador';
      const [d, f] = await Promise.all([
        Ex.api(`/${perfil}/extintores/${id}`),
        comFotos ? Ex.api(`/${perfil}/extintores/${id}/fotos`) : Promise.resolve({ itens: [] }),
      ]);
      const e = d.extintor, eu = Ex.sessao() || {};
      const fotos = f.itens;
      const corpo = `<div class="detalhe-grid">
          <div><span>Código</span>${esc(e.codigo)}</div><div><span>Cliente</span>${esc(e.cliente)}</div>
          <div><span>Tipo</span>${esc(e.tipo)}</div><div><span>Capacidade</span>${esc(e.capacidade || '—')}</div>
          <div><span>Local de instalação</span>${esc(e.local || '—')}</div><div><span>Status</span>${Ex.badge('ext', e.status)}</div>
          <div><span>Próxima vistoria</span>${Ex.fmtData(e.proxima_vistoria) || '—'}</div>
          <div style="grid-column:1/-1"><span>Endereço ${e.endereco_proprio ? 'do extintor' : '(fixo do cliente)'}</span>${esc(e.endereco_texto || '—')}
            ${e.endereco_texto ? `  ${Ex.linksRota(e.endereco_texto, { waze: perfil !== 'motorista' })}` : ''}</div></div>
        ${comFotos ? `<h4>Fotos (${fotos.length})</h4>${fotos.length ? `<div class="galeria">${fotos.map((x, i) => `<div class="foto-card">
            <img src="${x.imagem}" alt="${esc(x.descricao || 'Foto do extintor')}" data-ampliar="${i}">
            <div class="info"><strong>${esc(x.descricao || 'Sem descrição')}</strong>${Ex.fmtData(x.data)} · ${esc(x.operador || '')}
              ${perfil === 'gerente' || x.operador_id === eu.id ? `<div style="margin-top:6px"><button class="btn btn-sm btn-perigo" data-excluir-foto="${i}">Excluir</button></div>` : ''}</div></div>`).join('')}</div>` : '<div class="vazio">Nenhuma foto deste extintor.</div>'}` : ''}
        <h4>Últimas vistorias</h4>
        ${Ex.tabelaSimples(['Data', 'Resultado', 'Operador', 'Observação'], d.vistorias.map((v) => [Ex.fmtData(v.data), Ex.badge('vist', v.resultado), esc(v.operador || '—'), esc(v.observacao || '')]), 'Nenhuma vistoria registrada.')}
        <h4>Manutenções</h4>
        ${Ex.tabelaSimples(['Data', 'Tipo', 'Descrição', 'Custo'], d.manutencoes.map((m) => [Ex.fmtData(m.data), esc(m.tipo), esc(m.descricao || ''), Ex.moeda(m.custo)]), 'Nenhuma manutenção registrada.')}`;
      const botoes = [];
      if (comFotos) {
        botoes.push({
          texto: '+ Adicionar foto', classe: 'btn-primario',
          aoClicar: async (mm) => {
            const ok = await Ex.formFoto({
              titulo: `Foto do extintor ${e.codigo}`,
              salvar: (v, imagem) => Ex.api(`/${perfil}/extintores/${id}/fotos`, { method: 'POST', body: { imagem, descricao: v.descricao } }),
            });
            if (ok) { Ex.toast('Foto enviada.'); mm.fechar(); Ex.verExtintor(perfil, id); }
          },
        });
      }
      botoes.push({ texto: 'Fechar', aoClicar: (mm) => mm.fechar() });
      const m = Ex.modal({ titulo: 'Extintor ' + e.codigo, corpo, largo: true, botoes });
      m.corpo.addEventListener('click', async (ev) => {
        const am = ev.target.closest('[data-ampliar]');
        if (am) {
          const x = fotos[Number(am.dataset.ampliar)];
          Ex.modal({ titulo: x.descricao || 'Foto', largo: true, corpo: `<img src="${x.imagem}" alt="" style="max-width:100%;border-radius:6px">`, botoes: [{ texto: 'Fechar', aoClicar: (mm) => mm.fechar() }] });
          return;
        }
        const ex = ev.target.closest('[data-excluir-foto]');
        if (ex) {
          const x = fotos[Number(ex.dataset.excluirFoto)];
          if (!(await Ex.confirmar('Excluir esta foto?', { textoOk: 'Excluir', perigo: true }))) return;
          try { await Ex.api(`/${perfil}/fotos/${x.id}`, { method: 'DELETE' }); Ex.toast('Foto excluída.'); m.fechar(); Ex.verExtintor(perfil, id); }
          catch (err) { Ex.toast(err.message, true); }
        }
      });
    } catch (e) { Ex.toast(e.message, true); }
  };
  Ex.verCliente = async (perfil, id) => {
    try {
      const d = await Ex.api(`/${perfil}/clientes/${id}`);
      const c = d.cliente;
      const corpo = `<div class="detalhe-grid">
          <div><span>Nome</span>${esc(c.nome)}</div><div><span>Telefone</span>${esc(c.telefone || '—')}</div>
          <div><span>E-mail</span>${esc(c.email || '—')}</div><div><span>Complemento</span>${esc(c.complemento || '—')}</div>
          <div style="grid-column:1/-1"><span>Endereço fixo</span>${esc(c.endereco_texto || '—')}${c.endereco_texto ? `  ${Ex.linksRota(c.endereco_texto, { waze: perfil !== 'motorista' })}` : ''}</div></div>
        <h4>Extintores (${d.extintores.length})</h4>
        ${Ex.tabelaSimples(['Código', 'Tipo', 'Status', 'Próx. vistoria'], d.extintores.map((e) => [esc(e.codigo), esc(e.tipo), Ex.badge('ext', e.status), Ex.fmtData(e.proxima_vistoria)]), 'Nenhum extintor cadastrado.')}
        <h4>Últimas ordens de serviço</h4>
        ${Ex.tabelaSimples(['Nº OS', 'Tipo', 'Status', 'Data'], d.ordens.map((o) => [esc(o.numero), esc(o.tipo), Ex.badge('os', o.status), Ex.fmtData(o.data)]), 'Nenhuma ordem de serviço.')}`;
      Ex.modal({ titulo: c.nome, corpo, largo: true, botoes: [{ texto: 'Fechar', aoClicar: (m) => m.fechar() }] });
    } catch (e) { Ex.toast(e.message, true); }
  };

  /* ---------- exportar / imprimir ---------- */
  Ex.csv = (nomeArquivo, colunas, linhas) => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const txt = '﻿' + [colunas, ...linhas].map((l) => l.map(q).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
    a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };
  Ex.imprimir = (titulo, html) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const d = f.contentWindow.document;
    d.open();
    d.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#172033;padding:24px;font-size:12px}
      h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;margin:0 0 12px;color:#46505e}
      table{width:100%;border-collapse:collapse;margin-top:10px} th,td{border:1px solid #cfd5dc;padding:6px 8px;text-align:left;font-size:11px}
      th{background:#f1f4f7} .linha{display:flex;gap:30px;margin:6px 0} .assin{margin-top:50px;display:flex;gap:40px}
      .assin div{flex:1;border-top:1px solid #172033;text-align:center;padding-top:4px;font-size:11px}
      </style></head><body>${html}</body></html>`);
    d.close();
    setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); }, 250);
  };

  /* ---------- casca das páginas por perfil ---------- */
  /*
   * Ex.app({ perfil, paginas:{ nome: async (container, ctx) => {} }, padrao })
   * O menu usa <li data-pagina="nome" data-titulo="Título">; a rota é o hash (#nome).
   */
  Ex.app = ({ perfil, paginas, padrao = 'inicio' }) => {
    const sessao = Ex.sessao();
    if (!sessao || !sessao.token) { Ex.irLogin(); return; }
    if (sessao.perfil !== perfil) { Ex.irPainel(sessao.perfil); return; }
    // confirma no servidor que a sessão ainda vale (e o perfil não mudou)
    Ex.api('/eu').then((d) => { if (d.usuario.perfil !== perfil) Ex.irPainel(d.usuario.perfil); }).catch(() => {});

    const primeiro = sessao.nome.split(' ')[0];
    document.querySelectorAll('.nomeUsuario').forEach((e) => { e.textContent = sessao.nome; });
    document.querySelectorAll('.primeiroNome').forEach((e) => { e.textContent = primeiro; });
    document.querySelectorAll('.sair').forEach((e) => { e.onclick = Ex.sair; });
    const dt = Ex.dataExtensa();
    document.querySelectorAll('.dataCurta').forEach((e) => { e.textContent = `${dt.semana}, ${dt.dia}`; });

    const alvo = document.getElementById('pagina');
    const itens = [...document.querySelectorAll('.menu li[data-pagina]')];
    // menu hambúrguer: abre/fecha e fecha ao escolher uma opção
    const menu = document.querySelector('.menu'), barra = document.querySelector('.barra');
    const fundo = document.createElement('div'); fundo.className = 'menu-fundo'; document.body.appendChild(fundo);
    const btnMenu = document.createElement('button');
    btnMenu.type = 'button'; btnMenu.className = 'btnMenu'; btnMenu.setAttribute('aria-label', 'Abrir menu'); btnMenu.setAttribute('aria-expanded', 'false');
    btnMenu.innerHTML = '<span></span><span></span><span></span>';
    if (barra) barra.prepend(btnMenu);
    const alternarMenu = (abrir) => {
      const a = abrir === undefined ? !menu.classList.contains('aberto') : abrir;
      menu.classList.toggle('aberto', a); fundo.classList.toggle('aberto', a);
      btnMenu.setAttribute('aria-expanded', String(a));
    };
    btnMenu.onclick = () => alternarMenu();
    fundo.onclick = () => alternarMenu(false);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') alternarMenu(false); });
    itens.forEach((li) => { li.onclick = () => { alternarMenu(false); location.hash = '#' + li.dataset.pagina; }; });
    document.querySelectorAll('.sair').forEach((e) => { e.onclick = Ex.sair; });

    async function rotear() {
      const [nome0, qs] = (location.hash || '').slice(1).split('?');   // ex.: #clientes?novo
      let nome = nome0 || padrao;
      if (!paginas[nome]) nome = padrao;
      const query = new URLSearchParams(qs || '');
      itens.forEach((li) => li.classList.toggle('ativo', li.dataset.pagina === nome));
      const li = itens.find((x) => x.dataset.pagina === nome);
      const tit = document.getElementById('tituloPagina');
      if (tit && li) tit.textContent = li.dataset.titulo || '';
      document.title = `${li ? li.dataset.titulo + ' · ' : ''}Extinsul`;
      const cont = document.createElement('div');          // contêiner novo: respostas atrasadas não sobrescrevem a aba atual
      cont.innerHTML = '<div class="carregando-pag">Carregando…</div>';
      alvo.replaceChildren(cont);
      window.scrollTo(0, 0);
      try { await paginas[nome](cont, { sessao, perfil, query, api: Ex.apiDe(perfil) }); }
      catch (e) { console.error(e); cont.innerHTML = `<div class="aviso-vazio">${esc(e.message || 'Erro ao carregar a página.')}</div>`; }
    }
    window.addEventListener('hashchange', rotear);
    Ex.recarregarPagina = rotear;
    rotear();
  };
})();
