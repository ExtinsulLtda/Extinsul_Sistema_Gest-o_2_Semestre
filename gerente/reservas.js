/* ==========================================================
   Módulo RESERVAS — painel do GERENTE (banco Turso/SQLite)
   ----------------------------------------------------------
   Estrutura:
     1. Constantes e utilitários
     2. Controle de permissões (exigirAdmin)
     3. Classes: Reserva, TabelaReserva, GerenciadorReservas
     4. Interface:
        - Sub-aba "Tabelas de reservas" (cartões + editor + impressão)
        - Sub-aba "Empréstimos" (empréstimos registrados pelos motoristas)
   ========================================================== */
(function (raiz) {
  'use strict';

  /* ---------------------------------------------------------
     1. CONSTANTES E UTILITÁRIOS
  --------------------------------------------------------- */
  const MOTIVOS = Object.freeze({ E: 'Estragado', V: 'Vencido' });
  const MOVIMENTACOES = Object.freeze(['Vai', 'Retornou']);
  const MAX_LINHAS = 100;
  const MAX_DIGITOS = 9;
  const MAX_NOME = 100;
  const HORAS_NOVO = 48;
  const CHAVE_STORAGE = 'extinsul.reservas.prototipo.v1';
  const PERFIL_ADMIN = 'gerente';

  const pad = (n) => String(n).padStart(2, '0');
  const partesData = (d) => ({
    data: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hora: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  });
  const dataBR = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  };
  const dataHoraBR = (iso) => {
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
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const exTem = (fn) => typeof Ex !== 'undefined' && Ex && typeof Ex[fn] === 'function';
  const avisar = (msg, erro) => (exTem('toast') ? Ex.toast(msg, !!erro) : raiz.alert && raiz.alert(msg));
  const confirmar = (msg, opcoes) => (exTem('confirmar')
    ? Ex.confirmar(msg, opcoes)
    : Promise.resolve(raiz.confirm ? raiz.confirm(msg) : false));

  /* ---------------------------------------------------------
     2. CONTROLE DE PERMISSÕES
  --------------------------------------------------------- */
  const ehAdmin = (sessao) => !!sessao && sessao.perfil === PERFIL_ADMIN;
  function exigirAdmin(sessao) {
    if (!ehAdmin(sessao)) throw new Error('Acesso negado: apenas administradores podem usar as Reservas.');
  }

  /* ---------------------------------------------------------
     3a. CLASSE Reserva — uma linha da tabela
  --------------------------------------------------------- */
  class Reserva {
    constructor({ numero = null, motivo = null, movimentacao = null, cliente_id = null, clienteId = null, cliente = null } = {}) {
      this.numero = null;
      this.motivo = null;
      this.movimentacao = null;
      this.clienteId = null;
      this.cliente = null;
      this.definirNumero(numero);
      this.definirMotivo(motivo);
      this.definirMovimentacao(movimentacao);
      this.definirCliente(clienteId !== null && clienteId !== undefined ? clienteId : cliente_id, cliente);
    }

    static converterNumero(valor) {
      if (valor === null || valor === undefined || valor === '') return null;
      if (typeof valor === 'number') {
        if (!Number.isInteger(valor) || valor < 0 || String(valor).length > MAX_DIGITOS) {
          throw new Error('A reserva deve ser um número inteiro (somente dígitos, sem sinais ou decimais).');
        }
        return valor;
      }
      const t = String(valor).trim();
      if (t === '') return null;
      if (!/^\d+$/.test(t)) throw new Error('A reserva aceita somente números inteiros (sem letras, sinais ou decimais).');
      if (t.length > MAX_DIGITOS) throw new Error(`A reserva pode ter no máximo ${MAX_DIGITOS} dígitos.`);
      return Number(t);
    }

    definirNumero(valor) { this.numero = Reserva.converterNumero(valor); return this; }

    validarNumero() {
      if (this.numero === null) return null;
      if (!Number.isInteger(this.numero) || this.numero < 0) return 'Número de reserva inválido.';
      return null;
    }

    definirMotivo(valor) {
      if (valor === null || valor === undefined || valor === '') this.motivo = null;
      else if (typeof valor === 'string' && Object.prototype.hasOwnProperty.call(MOTIVOS, valor)) this.motivo = valor;
      else throw new Error('Motivo inválido: use somente E (Estragado), V (Vencido) ou deixe vazio.');
      return this;
    }

    definirMovimentacao(valor) {
      if (valor === null || valor === undefined || valor === '') this.movimentacao = null;
      else if (MOVIMENTACOES.includes(valor)) this.movimentacao = valor;
      else throw new Error('Situação inválida: use somente Vai, Retornou ou deixe vazio.');
      return this;
    }

    definirCliente(id, nome = null) {
      if (id === null || id === undefined || id === '') {
        this.clienteId = null;
        this.cliente = null;
        return this;
      }
      const n = Number(id);
      if (!Number.isInteger(n) || n < 1) throw new Error('Cliente inválido.');
      this.clienteId = n;
      this.cliente = nome ? String(nome).trim() : null;
      return this;
    }

    limparMotivo() { this.motivo = null; return this; }
    limparMovimentacao() { this.movimentacao = null; return this; }

    estaVazia() { return this.numero === null && !this.motivo && !this.movimentacao && !this.clienteId; }
    estaIncompleta() { return this.numero === null && !this.estaVazia(); }

    toJSON() {
      return {
        numero: this.numero,
        motivo: this.motivo,
        movimentacao: this.movimentacao,
        cliente_id: this.clienteId,
      };
    }
  }

  /* ---------------------------------------------------------
     3b. CLASSE TabelaReserva — até 100 linhas
  --------------------------------------------------------- */
  const DOC_CSS = `<style>
    .rsv-doc{font-family:Arial,Helvetica,sans-serif;color:#101828;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .rsv-doc h1{font-size:20px;margin:0;color:#b42318}
    .rsv-doc h2{font-size:16px;margin:4px 0 10px}
    .rsv-doc .meta{display:flex;flex-wrap:wrap;gap:4px 22px;font-size:12px;color:#475467;border-top:2px solid #b42318;padding-top:8px;margin-bottom:10px}
    .rsv-doc .resumo{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
    .rsv-doc .resumo span{border:1px solid #d0d5dd;border-radius:4px;padding:4px 10px;font-size:12px;background:#f9fafb}
    .rsv-doc table{width:100%;border-collapse:collapse;font-size:13px}
    .rsv-doc th{background:#f2f4f7;border:1px solid #98a2b3;padding:6px 8px;text-align:center;letter-spacing:.5px}
    .rsv-doc td{border:1px solid #98a2b3;padding:5px 8px;text-align:center}
    .rsv-doc td.cli{text-align:left}
    .rsv-doc tr{page-break-inside:avoid}
    .rsv-doc thead{display:table-header-group}
    .rsv-doc .m,.rsv-doc .v{display:inline-block;min-width:26px;padding:1px 8px;border-radius:10px;font-weight:700;font-size:12px}
    .rsv-doc .mE{background:#fee4e2;color:#b42318}.rsv-doc .mV{background:#ffead5;color:#b54708}
    .rsv-doc .vVai{background:#dbeafe;color:#1d4ed8}.rsv-doc .vRetornou{background:#d1fadf;color:#067647}
    .rsv-doc .leg{margin-top:10px;font-size:11px;color:#475467}
  </style>`;

  class TabelaReserva {
    constructor({
      id = null,
      nome = '',
      criadoEm,
      criado_em,
      dataCriacao,
      data_criacao,
      horarioCriacao,
      horario_criacao,
      dataAtualizacao = null,
      atualizado_em = null,
      reservas = [],
      linhas,
      resumo,
    } = {}) {
      this.id = id ?? null;
      this.nome = String(nome || '').trim();
      const brutoCriado = criadoEm || criado_em;
      const criado = brutoCriado && !isNaN(Date.parse(brutoCriado)) ? new Date(brutoCriado) : new Date();
      const p = partesData(criado);
      this.criadoEm = criado.toISOString();
      this.dataCriacao = dataCriacao || data_criacao || p.data;
      this.horarioCriacao = horarioCriacao || horario_criacao || p.hora;
      this.dataAtualizacao = dataAtualizacao || atualizado_em || null;
      this._resumo = resumo || null;
      const lista = Array.isArray(linhas) ? linhas : (Array.isArray(reservas) ? reservas : []);
      this.reservas = [];
      lista.slice(0, MAX_LINHAS).forEach((r) => this.reservas.push(r instanceof Reserva ? r : new Reserva(r)));
    }

    adicionarReserva(dados = {}) {
      if (this.reservas.length >= MAX_LINHAS) throw new Error(`Limite de ${MAX_LINHAS} linhas por tabela atingido.`);
      const r = new Reserva(dados);
      this.reservas.push(r);
      this._resumo = null;
      return r;
    }

    removerReserva(alvo) {
      const i = typeof alvo === 'number' ? alvo : this.reservas.indexOf(alvo);
      if (i < 0 || i >= this.reservas.length) throw new Error('Linha não encontrada.');
      this._resumo = null;
      return this.reservas.splice(i, 1)[0];
    }

    editarReserva(indice, campos = {}) {
      const r = this.reservas[indice];
      if (!r) throw new Error('Linha não encontrada.');
      const teste = new Reserva(r.toJSON());
      if ('numero' in campos) teste.definirNumero(campos.numero);
      if ('motivo' in campos) teste.definirMotivo(campos.motivo);
      if ('movimentacao' in campos) teste.definirMovimentacao(campos.movimentacao);
      if ('cliente_id' in campos || 'clienteId' in campos) {
        teste.definirCliente('clienteId' in campos ? campos.clienteId : campos.cliente_id, campos.cliente);
      }
      r.numero = teste.numero;
      r.motivo = teste.motivo;
      r.movimentacao = teste.movimentacao;
      r.clienteId = teste.clienteId;
      r.cliente = teste.cliente;
      this._resumo = null;
      return r;
    }

    _resolver(alvos) {
      if (alvos === undefined || alvos === null) return [...this.reservas];
      return alvos.map((a) => (typeof a === 'number' ? this.reservas[a] : a))
        .filter((r, i, arr) => r && this.reservas.includes(r) && arr.indexOf(r) === i);
    }

    aplicarMotivoEmLote(valor, alvos) {
      new Reserva().definirMotivo(valor);
      const lista = this._resolver(alvos);
      lista.forEach((r) => r.definirMotivo(valor));
      this._resumo = null;
      return lista.length;
    }

    aplicarMovimentacaoEmLote(valor, alvos) {
      new Reserva().definirMovimentacao(valor);
      const lista = this._resolver(alvos);
      lista.forEach((r) => r.definirMovimentacao(valor));
      this._resumo = null;
      return lista.length;
    }

    limparMarcacoes(alvos, { motivo = true, movimentacao = true } = {}) {
      const lista = this._resolver(alvos);
      lista.forEach((r) => { if (motivo) r.limparMotivo(); if (movimentacao) r.limparMovimentacao(); });
      this._resumo = null;
      return lista.length;
    }

    validarTabela() {
      const erros = [];
      if (!this.nome) erros.push({ indice: null, mensagem: 'Informe o nome da tabela.' });
      if (this.nome.length > MAX_NOME) erros.push({ indice: null, mensagem: `O nome pode ter no máximo ${MAX_NOME} caracteres.` });
      if (this.reservas.length > MAX_LINHAS) erros.push({ indice: null, mensagem: `A tabela pode ter no máximo ${MAX_LINHAS} linhas.` });
      const vistos = new Map();
      this.reservas.forEach((r, i) => {
        const msgNum = r.validarNumero();
        if (msgNum) erros.push({ indice: i, mensagem: `Linha ${i + 1}: ${msgNum}` });
        else if (r.estaIncompleta()) erros.push({ indice: i, mensagem: `Linha ${i + 1}: informe o número da reserva (ou limpe a linha).` });
        else if (r.numero !== null) {
          if (vistos.has(r.numero)) erros.push({ indice: i, mensagem: `Linha ${i + 1}: a reserva ${r.numero} já aparece na linha ${vistos.get(r.numero) + 1}.` });
          else vistos.set(r.numero, i);
        }
      });
      return erros;
    }

    salvarTabela() {
      const erros = this.validarTabela();
      if (erros.length) { const e = new Error(erros[0].mensagem); e.erros = erros; throw e; }
      this.reservas = this.reservas.filter((r) => !r.estaVazia());
      this.dataAtualizacao = new Date().toISOString();
      this._resumo = null;
      return this;
    }

    contagens() {
      if (this._resumo && this.reservas.length === 0) return this._resumo;
      return {
        reservas: this.reservas.filter((r) => r.numero !== null).length,
        indo: this.reservas.filter((r) => r.movimentacao === 'Vai').length,
        retornados: this.reservas.filter((r) => r.movimentacao === 'Retornou').length,
        estragados: this.reservas.filter((r) => r.motivo === 'E').length,
        vencidos: this.reservas.filter((r) => r.motivo === 'V').length,
      };
    }

    ehRecente(agora = Date.now()) { return agora - Date.parse(this.criadoEm) < HORAS_NOVO * 3600 * 1000; }

    clonar() {
      return new TabelaReserva({
        id: this.id,
        nome: this.nome,
        criadoEm: this.criadoEm,
        dataCriacao: this.dataCriacao,
        horarioCriacao: this.horarioCriacao,
        dataAtualizacao: this.dataAtualizacao,
        resumo: this._resumo ? { ...this._resumo } : null,
        reservas: this.reservas.map((r) => ({ ...r.toJSON(), cliente: r.cliente })),
      });
    }

    gerarDocumento(agora = new Date()) {
      const g = partesData(agora);
      const c = this.contagens();
      const temCliente = this.reservas.some((r) => r.cliente || r.clienteId);
      const cols = temCliente ? 5 : 4;
      const linhas = this.reservas.length
        ? this.reservas.map((r, i) => `<tr><td>${i + 1}</td>
            <td>${r.motivo ? `<span class="m m${r.motivo}">${r.motivo}</span>` : ''}</td>
            <td><strong>${r.numero === null ? '' : r.numero}</strong></td>
            <td>${r.movimentacao ? `<span class="v v${r.movimentacao}">${esc(r.movimentacao)}</span>` : ''}</td>
            ${temCliente ? `<td class="cli">${esc(r.cliente || (r.clienteId ? `#${r.clienteId}` : '—'))}</td>` : ''}</tr>`).join('')
        : `<tr><td colspan="${cols}">Nenhuma reserva cadastrada.</td></tr>`;
      return `${DOC_CSS}<div class="rsv-doc">
        <h1>Extinsul Extintores</h1>
        <h2>Reservas — ${esc(this.nome)}</h2>
        <div class="meta">
          <span><strong>Tabela criada em:</strong> ${dataBR(this.dataCriacao)} às ${esc(this.horarioCriacao)}</span>
          <span><strong>Documento gerado em:</strong> ${dataBR(g.data)} às ${g.hora}</span>
        </div>
        <div class="resumo">
          <span><strong>Total de reservas:</strong> ${c.reservas}</span>
          <span><strong>Indo:</strong> ${c.indo}</span>
          <span><strong>Retornadas:</strong> ${c.retornados}</span>
          <span><strong>Estragadas (E):</strong> ${c.estragados}</span>
          <span><strong>Vencidas (V):</strong> ${c.vencidos}</span>
        </div>
        <table><thead><tr><th style="width:44px">Nº</th><th>MOTIVO</th><th>RESERVA</th><th>VAI / RETORNARAM</th>${temCliente ? '<th>CLIENTE</th>' : ''}</tr></thead>
        <tbody>${linhas}</tbody></table>
        <div class="leg">E = Estragado &nbsp;·&nbsp; V = Vencido</div></div>`;
    }

    toJSON() {
      return {
        id: this.id,
        nome: this.nome,
        criadoEm: this.criadoEm,
        dataCriacao: this.dataCriacao,
        horarioCriacao: this.horarioCriacao,
        dataAtualizacao: this.dataAtualizacao,
        reservas: this.reservas,
      };
    }
  }

  /* ---------------------------------------------------------
     3c. CLASSE GerenciadorReservas — comunicação com o banco
  --------------------------------------------------------- */
  class GerenciadorReservas {
    constructor({ getSessao, api } = {}) {
      this._getSessao = getSessao || (() => null);
      this._getApi = api || (() => (exTem('apiDe') ? Ex.apiDe('gerente') : null));
    }

    _exigirAdmin() { exigirAdmin(this._getSessao()); }
    _api() {
      const fn = typeof this._getApi === 'function' ? this._getApi() : this._getApi;
      if (!fn) throw new Error('Serviço de API indisponível.');
      return fn;
    }

    criarTabela(nome) {
      this._exigirAdmin();
      const n = String(nome || '').trim();
      if (!n) throw new Error('Informe o nome da tabela.');
      if (n.length > MAX_NOME) throw new Error(`O nome pode ter no máximo ${MAX_NOME} caracteres.`);
      return new TabelaReserva({ id: null, nome: n });
    }

    async listarTabelas() {
      this._exigirAdmin();
      const d = await this._api()('/reservas');
      return (d.itens || []).map((t) => new TabelaReserva({
        id: t.id,
        nome: t.nome,
        criado_em: t.criado_em,
        data_criacao: t.data_criacao,
        horario_criacao: t.horario_criacao,
        atualizado_em: t.atualizado_em,
        resumo: {
          reservas: Number(t.reservas || 0),
          indo: Number(t.indo || 0),
          retornados: Number(t.retornados || 0),
          estragados: Number(t.estragados || 0),
          vencidos: Number(t.vencidos || 0),
        },
      }));
    }

    async buscarTabela(id) {
      this._exigirAdmin();
      const d = await this._api()(`/reservas/${id}`);
      return new TabelaReserva({ ...d.tabela, linhas: d.linhas || [] });
    }

    async editarTabela(id) {
      return this.buscarTabela(id);
    }

    async salvarAlteracoes(tabela) {
      this._exigirAdmin();
      if (!(tabela instanceof TabelaReserva)) throw new Error('Tabela inválida.');
      tabela.salvarTabela();
      const payload = {
        nome: tabela.nome,
        linhas: tabela.reservas.map((r) => r.toJSON()),
      };
      const resp = tabela.id
        ? await this._api()(`/reservas/${tabela.id}`, { method: 'PUT', body: payload })
        : await this._api()('/reservas', { method: 'POST', body: payload });
      return new TabelaReserva({ ...resp.tabela, linhas: resp.linhas || [] });
    }

    async excluirTabela(id) {
      this._exigirAdmin();
      await this._api()(`/reservas/${id}`, { method: 'DELETE' });
      return true;
    }

    async listarEmprestimos(params) {
      this._exigirAdmin();
      return this._api()('/reservas-emprestimos', { params });
    }

    async devolverEmprestimo(id) {
      this._exigirAdmin();
      return this._api()(`/reservas-emprestimos/${id}/devolver`, { method: 'PUT' });
    }

    async excluirEmprestimo(id) {
      this._exigirAdmin();
      return this._api()(`/reservas-emprestimos/${id}`, { method: 'DELETE' });
    }
  }

  /* ---------------------------------------------------------
     4. INTERFACE
  --------------------------------------------------------- */
  const ESTILOS = `
  .rsv-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;border-bottom:1px solid #d5dae1;padding-bottom:10px}
  .rsv-tab{background:#fff;border:1px solid #d5dae1;color:#344054;border-radius:6px;padding:7px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
  .rsv-tab:hover{border-color:#c32727;color:#c32727}
  .rsv-tab.ativo{background:#c32727;border-color:#c32727;color:#fff}
  .rsv-migracao{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;border-left:4px solid #c32727}
  .rsv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px;margin-bottom:16px}
  .rsv-card{display:flex;flex-direction:column;gap:10px;margin-bottom:0}
  .rsv-card-topo{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  .rsv-nome{font-size:15px;word-break:break-word}
  .rsv-novo{background:#fff4d6;color:#9a6200;border:1px solid #f5aa16;border-radius:4px;font-size:10.5px;font-weight:700;letter-spacing:.4px;padding:2px 7px;white-space:nowrap}
  .rsv-data{font-size:12px}
  .rsv-cont{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
  .rsv-cont div{background:#f5f7fa;border-radius:6px;padding:7px 4px;text-align:center}
  .rsv-cont strong{display:block;font-size:18px;color:#172033}
  .rsv-cont span{font-size:10.5px;color:#68778a}
  .rsv-acoes{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto}
  .rsv-barra{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0 8px}
  .rsv-barra .rsv-conta{margin-left:auto;font-size:12px;color:#68778a}
  .rsv-lote-menu{border:1px solid #d5dae1;border-radius:6px;background:#f8fafc;margin-bottom:10px}
  .rsv-lote-menu.ativo{border-color:#c32727;background:#fff8f8}
  .rsv-lote-menu>summary{list-style:none;cursor:pointer;padding:8px 12px;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:8px;user-select:none}
  .rsv-lote-menu>summary::-webkit-details-marker{display:none}
  .rsv-lote-badge{font-size:12px;font-weight:500;color:#475467}
  .rsv-lote-menu.ativo .rsv-lote-badge{color:#c32727;font-weight:600}
  .rsv-lote{padding:8px 12px 12px;border-top:1px solid #e6e9ee}
  .rsv-escopo{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;font-size:13px;margin-bottom:8px}
  .rsv-escopo label{display:inline-flex;gap:6px;align-items:center;font-weight:normal;cursor:pointer}
  .rsv-escopo input{width:auto}
  .rsv-lote-linha{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;font-size:12px}
  .rsv-lote-linha b{min-width:92px;color:#475467}
  .rsv-tabela-wrap{overflow-x:auto;contain:inline-size;max-width:100%;border:1px solid #d5dae1;border-radius:6px;margin:8px 0;background:#fff}
  .rsv-tabela{width:100%;border-collapse:collapse;min-width:660px}
  .rsv-tabela th{background:#f0f3f7;font-size:12px;letter-spacing:.5px;text-align:left;padding:8px 10px;white-space:nowrap}
  .rsv-tabela td{padding:5px 8px;border-top:1px solid #e6e9ee}
  .rsv-tabela th:first-child,.rsv-tabela td:first-child{width:34px;text-align:center}
  .rsv-tabela .rsv-n{width:34px;color:#68778a;font-size:12px}
  .rsv-tabela input[type=checkbox]{width:auto}
  .rsv-tabela tr.rsv-marcada td{background:#eef5ff}
  .rsv-tabela tr.rsv-erro td{background:#fff1f0}
  .rsv-campo{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #d5dae1;border-radius:6px;font:inherit;background:#fff}
  .rsv-m-E{border-color:#d92d20;color:#b42318;background:#fef3f2;font-weight:600}
  .rsv-m-V{border-color:#f57c00;color:#b54708;background:#fff4e5;font-weight:600}
  .rsv-v-Vai{border-color:#2563eb;color:#1d4ed8;background:#eff6ff;font-weight:600}
  .rsv-v-Retornou{border-color:#16a36d;color:#067647;background:#ecfdf3;font-weight:600}
  .rsv-erros{border:1px solid #fda29b;background:#fef3f2;color:#b42318;border-radius:6px;padding:8px 12px;font-size:13px;margin-top:10px}
  .rsv-erros ul{margin:4px 0 0 18px;padding:0}
  .rsv-rodape{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:12px}
  .rsv-fundo{position:fixed;inset:0;background:rgba(16,24,40,.55);display:flex;align-items:center;justify-content:center;padding:16px;z-index:3000}
  .rsv-modal{background:#fff;border-radius:10px;padding:20px;width:100%;max-width:440px;box-shadow:0 12px 40px rgba(0,0,0,.25)}
  .rsv-modal h3{margin:0 0 12px}
  .rsv-modal input{width:100%;box-sizing:border-box;margin-top:4px}
  .rsv-modal-acoes{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
  @media (max-width:640px){
    .rsv-cont{grid-template-columns:repeat(3,minmax(0,1fr))}
    .rsv-barra .rsv-conta{margin-left:0;width:100%}
    .rsv-rodape .btn{flex:1}
  }`;

  function injetarEstilos() {
    if (typeof document === 'undefined' || document.getElementById('rsv-estilos')) return;
    const s = document.createElement('style');
    s.id = 'rsv-estilos';
    s.textContent = ESTILOS;
    document.head.appendChild(s);
  }

  let sessaoAtual = null;
  let apiAtual = null;
  let abaAtiva = 'tabelas'; // 'tabelas' | 'emprestimos'
  const gerenciador = new GerenciadorReservas({ getSessao: () => sessaoAtual, api: () => apiAtual });

  function lerPrototipoLocal() {
    try {
      const dados = JSON.parse((raiz.localStorage && raiz.localStorage.getItem(CHAVE_STORAGE)) || 'null');
      if (!dados || !Array.isArray(dados.tabelas)) return [];
      return dados.tabelas.filter((t) => t && t.nome);
    } catch {
      return [];
    }
  }

  function imprimirTabela(t) {
    const titulo = `Reservas — ${t.nome}`;
    const html = t.gerarDocumento();
    if (exTem('imprimir')) { Ex.imprimir(titulo, html); return; }
    const w = raiz.open('', '_blank');
    if (!w) { avisar('O navegador bloqueou a janela de impressão. Permita pop-ups para este site.', true); return; }
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(titulo)}</title></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }

  function pedirNome() {
    return new Promise((resolve) => {
      const fundo = document.createElement('div');
      fundo.className = 'rsv-fundo';
      fundo.innerHTML = `<form class="rsv-modal" role="dialog" aria-modal="true" aria-labelledby="rsv-m-t">
        <h3 id="rsv-m-t">Nova tabela de reservas</h3>
        <label for="rsv-m-nome">Nome da tabela *</label>
        <input id="rsv-m-nome" maxlength="${MAX_NOME}" autocomplete="off" placeholder="Ex.: Extintores vencidos — 07/10">
        <div class="ajuda">Exemplos: Reservas de novembro · Reservas para manutenção · Controle de reservas — viagem.</div>
        <div class="form-erro" style="display:none"></div>
        <div class="rsv-modal-acoes"><button type="button" class="btn" data-x>Cancelar</button><button class="btn btn-primario" type="submit">Criar e preencher</button></div></form>`;
      document.body.appendChild(fundo);
      const form = fundo.querySelector('form'), campo = fundo.querySelector('input'), erro = fundo.querySelector('.form-erro');
      const fechar = (v) => { document.removeEventListener('keydown', teclas); fundo.remove(); resolve(v); };
      const teclas = (e) => { if (e.key === 'Escape') fechar(null); };
      document.addEventListener('keydown', teclas);
      fundo.querySelector('[data-x]').onclick = () => fechar(null);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = campo.value.trim();
        if (!v) { erro.textContent = 'Informe o nome da tabela.'; erro.style.display = 'block'; campo.focus(); return; }
        fechar(v);
      });
      campo.focus();
    });
  }

  function cabecalhoSubAbas(cont, { mostrarBotaoNova = false } = {}) {
    return `
      <div class="titulo">
        <div><h2>Gerenciamento de Reservas</h2><p class="sub">Crie, organize e acompanhe os extintores reserva e empréstimos registrados pelos motoristas.</p></div>
        ${mostrarBotaoNova ? '<button class="btn btn-primario" id="rsv-nova">+ Nova tabela</button>' : ''}
      </div>
      <div class="rsv-tabs" role="tablist">
        <button type="button" class="rsv-tab${abaAtiva === 'tabelas' ? ' ativo' : ''}" data-subaba="tabelas">Tabelas de reservas</button>
        <button type="button" class="rsv-tab${abaAtiva === 'emprestimos' ? ' ativo' : ''}" data-subaba="emprestimos">Empréstimos</button>
      </div>`;
  }

  function ligarSubAbas(cont) {
    cont.querySelectorAll('[data-subaba]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.subaba === abaAtiva) return;
        abaAtiva = b.dataset.subaba;
        if (abaAtiva === 'tabelas') mostrarLista(cont);
        else mostrarEmprestimos(cont);
      });
    });
  }

  /* ---------- Sub-aba Empréstimos (gerente visualiza todos os empréstimos) ---------- */
  function mostrarEmprestimos(cont) {
    abaAtiva = 'emprestimos';
    cont.innerHTML = `${cabecalhoSubAbas(cont)}<div id="rsv-emp-lista"></div>`;
    ligarSubAbas(cont);
    const area = cont.querySelector('#rsv-emp-lista');
    Ex.lista(area, {
      filtros: [
        { nome: 'q', tipo: 'busca', placeholder: 'Nº da reserva, cliente ou motorista' },
        { nome: 'status', tipo: 'select', opcoes: [{ v: 'aberto', t: 'Em aberto' }, { v: 'devolvido', t: 'Devolvido' }], todos: 'Todas as situações' },
      ],
      carregar: (p) => gerenciador.listarEmprestimos(p),
      vazio: 'Nenhum empréstimo de reserva registrado.',
      colunas: [
        { t: 'Nº Reserva', f: (l) => `<strong>${esc(l.numero_reserva)}</strong>` },
        { t: 'Cliente', f: (l) => `${esc(l.cliente)} <span class="mudo">(#${l.cliente_id})</span>` },
        { t: 'Motorista', f: (l) => esc(l.motorista) },
        { t: 'Emprestado em', classe: 'nowrap', f: (l) => dataHoraBR(l.criado_em) },
        { t: 'Devolvido em', classe: 'nowrap', f: (l) => (l.devolvido_em ? dataHoraBR(l.devolvido_em) : '—') },
        {
          t: 'Situação',
          f: (l) => (l.devolvido_em
            ? '<span class="status verde">Devolvido</span>'
            : '<span class="status amarelo">Em aberto</span>'),
        },
      ],
      acoes: (l) => [
        ...(l.devolvido_em ? [] : [{ rotulo: 'Registrar devolução', acao: 'devolver', classe: 'btn-verde' }]),
        { rotulo: 'Excluir', acao: 'excluir', classe: 'btn-perigo' },
      ],
      aoAcao: async (acao, l, c) => {
        if (acao === 'devolver') {
          if (!(await confirmar(`Registrar a devolução da reserva ${l.numero_reserva} (cliente ${l.cliente})?`, { textoOk: 'Confirmar devolução' }))) return;
          try {
            await gerenciador.devolverEmprestimo(l.id);
            avisar('Devolução registrada.');
            c.recarregar();
          } catch (err) { avisar(err.message, true); }
        } else if (acao === 'excluir') {
          if (!(await confirmar(`Excluir o registro do empréstimo da reserva ${l.numero_reserva}? Isso não pode ser desfeito.`, { textoOk: 'Excluir', perigo: true }))) return;
          try {
            await gerenciador.excluirEmprestimo(l.id);
            avisar('Empréstimo excluído.');
            c.recarregar();
          } catch (err) { avisar(err.message, true); }
        }
      },
    });
  }

  /* ---------- Sub-aba Tabelas: lista ---------- */
  async function mostrarLista(cont) {
    abaAtiva = 'tabelas';
    const loaderHTML = exTem('carregando') ? Ex.carregando({ texto: 'Carregando…' }) : '<div class="carregando-pag">Carregando…</div>';
    cont.innerHTML = `${cabecalhoSubAbas(cont, { mostrarBotaoNova: true })}${loaderHTML}`;
    ligarSubAbas(cont);

    const btnNova = cont.querySelector('#rsv-nova');
    btnNova.addEventListener('click', async () => {
      const nome = await pedirNome();
      if (nome === null) return;
      try { await abrirEditor(cont, gerenciador.criarTabela(nome), true); }
      catch (e) { avisar(e.message, true); }
    });

    let tabelas;
    try { tabelas = await gerenciador.listarTabelas(); }
    catch (e) {
      if (!ehAdmin(sessaoAtual)) return negar(cont, e.message);
      cont.querySelector('.carregando-pag').outerHTML = `<div class="box"><div class="aviso-vazio">${esc(e.message)}</div></div>`;
      return;
    }

    const locais = lerPrototipoLocal();
    const avisoMigracao = locais.length ? `
      <div class="box rsv-migracao" id="rsv-mig-box">
        <div>
          <strong>Tabelas antigas encontradas neste navegador (${locais.length})</strong>
          <div class="mudo" style="font-size:12px">Envie para o banco de dados para compartilhar com a equipe.</div>
        </div>
        <button type="button" class="btn btn-sm btn-primario" id="rsv-migrar">Enviar tabelas deste navegador para o banco</button>
      </div>` : '';

    const cartao = (t) => {
      const c = t.contagens();
      const rotuloNovo = `NOVO · ${dataBR(t.dataCriacao)} ${esc(t.horarioCriacao)}`;
      return `<div class="box rsv-card" data-id="${esc(t.id)}">
        <div class="rsv-card-topo"><strong class="rsv-nome">${esc(t.nome)}</strong>${t.ehRecente() ? `<span class="rsv-novo" title="Tabela criada recentemente">${rotuloNovo}</span>` : ''}</div>
        <div class="mudo rsv-data">Criada em ${dataBR(t.dataCriacao)} às ${esc(t.horarioCriacao)}</div>
        <div class="rsv-cont">
          <div><strong>${c.reservas}</strong><span>Reservas</span></div>
          <div><strong>${c.indo}</strong><span>Indo</span></div>
          <div><strong>${c.retornados}</strong><span>Retornados</span></div>
          <div><strong>${c.estragados}</strong><span>Estragados</span></div>
          <div><strong>${c.vencidos}</strong><span>Vencidos</span></div>
        </div>
        <div class="rsv-acoes">
          <button class="btn btn-primario btn-sm" data-acao="abrir">Abrir / editar</button>
          <button class="btn btn-sm" data-acao="doc">Gerar documento</button>
          <button class="btn btn-sm btn-perigo" data-acao="excluir">Excluir</button>
        </div></div>`;
    };

    const listaHTML = `
      ${avisoMigracao}
      ${tabelas.length
        ? `<div class="rsv-grid">${tabelas.map(cartao).join('')}</div>`
        : '<div class="box"><div class="aviso-vazio">Nenhuma tabela criada ainda. Clique em <strong>+ Nova tabela</strong> para começar.</div></div>'}`;

    const loader = cont.querySelector('.carregando-pag');
    if (loader) loader.outerHTML = listaHTML;

    const btnMig = cont.querySelector('#rsv-migrar');
    if (btnMig) {
      btnMig.addEventListener('click', async () => {
        btnMig.disabled = true;
        if (exTem('carregando')) btnMig.innerHTML = Ex.carregando({ tamanho: 'sm', inline: true, texto: 'Enviando…' });
        else btnMig.textContent = 'Enviando…';
        let ok = 0;
        const restantes = [];
        for (const tBruta of locais) {
          try {
            const tab = new TabelaReserva(tBruta);
            tab.id = null;
            await gerenciador.salvarAlteracoes(tab);
            ok += 1;
          } catch {
            restantes.push(tBruta);
          }
        }
        if (!restantes.length) {
          try { raiz.localStorage.removeItem(CHAVE_STORAGE); } catch { /* ignora */ }
          avisar(`${ok} tabela(s) enviada(s) para o banco.`);
        } else {
          try { raiz.localStorage.setItem(CHAVE_STORAGE, JSON.stringify({ versao: 1, tabelas: restantes })); } catch { /* ignora */ }
          avisar(`${ok} tabela(s) enviada(s), mas ${restantes.length} falharam e foram mantidas no navegador.`, true);
        }
        mostrarLista(cont);
      });
    }

    const grade = cont.querySelector('.rsv-grid');
    if (grade) grade.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-acao]');
      if (!b) return;
      const id = Number(b.closest('[data-id]').dataset.id);
      const tResumo = tabelas.find((x) => x.id === id);
      try {
        if (b.dataset.acao === 'abrir') {
          b.disabled = true;
          const completa = await gerenciador.editarTabela(id);
          await abrirEditor(cont, completa, false);
        } else if (b.dataset.acao === 'doc') {
          b.disabled = true;
          const completa = await gerenciador.buscarTabela(id);
          b.disabled = false;
          imprimirTabela(completa);
        } else if (b.dataset.acao === 'excluir') {
          const qtd = tResumo ? tResumo.contagens().reservas : 0;
          const nomeT = tResumo ? tResumo.nome : `#${id}`;
          if (!(await confirmar(`Excluir a tabela "${nomeT}"? Todas as ${qtd} linhas dela serão apagadas. Isso não pode ser desfeito.`, { textoOk: 'Excluir', perigo: true }))) return;
          await gerenciador.excluirTabela(id);
          avisar('Tabela excluída.');
          mostrarLista(cont);
        }
      } catch (err) {
        b.disabled = false;
        avisar(err.message, true);
      }
    });
  }

  function negar(cont, msg) {
    cont.innerHTML = `<div class="box"><div class="aviso-vazio">${esc(msg || 'Acesso restrito a administradores.')}</div></div>`;
  }

  /* ---------- Editor da tabela (criar / editar) ---------- */
  async function abrirEditor(cont, rasc, ehNova) {
    let clientes = [];
    try {
      const op = await apiAtual('/opcoes');
      clientes = Array.isArray(op.clientes) ? op.clientes : [];
    } catch {
      clientes = [];
    }

    const sel = new Set();
    const nomeInput = () => cont.querySelector('#rsv-nome');
    const instantaneo = () => JSON.stringify({ n: nomeInput().value.trim(), r: rasc.reservas });
    let base = null;
    const sujo = () => instantaneo() !== base;

    cont.innerHTML = `
      <div class="titulo"><div>
        <h2>${ehNova ? 'Nova tabela de reservas' : 'Editar tabela de reservas'}</h2>
        <p class="sub">${ehNova ? 'Preencha as linhas e clique em Salvar tabela.' : `Criada em ${dataBR(rasc.dataCriacao)} às ${esc(rasc.horarioCriacao)}.`}</p>
      </div></div>
      <div class="box">
        <div class="form-grid"><div class="cheio"><label for="rsv-nome">Nome da tabela *</label>
          <input id="rsv-nome" maxlength="${MAX_NOME}" autocomplete="off" value="${esc(rasc.nome)}"></div></div>
        <div class="rsv-erros" id="rsv-erros" style="display:none" role="alert"></div>

        <div class="rsv-barra">
          <button class="btn" type="button" id="rsv-add">+ Adicionar linha</button>
          <button class="btn btn-perigo" type="button" id="rsv-rem">Remover selecionadas</button>
          <span class="rsv-conta" id="rsv-conta"></span>
        </div>

        <details class="rsv-lote-menu" id="rsv-lote-menu">
          <summary>
            <span>Ações em lote</span>
            <span class="rsv-lote-badge" id="rsv-lote-badge">Nenhuma linha selecionada</span>
          </summary>
          <div class="rsv-lote">
            <div class="rsv-escopo"><strong>Aplicar em lote em:</strong>
              <label><input type="radio" name="rsv-esc" value="sel" checked> Linhas selecionadas (<span id="rsv-nsel">0</span>)</label>
              <label><input type="radio" name="rsv-esc" value="todas"> Todas as linhas</label></div>
            <div class="rsv-lote-linha"><b>Motivo:</b>
              <button class="btn btn-sm" type="button" data-lote="motivo:E">Aplicar E — Estragado</button>
              <button class="btn btn-sm" type="button" data-lote="motivo:V">Aplicar V — Vencido</button>
              <button class="btn btn-sm" type="button" data-lote="motivo:">Limpar motivo</button></div>
            <div class="rsv-lote-linha"><b>Movimentação:</b>
              <button class="btn btn-sm" type="button" data-lote="mov:Vai">Aplicar Vai</button>
              <button class="btn btn-sm" type="button" data-lote="mov:Retornou">Aplicar Retornou</button>
              <button class="btn btn-sm" type="button" data-lote="mov:">Limpar situação</button></div>
            <div class="rsv-lote-linha"><b>Tudo:</b><button class="btn btn-sm" type="button" data-lote="tudo:">Limpar marcações</button></div>
          </div>
        </details>

        <div class="rsv-tabela-wrap"><table class="rsv-tabela">
          <thead><tr><th><input type="checkbox" id="rsv-todas" aria-label="Selecionar todas as linhas"></th><th>#</th><th>MOTIVO</th><th>RESERVA</th><th>VAI / RETORNARAM</th><th>CLIENTE</th><th></th></tr></thead>
          <tbody id="rsv-corpo"></tbody></table></div>

        <div class="rsv-rodape">
          <button class="btn" type="button" id="rsv-cancelar">Cancelar</button>
          <button class="btn" type="button" id="rsv-doc">Gerar documento</button>
          <button class="btn btn-primario" type="button" id="rsv-salvar">Salvar tabela</button>
        </div>
      </div>`;

    const $ = (id) => cont.querySelector('#' + id);
    const corpo = $('rsv-corpo'), todas = $('rsv-todas');

    const opcoesClientesHTML = (r) => {
      const temNaLista = r.clienteId && clientes.some((c) => c.id === r.clienteId);
      const extra = r.clienteId && !temNaLista
        ? `<option value="${r.clienteId}" selected>${esc(r.cliente || `Cliente #${r.clienteId}`)}</option>`
        : '';
      return `<option value="">—</option>${extra}${clientes.map((c) => `<option value="${c.id}"${r.clienteId === c.id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}`;
    };

    const linhaHTML = (r, i) => `<tr data-i="${i}"${sel.has(r) ? ' class="rsv-marcada"' : ''}>
      <td><input type="checkbox" data-campo="sel"${sel.has(r) ? ' checked' : ''} aria-label="Selecionar linha ${i + 1}"></td>
      <td class="rsv-n">${i + 1}</td>
      <td><select data-campo="motivo" class="rsv-campo${r.motivo ? ' rsv-m-' + r.motivo : ''}" aria-label="Motivo da linha ${i + 1}">
        <option value="">—</option>
        ${Object.keys(MOTIVOS).map((k) => `<option value="${k}"${r.motivo === k ? ' selected' : ''}>${k} — ${MOTIVOS[k]}</option>`).join('')}</select></td>
      <td><input type="text" data-campo="numero" class="rsv-campo" inputmode="numeric" autocomplete="off" maxlength="${MAX_DIGITOS}" placeholder="Nº" value="${r.numero === null ? '' : r.numero}" aria-label="Número da reserva da linha ${i + 1}"></td>
      <td><select data-campo="mov" class="rsv-campo${r.movimentacao ? ' rsv-v-' + r.movimentacao : ''}" aria-label="Movimentação da linha ${i + 1}">
        <option value="">—</option>
        ${MOVIMENTACOES.map((m) => `<option value="${m}"${r.movimentacao === m ? ' selected' : ''}>${m}</option>`).join('')}</select></td>
      <td><select data-campo="cliente" class="rsv-campo" aria-label="Cliente da linha ${i + 1}">${opcoesClientesHTML(r)}</select></td>
      <td><button class="btn btn-sm btn-perigo" type="button" data-acao="rem" title="Remover linha" aria-label="Remover linha ${i + 1}">✕</button></td></tr>`;

    function atualizar() {
      const n = rasc.reservas.length, ns = rasc.reservas.filter((r) => sel.has(r)).length;
      $('rsv-conta').textContent = `${n} de ${MAX_LINHAS} linhas`;
      $('rsv-nsel').textContent = ns;
      $('rsv-add').disabled = n >= MAX_LINHAS;
      $('rsv-rem').disabled = ns === 0;
      todas.checked = n > 0 && ns === n;
      todas.indeterminate = ns > 0 && ns < n;
      const menuLote = $('rsv-lote-menu');
      menuLote.classList.toggle('ativo', ns > 0);
      $('rsv-lote-badge').textContent = ns > 0
        ? `${ns} selecionada${ns === 1 ? '' : 's'}`
        : 'Nenhuma selecionada (ou aplique em todas)';
    }
    function pintar() {
      corpo.innerHTML = rasc.reservas.length
        ? rasc.reservas.map(linhaHTML).join('')
        : '<tr><td colspan="7" class="mudo" style="text-align:center;padding:14px">Tabela vazia. Clique em “+ Adicionar linha”.</td></tr>';
      atualizar();
    }
    const numeroDaLinha = (i) => corpo.querySelector(`tr[data-i="${i}"] [data-campo=numero]`);

    function adicionarLinha() {
      try { rasc.adicionarReserva(); } catch (e) { avisar(e.message, true); return false; }
      pintar();
      const inp = numeroDaLinha(rasc.reservas.length - 1);
      if (inp) { inp.focus(); inp.scrollIntoView({ block: 'nearest' }); }
      return true;
    }

    let ultimoAviso = 0;
    corpo.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.campo !== 'numero') return;
      const tr = el.closest('tr'), r = rasc.reservas[+tr.dataset.i];
      const limpo = el.value.replace(/\D/g, '').slice(0, MAX_DIGITOS);
      if (limpo !== el.value) {
        el.value = limpo;
        if (Date.now() - ultimoAviso > 2500) { ultimoAviso = Date.now(); avisar('A coluna RESERVA aceita somente números inteiros.', true); }
      }
      r.definirNumero(limpo);
      tr.classList.remove('rsv-erro');
    });
    corpo.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.dataset.campo !== 'numero') return;
      e.preventDefault();
      const i = +e.target.closest('tr').dataset.i, prox = numeroDaLinha(i + 1);
      if (prox) prox.focus(); else adicionarLinha();
    });
    corpo.addEventListener('change', (e) => {
      const el = e.target, campo = el.dataset.campo;
      if (!campo || campo === 'numero') return;
      const tr = el.closest('tr'), r = rasc.reservas[+tr.dataset.i];
      try {
        if (campo === 'motivo') { r.definirMotivo(el.value); el.className = 'rsv-campo' + (r.motivo ? ' rsv-m-' + r.motivo : ''); }
        else if (campo === 'mov') { r.definirMovimentacao(el.value); el.className = 'rsv-campo' + (r.movimentacao ? ' rsv-v-' + r.movimentacao : ''); }
        else if (campo === 'cliente') {
          const cid = el.value ? Number(el.value) : null;
          const cli = cid ? clientes.find((c) => c.id === cid) : null;
          r.definirCliente(cid, cli ? cli.nome : null);
        } else if (campo === 'sel') {
          if (el.checked) sel.add(r); else sel.delete(r);
          tr.classList.toggle('rsv-marcada', el.checked);
          atualizar();
        }
        tr.classList.remove('rsv-erro');
      } catch (err) { avisar(err.message, true); pintar(); }
    });
    corpo.addEventListener('click', (e) => {
      const b = e.target.closest('[data-acao=rem]');
      if (!b) return;
      const r = rasc.reservas[+b.closest('tr').dataset.i];
      rasc.removerReserva(r);
      sel.delete(r);
      pintar();
    });

    todas.addEventListener('change', () => {
      if (todas.checked) rasc.reservas.forEach((r) => sel.add(r)); else sel.clear();
      pintar();
    });
    $('rsv-add').addEventListener('click', adicionarLinha);
    $('rsv-rem').addEventListener('click', async () => {
      const alvos = rasc.reservas.filter((r) => sel.has(r));
      if (!alvos.length) return;
      if (!(await confirmar(`Remover ${alvos.length} linha(s) selecionada(s)? (Só vale ao salvar a tabela.)`, { textoOk: 'Remover', perigo: true }))) return;
      alvos.forEach((r) => { rasc.removerReserva(r); sel.delete(r); });
      pintar();
    });

    cont.querySelector('.rsv-lote').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-lote]');
      if (!b) return;
      const [tipo, bruto] = b.dataset.lote.split(':'), valor = bruto || null;
      const escopo = cont.querySelector('input[name=rsv-esc]:checked').value;
      const alvos = escopo === 'todas' ? [...rasc.reservas] : rasc.reservas.filter((r) => sel.has(r));
      if (!alvos.length) { avisar(escopo === 'todas' ? 'A tabela não tem linhas.' : 'Selecione ao menos uma linha (ou escolha “Todas as linhas”).', true); return; }

      const campo = tipo === 'motivo' ? 'motivo' : 'movimentacao';
      const mudam = alvos.filter((r) => (tipo === 'tudo' ? (r.motivo || r.movimentacao) : r[campo] !== valor));
      if (!mudam.length) { avisar('Nenhuma linha precisa de alteração.'); return; }
      const substituem = mudam.filter((r) => (tipo === 'tudo' ? true : r[campo] !== null));
      if (escopo === 'todas' || substituem.length) {
        const acao = b.textContent.trim();
        const aviso = substituem.length ? ` ${substituem.length} linha(s) já têm valor, que será substituído.` : '';
        if (!(await confirmar(`${acao} em ${mudam.length} linha(s)?${aviso}`, { textoOk: 'Aplicar' }))) return;
      }
      try {
        if (tipo === 'motivo') rasc.aplicarMotivoEmLote(valor, mudam);
        else if (tipo === 'mov') rasc.aplicarMovimentacaoEmLote(valor, mudam);
        else rasc.limparMarcacoes(mudam);
        pintar();
        avisar(`${mudam.length} linha(s) atualizada(s).`);
      } catch (err) { avisar(err.message, true); }
    });

    function mostrarErros(erros) {
      const caixa = $('rsv-erros');
      caixa.innerHTML = `<strong>Corrija antes de salvar:</strong><ul>${erros.map((x) => `<li>${esc(x.mensagem)}</li>`).join('')}</ul>`;
      caixa.style.display = 'block';
      corpo.querySelectorAll('tr.rsv-erro').forEach((tr) => tr.classList.remove('rsv-erro'));
      erros.forEach((x) => { if (x.indice !== null) { const tr = corpo.querySelector(`tr[data-i="${x.indice}"]`); if (tr) tr.classList.add('rsv-erro'); } });
      const primeira = corpo.querySelector('tr.rsv-erro');
      (primeira || caixa).scrollIntoView({ block: 'center' });
    }

    const btnSalvar = $('rsv-salvar');
    btnSalvar.addEventListener('click', async () => {
      const caixaErros = $('rsv-erros');
      caixaErros.style.display = 'none';
      rasc.nome = nomeInput().value.trim();
      const erros = rasc.validarTabela();
      if (erros.length) { mostrarErros(erros); avisar('Há problemas na tabela. Veja os avisos.', true); return; }

      const vazias = rasc.reservas.filter((r) => r.estaVazia()).length;
      const copiaEnvio = rasc.clonar();
      btnSalvar.disabled = true;
      btnSalvar.textContent = 'Salvando…';
      try {
        await gerenciador.salvarAlteracoes(copiaEnvio);
        avisar(`Tabela salva.${vazias ? ` ${vazias} linha(s) vazia(s) foram descartadas.` : ''}`);
        mostrarLista(cont);
      } catch (err) {
        btnSalvar.disabled = false;
        btnSalvar.textContent = 'Salvar tabela';
        mostrarErros([{ indice: null, mensagem: err.message }]);
        avisar(err.message, true);
      }
    });

    $('rsv-cancelar').addEventListener('click', async () => {
      if (sujo() && !(await confirmar('Descartar as alterações não salvas desta tabela?', { textoOk: 'Descartar', perigo: true }))) return;
      mostrarLista(cont);
    });

    $('rsv-doc').addEventListener('click', () => {
      if (!rasc.id || ehNova || sujo()) { avisar('Salve a tabela antes de gerar o documento.', true); return; }
      imprimirTabela(rasc);
    });

    pintar();
    base = instantaneo();
    nomeInput().focus();
  }

  /* ---------- Ponto de entrada da página ---------- */
  async function pagina(cont, ctx) {
    sessaoAtual = (ctx && ctx.sessao) || null;
    apiAtual = (ctx && ctx.api) || (exTem('apiDe') ? Ex.apiDe('gerente') : null);
    injetarEstilos();
    if (!ehAdmin(sessaoAtual)) return negar(cont, 'Acesso negado: apenas administradores podem usar as Reservas.');
    abaAtiva = 'tabelas';
    await mostrarLista(cont);
  }

  const api = { Reserva, TabelaReserva, GerenciadorReservas, pagina, ehAdmin, MAX_LINHAS, MOTIVOS, MOVIMENTACOES };
  raiz.ExReservas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);