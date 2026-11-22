/* ==========================================================
   Módulo RESERVAS — painel do GERENTE (administrador)
   ----------------------------------------------------------
   Arquivo NOVO e independente. Nada do sistema existente foi
   reescrito: app.js só registra a página `reservas` e o
   index.html só ganhou o item de menu + este <script>.

   Estrutura:
     1. Constantes e utilitários
     2. Controle de permissões (exigirAdmin)
     3. Classes: Reserva, TabelaReserva, GerenciadorReservas
     4. Interface (lista, criação, editor, lote, impressão)

   PROTÓTIPO: os dados ficam em memória e são espelhados no
   localStorage do navegador (por navegador/computador).
   Isso NÃO é banco de dados e NÃO é compartilhado entre
   usuários nem dispositivos.
   ========================================================== */
(function (raiz) {
  'use strict';

  /* ---------------------------------------------------------
     1. CONSTANTES E UTILITÁRIOS
  --------------------------------------------------------- */
  const MOTIVOS = Object.freeze({ E: 'Estragado', V: 'Vencido' });
  const MOVIMENTACOES = Object.freeze(['Vai', 'Retornou']);
  const MAX_LINHAS = 100;          // limite de linhas por tabela
  const MAX_DIGITOS = 9;           // evita números gigantes / perda de precisão
  const MAX_NOME = 100;
  const HORAS_NOVO = 48;           // por quanto tempo a tabela exibe o selo NOVO
  const CHAVE_STORAGE = 'extinsul.reservas.prototipo.v1';
  const PERFIL_ADMIN = 'gerente';  // perfil do sistema equivalente a "Administrador"

  const pad = (n) => String(n).padStart(2, '0');
  const partesData = (d) => ({
    data: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hora: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  });
  const dataBR = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // `Ex` vem do common.js (const global, não fica em window): sempre checar com typeof.
  const exTem = (fn) => typeof Ex !== 'undefined' && Ex && typeof Ex[fn] === 'function';
  const avisar = (msg, erro) => (exTem('toast') ? Ex.toast(msg, !!erro) : raiz.alert && raiz.alert(msg));
  const confirmar = (msg, opcoes) => (exTem('confirmar')
    ? Ex.confirmar(msg, opcoes)
    : Promise.resolve(raiz.confirm ? raiz.confirm(msg) : false));

  /* ---------------------------------------------------------
     2. CONTROLE DE PERMISSÕES
     Administrador = perfil "gerente" da sessão já autenticada.
     Operador e motorista nunca passam: a checagem acontece em
     TODAS as operações do gerenciador, não só no menu/botões.
     (Importante: no navegador isso é só uma camada de proteção
     do protótipo. Quando houver backend, a API precisa validar
     o perfil também — o navegador pode ser adulterado.)
  --------------------------------------------------------- */
  const ehAdmin = (sessao) => !!sessao && sessao.perfil === PERFIL_ADMIN;
  function exigirAdmin(sessao) {
    if (!ehAdmin(sessao)) throw new Error('Acesso negado: apenas administradores podem usar as Reservas.');
  }

  /* ---------------------------------------------------------
     3a. CLASSE Reserva — um extintor reserva (uma linha da tabela)
  --------------------------------------------------------- */
  class Reserva {
    constructor({ numero = null, motivo = null, movimentacao = null } = {}) {
      this.numero = null;          // Number inteiro >= 0, ou null (linha ainda vazia)
      this.motivo = null;          // 'E' | 'V' | null
      this.movimentacao = null;    // 'Vai' | 'Retornou' | null
      this.definirNumero(numero);
      this.definirMotivo(motivo);
      this.definirMovimentacao(movimentacao);
    }

    /** Converte a entrada em Number inteiro ou null. Lança erro se inválida. */
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

    /** Retorna mensagem de erro ou null. Número vazio é permitido aqui (a tabela decide). */
    validarNumero() {
      if (this.numero === null) return null;
      if (!Number.isInteger(this.numero) || this.numero < 0) return 'Número de reserva inválido.';
      return null;
    }

    /** Aceita somente 'E', 'V' ou vazio. */
    definirMotivo(valor) {
      if (valor === null || valor === undefined || valor === '') this.motivo = null;
      else if (typeof valor === 'string' && Object.prototype.hasOwnProperty.call(MOTIVOS, valor)) this.motivo = valor;
      else throw new Error('Motivo inválido: use somente E (Estragado), V (Vencido) ou deixe vazio.');
      return this;
    }

    /** Aceita somente 'Vai', 'Retornou' ou vazio. */
    definirMovimentacao(valor) {
      if (valor === null || valor === undefined || valor === '') this.movimentacao = null;
      else if (MOVIMENTACOES.includes(valor)) this.movimentacao = valor;
      else throw new Error('Situação inválida: use somente Vai, Retornou ou deixe vazio.');
      return this;
    }

    limparMotivo() { this.motivo = null; return this; }
    limparMovimentacao() { this.movimentacao = null; return this; }

    estaVazia() { return this.numero === null && !this.motivo && !this.movimentacao; }
    /** Tem motivo/situação, mas falta o número. */
    estaIncompleta() { return this.numero === null && !this.estaVazia(); }

    toJSON() { return { numero: this.numero, motivo: this.motivo, movimentacao: this.movimentacao }; }
  }

  /* ---------------------------------------------------------
     3b. CLASSE TabelaReserva — uma tabela de até 100 reservas
  --------------------------------------------------------- */
  const DOC_CSS = `<style>
    .rsv-doc{font-family:Arial,Helvetica,sans-serif;color:#101828;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .rsv-doc h1{font-size:20px;margin:0;color:#b42318}
    .rsv-doc h2{font-size:16px;margin:4px 0 10px}
    .rsv-doc .meta{display:flex;flex-wrap:wrap;gap:4px 22px;font-size:12px;color:#475467;border-top:2px solid #b42318;padding-top:8px;margin-bottom:12px}
    .rsv-doc table{width:100%;border-collapse:collapse;font-size:13px}
    .rsv-doc th{background:#f2f4f7;border:1px solid #98a2b3;padding:6px 8px;text-align:center;letter-spacing:.5px}
    .rsv-doc td{border:1px solid #98a2b3;padding:5px 8px;text-align:center}
    .rsv-doc tr{page-break-inside:avoid}
    .rsv-doc thead{display:table-header-group}
    .rsv-doc .m,.rsv-doc .v{display:inline-block;min-width:26px;padding:1px 8px;border-radius:10px;font-weight:700;font-size:12px}
    .rsv-doc .mE{background:#fee4e2;color:#b42318}.rsv-doc .mV{background:#ffead5;color:#b54708}
    .rsv-doc .vVai{background:#dbeafe;color:#1d4ed8}.rsv-doc .vRetornou{background:#d1fadf;color:#067647}
    .rsv-doc .leg{margin-top:10px;font-size:11px;color:#475467}
  </style>`;

  class TabelaReserva {
    constructor({ id, nome = '', criadoEm, dataCriacao, horarioCriacao, dataAtualizacao = null, reservas = [] } = {}) {
      this.id = id || TabelaReserva.novoId();
      this.nome = String(nome || '').trim();
      const criado = criadoEm && !isNaN(Date.parse(criadoEm)) ? new Date(criadoEm) : new Date();
      const p = partesData(criado);
      this.criadoEm = criado.toISOString();   // usado para o selo NOVO
      this.dataCriacao = dataCriacao || p.data;
      this.horarioCriacao = horarioCriacao || p.hora;
      this.dataAtualizacao = dataAtualizacao;
      this.reservas = [];
      reservas.slice(0, MAX_LINHAS).forEach((r) => this.reservas.push(r instanceof Reserva ? r : new Reserva(r)));
    }

    static novoId() { return 'res-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

    /** Adiciona uma linha (vazia por padrão). Nunca passa de 100. */
    adicionarReserva(dados = {}) {
      if (this.reservas.length >= MAX_LINHAS) throw new Error(`Limite de ${MAX_LINHAS} linhas por tabela atingido.`);
      const r = new Reserva(dados);
      this.reservas.push(r);
      return r;
    }

    /** `alvo` pode ser a própria Reserva ou o índice da linha. */
    removerReserva(alvo) {
      const i = typeof alvo === 'number' ? alvo : this.reservas.indexOf(alvo);
      if (i < 0 || i >= this.reservas.length) throw new Error('Linha não encontrada.');
      return this.reservas.splice(i, 1)[0];
    }

    /** Edita uma linha; valida tudo antes de alterar (sem edição pela metade). */
    editarReserva(indice, campos = {}) {
      const r = this.reservas[indice];
      if (!r) throw new Error('Linha não encontrada.');
      const teste = new Reserva(r.toJSON());
      if ('numero' in campos) teste.definirNumero(campos.numero);
      if ('motivo' in campos) teste.definirMotivo(campos.motivo);
      if ('movimentacao' in campos) teste.definirMovimentacao(campos.movimentacao);
      Object.assign(r, teste.toJSON());
      return r;
    }

    /** Converte `alvos` (Reservas ou índices) em Reservas desta tabela. Sem `alvos` = todas. */
    _resolver(alvos) {
      if (alvos === undefined || alvos === null) return [...this.reservas];
      return alvos.map((a) => (typeof a === 'number' ? this.reservas[a] : a))
        .filter((r, i, arr) => r && this.reservas.includes(r) && arr.indexOf(r) === i);
    }

    /* ---- PREENCHIMENTO EM LOTE ----
       Só mexe nas linhas informadas em `alvos`; as demais ficam intactas.
       `valor` = 'E' | 'V' | null (null limpa). Valida o valor ANTES de alterar qualquer linha. */
    aplicarMotivoEmLote(valor, alvos) {
      new Reserva().definirMotivo(valor);
      const lista = this._resolver(alvos);
      lista.forEach((r) => r.definirMotivo(valor));
      return lista.length;
    }

    aplicarMovimentacaoEmLote(valor, alvos) {
      new Reserva().definirMovimentacao(valor);
      const lista = this._resolver(alvos);
      lista.forEach((r) => r.definirMovimentacao(valor));
      return lista.length;
    }

    /** Limpa motivo e/ou movimentação das linhas informadas (ou de todas). */
    limparMarcacoes(alvos, { motivo = true, movimentacao = true } = {}) {
      const lista = this._resolver(alvos);
      lista.forEach((r) => { if (motivo) r.limparMotivo(); if (movimentacao) r.limparMovimentacao(); });
      return lista.length;
    }

    /** Retorna lista de problemas [{indice, mensagem}] (indice null = problema geral). Vazia = válida. */
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

    /** Valida, descarta linhas totalmente vazias e marca a data de atualização. Lança erro se inválida. */
    salvarTabela() {
      const erros = this.validarTabela();
      if (erros.length) { const e = new Error(erros[0].mensagem); e.erros = erros; throw e; }
      this.reservas = this.reservas.filter((r) => !r.estaVazia());
      this.dataAtualizacao = new Date().toISOString();
      return this;
    }

    /** Totais exibidos nos cartões. */
    contagens() {
      return {
        reservas: this.reservas.filter((r) => r.numero !== null).length,
        indo: this.reservas.filter((r) => r.movimentacao === 'Vai').length,
        retornados: this.reservas.filter((r) => r.movimentacao === 'Retornou').length,
      };
    }

    ehRecente(agora = Date.now()) { return agora - Date.parse(this.criadoEm) < HORAS_NOVO * 3600 * 1000; }

    clonar() { return new TabelaReserva(JSON.parse(JSON.stringify(this))); }

    /** HTML da versão para impressão (usado com window.print()). */
    gerarDocumento(agora = new Date()) {
      const g = partesData(agora);
      const linhas = this.reservas.length
        ? this.reservas.map((r, i) => `<tr><td>${i + 1}</td>
            <td>${r.motivo ? `<span class="m m${r.motivo}">${r.motivo}</span>` : ''}</td>
            <td><strong>${r.numero === null ? '' : r.numero}</strong></td>
            <td>${r.movimentacao ? `<span class="v v${r.movimentacao}">${esc(r.movimentacao)}</span>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="4">Nenhuma reserva cadastrada.</td></tr>';
      return `${DOC_CSS}<div class="rsv-doc">
        <h1>Extinsul Extintores</h1>
        <h2>Reservas — ${esc(this.nome)}</h2>
        <div class="meta">
          <span><strong>Tabela criada em:</strong> ${dataBR(this.dataCriacao)} às ${esc(this.horarioCriacao)}</span>
          <span><strong>Documento gerado em:</strong> ${dataBR(g.data)} às ${g.hora}</span>
          <span><strong>Linhas:</strong> ${this.reservas.length}</span>
        </div>
        <table><thead><tr><th style="width:44px">Nº</th><th>MOTIVO</th><th>RESERVA</th><th>VAI / RETORNARAM</th></tr></thead>
        <tbody>${linhas}</tbody></table>
        <div class="leg">E = Estragado &nbsp;·&nbsp; V = Vencido</div></div>`;
    }

    toJSON() {
      return {
        id: this.id, nome: this.nome, criadoEm: this.criadoEm, dataCriacao: this.dataCriacao,
        horarioCriacao: this.horarioCriacao, dataAtualizacao: this.dataAtualizacao, reservas: this.reservas,
      };
    }
  }

  /* ---------------------------------------------------------
     3c. CLASSE GerenciadorReservas — guarda e controla as tabelas
     Toda operação (inclusive leitura) exige perfil administrador.
  --------------------------------------------------------- */
  class GerenciadorReservas {
    constructor({ getSessao, storage } = {}) {
      this._getSessao = getSessao || (() => null);
      this._storage = storage !== undefined ? storage : GerenciadorReservas._storagePadrao();
      this._tabelas = [];
      this._carregar();
    }

    static _storagePadrao() { try { return raiz.localStorage || null; } catch (e) { return null; } }

    _exigirAdmin() { exigirAdmin(this._getSessao()); }

    _carregar() {
      if (!this._storage) return;
      try {
        const dados = JSON.parse(this._storage.getItem(CHAVE_STORAGE) || 'null');
        if (!dados || !Array.isArray(dados.tabelas)) return;
        dados.tabelas.forEach((t) => { try { this._tabelas.push(new TabelaReserva(t)); } catch (e) { /* ignora registro corrompido */ } });
      } catch (e) { /* storage indisponível ou corrompido: começa vazio */ }
    }

    _persistir() {
      if (!this._storage) return;
      try { this._storage.setItem(CHAVE_STORAGE, JSON.stringify({ versao: 1, tabelas: this._tabelas })); }
      catch (e) { /* cota cheia / modo privado: os dados continuam em memória */ }
    }

    /** Cria uma tabela NOVA e vazia (ainda não guardada: só entra na lista ao salvar). */
    criarTabela(nome) {
      this._exigirAdmin();
      const n = String(nome || '').trim();
      if (!n) throw new Error('Informe o nome da tabela.');
      if (n.length > MAX_NOME) throw new Error(`O nome pode ter no máximo ${MAX_NOME} caracteres.`);
      return new TabelaReserva({ nome: n });
    }

    /** Mais recentes primeiro. */
    listarTabelas() {
      this._exigirAdmin();
      return [...this._tabelas].sort((a, b) => Date.parse(b.criadoEm) - Date.parse(a.criadoEm));
    }

    buscarTabela(id) { this._exigirAdmin(); return this._tabelas.find((t) => t.id === id); }

    /** Devolve uma CÓPIA para edição: cancelar = simplesmente descartar a cópia. */
    editarTabela(id) {
      const t = this.buscarTabela(id);
      if (!t) throw new Error('Tabela não encontrada.');
      return t.clonar();
    }

    /** Valida e guarda (nova ou existente). Guarda uma cópia, então tabelas nunca compartilham linhas. */
    salvarAlteracoes(tabela) {
      this._exigirAdmin();
      if (!(tabela instanceof TabelaReserva)) throw new Error('Tabela inválida.');
      tabela.salvarTabela();
      const copia = tabela.clonar();
      const i = this._tabelas.findIndex((t) => t.id === copia.id);
      if (i >= 0) this._tabelas[i] = copia; else this._tabelas.push(copia);
      this._persistir();
      return copia;
    }

    excluirTabela(id) {
      this._exigirAdmin();
      const i = this._tabelas.findIndex((t) => t.id === id);
      if (i < 0) throw new Error('Tabela não encontrada.');
      this._tabelas.splice(i, 1);
      this._persistir();
      return true;
    }
  }

  /* ---------------------------------------------------------
     4. INTERFACE
     Reaproveita as classes visuais já existentes do sistema
     (titulo, box, boxTitulo, btn, btn-primario, btn-perigo,
     btn-sm, mudo, aviso-vazio, form-erro, ajuda, form-grid,
     cheio). Só o que é específico das Reservas usa o prefixo
     .rsv- e é injetado aqui, sem tocar em style.css.
  --------------------------------------------------------- */
  const ESTILOS = `
  .rsv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:16px}
  .rsv-card{display:flex;flex-direction:column;gap:10px;margin-bottom:0}
  .rsv-card-topo{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  .rsv-nome{font-size:15px;word-break:break-word}
  .rsv-novo{background:#fff4d6;color:#9a6200;border:1px solid #f5aa16;border-radius:999px;font-size:10.5px;font-weight:700;letter-spacing:.4px;padding:2px 8px;white-space:nowrap}
  .rsv-data{font-size:12px}
  .rsv-cont{display:flex;gap:8px}
  .rsv-cont div{flex:1;background:#f5f7fa;border-radius:6px;padding:8px 4px;text-align:center}
  .rsv-cont strong{display:block;font-size:20px}
  .rsv-cont span{font-size:11px;color:#68778a}
  .rsv-acoes{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto}
  .rsv-aviso{font-size:12px;margin-top:8px}
  .rsv-barra{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0 8px}
  .rsv-barra .rsv-conta{margin-left:auto;font-size:12px;color:#68778a}
  .rsv-lote{border:1px solid #d5dae1;border-radius:6px;background:#f8fafc;padding:10px 12px;margin-bottom:8px}
  .rsv-escopo{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;font-size:13px;margin-bottom:8px}
  .rsv-escopo label{display:inline-flex;gap:6px;align-items:center;font-weight:normal;cursor:pointer}
  .rsv-escopo input{width:auto}
  .rsv-lote-linha{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;font-size:12px}
  .rsv-lote-linha b{min-width:92px;color:#475467}
  .rsv-tabela-wrap{overflow-x:auto;contain:inline-size;max-width:100%;border:1px solid #d5dae1;border-radius:6px;margin:8px 0;background:#fff}
  .rsv-tabela{width:100%;border-collapse:collapse;min-width:540px}
  .rsv-tabela th{background:#f0f3f7;font-size:12px;letter-spacing:.5px;text-align:left;padding:8px 10px;white-space:nowrap}
  .rsv-tabela td{padding:5px 10px;border-top:1px solid #e6e9ee}
  .rsv-tabela th:first-child,.rsv-tabela td:first-child{width:34px;text-align:center}
  .rsv-tabela .rsv-n{width:38px;color:#68778a;font-size:12px}
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
  @media (max-width:640px){.rsv-barra .rsv-conta{margin-left:0;width:100%}.rsv-rodape .btn{flex:1}}`;

  function injetarEstilos() {
    if (typeof document === 'undefined' || document.getElementById('rsv-estilos')) return;
    const s = document.createElement('style');
    s.id = 'rsv-estilos';
    s.textContent = ESTILOS;
    document.head.appendChild(s);
  }

  // Instância única: mantém os dados ao alternar entre abas durante a sessão.
  let sessaoAtual = null;
  const gerenciador = new GerenciadorReservas({ getSessao: () => sessaoAtual });

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

  /** Janelinha para pedir o nome da nova tabela. Resolve com o nome ou null. */
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

  /* ---------- Tela inicial: lista de tabelas ---------- */
  function mostrarLista(cont) {
    let tabelas;
    try { tabelas = gerenciador.listarTabelas(); }
    catch (e) { return negar(cont, e.message); }

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
        </div>
        <div class="rsv-acoes">
          <button class="btn btn-primario btn-sm" data-acao="abrir">Abrir / editar</button>
          <button class="btn btn-sm" data-acao="doc">Gerar documento</button>
          <button class="btn btn-sm btn-perigo" data-acao="excluir">Excluir</button>
        </div></div>`;
    };

    cont.innerHTML = `
      <div class="titulo">
        <div><h2>Gerenciamento de Reservas</h2><p class="sub">Crie, organize e acompanhe os conjuntos de extintores reserva utilizados pela empresa.</p></div>
        <button class="btn btn-primario" id="rsv-nova">+ Criar nova tabela</button>
      </div>
      ${tabelas.length
        ? `<div class="rsv-grid">${tabelas.map(cartao).join('')}</div>`
        : '<div class="box"><div class="aviso-vazio">Nenhuma tabela criada ainda. Clique em <strong>+ Criar nova tabela</strong> para começar.</div></div>'}
      <p class="mudo rsv-aviso">Protótipo: as tabelas ficam salvas apenas neste navegador, ainda sem banco de dados.</p>`;

    cont.querySelector('#rsv-nova').addEventListener('click', async () => {
      const nome = await pedirNome();
      if (nome === null) return;
      try { abrirEditor(cont, gerenciador.criarTabela(nome), true); }
      catch (e) { avisar(e.message, true); }
    });

    const grade = cont.querySelector('.rsv-grid');
    if (grade) grade.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-acao]');
      if (!b) return;
      const id = b.closest('[data-id]').dataset.id;
      try {
        const t = gerenciador.buscarTabela(id);
        if (!t) throw new Error('Tabela não encontrada.');
        if (b.dataset.acao === 'abrir') abrirEditor(cont, gerenciador.editarTabela(id), false);
        else if (b.dataset.acao === 'doc') imprimirTabela(t);
        else if (b.dataset.acao === 'excluir') {
          if (!(await confirmar(`Excluir a tabela "${t.nome}"? Todas as ${t.reservas.length} linhas dela serão apagadas. Isso não pode ser desfeito.`, { textoOk: 'Excluir', perigo: true }))) return;
          gerenciador.excluirTabela(id);
          avisar('Tabela excluída.');
          mostrarLista(cont);
        }
      } catch (err) { avisar(err.message, true); }
    });
  }

  function negar(cont, msg) {
    cont.innerHTML = `<div class="box"><div class="aviso-vazio">🔒 ${esc(msg || 'Acesso restrito a administradores.')}</div></div>`;
  }

  /* ---------- Editor da tabela (criar / editar) ---------- */
  function abrirEditor(cont, rasc, ehNova) {
    // `rasc` é um RASCUNHO (cópia): Cancelar apenas o descarta.
    const sel = new Set();                       // linhas marcadas pelas caixas de seleção
    const instantaneo = () => JSON.stringify({ n: nomeInput().value.trim(), r: rasc.reservas });
    let base = null;
    const nomeInput = () => cont.querySelector('#rsv-nome');
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
          <button class="btn" id="rsv-add">+ Adicionar linha</button>
          <button class="btn btn-perigo" id="rsv-rem">Remover selecionadas</button>
          <span class="rsv-conta" id="rsv-conta"></span>
        </div>

        <div class="rsv-lote">
          <div class="rsv-escopo"><strong>Aplicar em lote em:</strong>
            <label><input type="radio" name="rsv-esc" value="sel" checked> Linhas selecionadas (<span id="rsv-nsel">0</span>)</label>
            <label><input type="radio" name="rsv-esc" value="todas"> Todas as linhas</label></div>
          <div class="rsv-lote-linha"><b>Motivo:</b>
            <button class="btn btn-sm" data-lote="motivo:E">Aplicar E — Estragado</button>
            <button class="btn btn-sm" data-lote="motivo:V">Aplicar V — Vencido</button>
            <button class="btn btn-sm" data-lote="motivo:">Limpar motivo</button></div>
          <div class="rsv-lote-linha"><b>Movimentação:</b>
            <button class="btn btn-sm" data-lote="mov:Vai">Aplicar Vai</button>
            <button class="btn btn-sm" data-lote="mov:Retornou">Aplicar Retornou</button>
            <button class="btn btn-sm" data-lote="mov:">Limpar situação</button></div>
          <div class="rsv-lote-linha"><b>Tudo:</b><button class="btn btn-sm" data-lote="tudo:">Limpar marcações</button></div>
        </div>

        <div class="rsv-tabela-wrap"><table class="rsv-tabela">
          <thead><tr><th><input type="checkbox" id="rsv-todas" aria-label="Selecionar todas as linhas"></th><th>#</th><th>MOTIVO</th><th>RESERVA</th><th>VAI / RETORNARAM</th><th></th></tr></thead>
          <tbody id="rsv-corpo"></tbody></table></div>

        <div class="rsv-rodape">
          <button class="btn" id="rsv-cancelar">Cancelar</button>
          <button class="btn" id="rsv-doc">Gerar documento</button>
          <button class="btn btn-primario" id="rsv-salvar">Salvar tabela</button>
        </div>
      </div>`;

    const $ = (id) => cont.querySelector('#' + id);
    const corpo = $('rsv-corpo'), todas = $('rsv-todas');

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
      <td><button class="btn btn-sm btn-perigo" data-acao="rem" title="Remover linha" aria-label="Remover linha ${i + 1}">✕</button></td></tr>`;

    function atualizar() {
      const n = rasc.reservas.length, ns = rasc.reservas.filter((r) => sel.has(r)).length;
      $('rsv-conta').textContent = `${n} de ${MAX_LINHAS} linhas`;
      $('rsv-nsel').textContent = ns;
      $('rsv-add').disabled = n >= MAX_LINHAS;
      $('rsv-rem').disabled = ns === 0;
      todas.checked = n > 0 && ns === n;
      todas.indeterminate = ns > 0 && ns < n;
    }
    function pintar() {
      corpo.innerHTML = rasc.reservas.length
        ? rasc.reservas.map(linhaHTML).join('')
        : '<tr><td colspan="6" class="mudo" style="text-align:center;padding:14px">Tabela vazia. Clique em “+ Adicionar linha”.</td></tr>';
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

    /* ---- eventos das linhas (delegação) ---- */
    let ultimoAviso = 0;
    corpo.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.campo !== 'numero') return;
      const tr = el.closest('tr'), r = rasc.reservas[+tr.dataset.i];
      // Coluna RESERVA: só dígitos (letras, sinais, vírgulas e pontos são removidos na hora, inclusive ao colar).
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
      if (prox) prox.focus(); else adicionarLinha();   // Enter na última linha cria a próxima
    });
    corpo.addEventListener('change', (e) => {
      const el = e.target, campo = el.dataset.campo;
      if (!campo || campo === 'numero') return;
      const tr = el.closest('tr'), r = rasc.reservas[+tr.dataset.i];
      try {
        if (campo === 'motivo') { r.definirMotivo(el.value); el.className = 'rsv-campo' + (r.motivo ? ' rsv-m-' + r.motivo : ''); }
        else if (campo === 'mov') { r.definirMovimentacao(el.value); el.className = 'rsv-campo' + (r.movimentacao ? ' rsv-v-' + r.movimentacao : ''); }
        else if (campo === 'sel') { if (el.checked) sel.add(r); else sel.delete(r); tr.classList.toggle('rsv-marcada', el.checked); atualizar(); }
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

    /* ---- PREENCHIMENTO EM LOTE ----
       Só afeta as linhas do escopo escolhido (selecionadas ou todas).
       Pede confirmação quando o escopo é "todas" ou quando vai substituir valores existentes. */
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

    /* ---- salvar / cancelar / documento ---- */
    function mostrarErros(erros) {
      const caixa = $('rsv-erros');
      caixa.innerHTML = `<strong>Corrija antes de salvar:</strong><ul>${erros.map((x) => `<li>${esc(x.mensagem)}</li>`).join('')}</ul>`;
      caixa.style.display = 'block';
      corpo.querySelectorAll('tr.rsv-erro').forEach((tr) => tr.classList.remove('rsv-erro'));
      erros.forEach((x) => { if (x.indice !== null) { const tr = corpo.querySelector(`tr[data-i="${x.indice}"]`); if (tr) tr.classList.add('rsv-erro'); } });
      const primeira = corpo.querySelector('tr.rsv-erro');
      (primeira || caixa).scrollIntoView({ block: 'center' });
    }

    $('rsv-salvar').addEventListener('click', () => {
      rasc.nome = nomeInput().value.trim();
      const erros = rasc.validarTabela();
      if (erros.length) { mostrarErros(erros); avisar('Há problemas na tabela. Veja os avisos.', true); return; }
      try {
        const vazias = rasc.reservas.filter((r) => r.estaVazia()).length;
        gerenciador.salvarAlteracoes(rasc);
        avisar(`Tabela salva.${vazias ? ` ${vazias} linha(s) vazia(s) foram descartadas.` : ''}`);
        mostrarLista(cont);
      } catch (err) { avisar(err.message, true); }
    });

    $('rsv-cancelar').addEventListener('click', async () => {
      if (sujo() && !(await confirmar('Descartar as alterações não salvas desta tabela?', { textoOk: 'Descartar', perigo: true }))) return;
      mostrarLista(cont);
    });

    $('rsv-doc').addEventListener('click', () => {
      if (ehNova || sujo()) { avisar('Salve a tabela antes de gerar o documento.', true); return; }
      try { imprimirTabela(gerenciador.buscarTabela(rasc.id)); } catch (err) { avisar(err.message, true); }
    });

    pintar();
    base = instantaneo();
    nomeInput().focus();
  }

  /* ---------- Ponto de entrada da página (registrado em app.js) ---------- */
  function pagina(cont, ctx) {
    sessaoAtual = (ctx && ctx.sessao) || null;
    injetarEstilos();
    // Segunda camada: mesmo que alguém chegue aqui por hash/URL, não-administrador não vê nada.
    if (!ehAdmin(sessaoAtual)) return negar(cont, 'Acesso negado: apenas administradores podem usar as Reservas.');
    mostrarLista(cont);
  }

  const api = { Reserva, TabelaReserva, GerenciadorReservas, pagina, ehAdmin, MAX_LINHAS, MOTIVOS, MOVIMENTACOES };
  raiz.ExReservas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);