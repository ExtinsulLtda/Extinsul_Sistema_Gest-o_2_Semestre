/* ==========================================================
   Módulo PEÇAS — Painel do OPERADOR
   Sub-abas completamente separadas:
     1) Peças (assistente passo a passo para tabelas globais abertas)
     2) Travas e Cordões (envio para tabelas abertas de travas/cordões)
   Operadores veem apenas seus próprios envios (somente leitura).
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

  function badgeSituacao(sit, baixa) {
    const rot = ROTULO_SIT[sit] || sit;
    return `<span class="pec-badge pec-badge-${esc(sit)}">${esc(rot)}</span>${baixa ? ' <span class="pec-badge pec-badge-fechada">Baixado</span>' : ''}`;
  }

  async function pagina(cont, { api, query }) {
    let subAba = query && query.get('sub') === 'travas' ? 'travas' : 'pecas';
    let resumo = { catalogo: [], tabelas_pecas_abertas: [], tabelas_travas_abertas: [] };
    let meus = { pecas: [], travas: [] };

    // Estado independente da sub-aba Peças (passo 1..5)
    const stPeca = {
      passo: 1,
      tabela_id: '',
      catalogo_id: null,
      peca_nome: '',
      sequencia: '',
      os: '',
      numero_peca: '',
      busca: '',
      avisoSucesso: '',
      erroPasso: '',
      enviando: false,
    };

    // Estado independente da sub-aba Travas e Cordões
    const stTrava = {
      confirmando: false,
      tabela_id: '',
      os: '',
      qtd_travas: '0',
      qtd_cordoes: '0',
      avisoSucesso: '',
      erro: '',
      enviando: false,
    };

    async function carregarTudo() {
      const [r, m] = await Promise.all([api('/pecas/resumo'), api('/pecas/meus')]);
      resumo = r;
      meus = m;

      // Seleciona automaticamente quando houver tabela aberta disponível e nenhuma válida escolhida
      if (!resumo.tabelas_pecas_abertas.some((t) => String(t.id) === String(stPeca.tabela_id))) {
        stPeca.tabela_id = resumo.tabelas_pecas_abertas[0] ? String(resumo.tabelas_pecas_abertas[0].id) : '';
      }
      if (!resumo.tabelas_travas_abertas.some((t) => String(t.id) === String(stTrava.tabela_id))) {
        stTrava.tabela_id = resumo.tabelas_travas_abertas[0] ? String(resumo.tabelas_travas_abertas[0].id) : '';
      }
    }

    function validaPassoPeca(passo) {
      if (!stPeca.tabela_id) return 'Não há tabela de peças aberta. Peça ao gerente para criar uma.';
      if (passo === 1 && !stPeca.catalogo_id) return 'Selecione o tipo da peça para continuar.';
      if (passo === 2) {
        const s = String(stPeca.sequencia || '').trim();
        if (!/^\d{1,2}$/.test(s) || Number(s) < 1 || Number(s) > 99) {
          return 'Informe uma sequência inteira válida de 01 a 99.';
        }
      }
      if (passo === 3) {
        const s = String(stPeca.os || '').trim();
        if (!/^\d{1,12}$/.test(s)) return 'Informe uma OS válida (somente números, até 12 dígitos).';
      }
      if (passo === 4) {
        const s = String(stPeca.numero_peca || '').trim();
        if (!s || !/^[A-Za-z0-9-]+$/.test(s) || s.length > 40) {
          return 'Informe o número da peça (letras, números e hífen, até 40 caracteres).';
        }
      }
      return '';
    }

    function validaTrava() {
      if (!stTrava.tabela_id) return 'Não há tabela de travas e cordões aberta. Peça ao gerente para criar uma.';
      const os = String(stTrava.os || '').trim();
      if (!/^\d{1,12}$/.test(os)) return 'Informe uma OS válida (somente números, até 12 dígitos).';
      const qt = Number(stTrava.qtd_travas === '' ? 0 : stTrava.qtd_travas);
      const qc = Number(stTrava.qtd_cordoes === '' ? 0 : stTrava.qtd_cordoes);
      if (!Number.isInteger(qt) || qt < 0 || qt > 999) return 'Quantidade de travas deve ser um inteiro de 0 a 999.';
      if (!Number.isInteger(qc) || qc < 0 || qc > 999) return 'Quantidade de cordões deve ser um inteiro de 0 a 999.';
      if (qt + qc < 1) return 'Informe pelo menos 1 trava ou 1 cordão.';
      return '';
    }

    function renderSeletorTabela(abertas, valorAtual, idSelect) {
      if (!abertas.length) return '';
      if (abertas.length === 1) {
        const t = abertas[0];
        return `<div class="mudo" style="font-size:12px;margin-bottom:10px">
          Tabela ativa: <strong>${esc(t.nome)}</strong> (${t.total_linhas}/40 linhas)
        </div>`;
      }
      return `<div class="pec-campo-destaque" style="margin-bottom:12px">
        <label for="${idSelect}" style="font-size:12px;font-weight:600;color:#46505e">Tabela aberta de destino *</label>
        <select id="${idSelect}">
          ${abertas.map((t) => `<option value="${t.id}"${String(t.id) === String(valorAtual) ? ' selected' : ''}>${esc(t.nome)} (${t.total_linhas}/40 linhas)</option>`).join('')}
        </select>
      </div>`;
    }

    function renderAbaPecas() {
      const abertas = resumo.tabelas_pecas_abertas;
      const semTabela = abertas.length === 0;
      const termo = stPeca.busca.trim().toLowerCase();
      const grupos = ['Mangueiras e válvulas', 'Peças pequenas'].map((cat) => ({
        cat,
        itens: resumo.catalogo.filter((x) => x.categoria === cat && (!termo || x.nome.toLowerCase().includes(termo))),
      }));

      const tabelaSel = abertas.find((t) => String(t.id) === String(stPeca.tabela_id));
      const seqFmt = stPeca.sequencia ? pad2(Number(stPeca.sequencia)) : '—';

      let corpoWizard = '';
      if (semTabela) {
        corpoWizard = `<div class="pec-alerta-bloqueado">
          <strong>Não há tabela de peças aberta. Peça ao gerente para criar uma.</strong>
        </div>`;
      } else if (stPeca.passo === 1) {
        corpoWizard = `
          <div class="pec-campo-destaque">
            <label for="op-peca-busca" style="font-size:12px;font-weight:600;color:#46505e">1. Escolha o tipo da peça *</label>
            <input id="op-peca-busca" type="search" placeholder="Filtrar peça pelo nome…" value="${esc(stPeca.busca)}">
          </div>
          ${grupos.map((g) => g.itens.length ? `
            <div class="pec-cat-grupo">
              <h4>${esc(g.cat)}</h4>
              <div class="pec-catalogo-grid">
                ${g.itens.map((item) => `<button type="button" class="pec-cat-btn${Number(stPeca.catalogo_id) === Number(item.id) ? ' selecionado' : ''}" data-cat-id="${item.id}" data-cat-nome="${esc(item.nome)}">${esc(item.nome)}</button>`).join('')}
              </div>
            </div>` : '').join('')}
          ${grupos.every((g) => !g.itens.length) ? '<div class="aviso-vazio">Nenhuma peça encontrada com esse filtro.</div>' : ''}
          <div class="pec-wizard-acoes">
            <button type="button" class="btn btn-primario" id="op-peca-avancar">Avançar</button>
          </div>`;
      } else if (stPeca.passo === 2) {
        corpoWizard = `
          <div class="pec-campo-destaque">
            <label for="op-peca-seq" style="font-size:12px;font-weight:600;color:#46505e">2. Sequência (01 a 99) *</label>
            <input id="op-peca-seq" type="text" inputmode="numeric" maxlength="2" placeholder="Ex.: 01" value="${esc(stPeca.sequencia)}">
            <span class="mudo" style="font-size:12px">Peça escolhida: <strong>${esc(stPeca.peca_nome)}</strong></span>
          </div>
          <div class="pec-wizard-acoes">
            <button type="button" class="btn" id="op-peca-voltar">Voltar</button>
            <button type="button" class="btn btn-primario" id="op-peca-avancar">Avançar</button>
          </div>`;
      } else if (stPeca.passo === 3) {
        corpoWizard = `
          <div class="pec-campo-destaque">
            <label for="op-peca-os" style="font-size:12px;font-weight:600;color:#46505e">3. Número da OS (somente dígitos, até 12) *</label>
            <input id="op-peca-os" type="text" inputmode="numeric" maxlength="12" placeholder="Ex.: 10452" value="${esc(stPeca.os)}">
          </div>
          <div class="pec-wizard-acoes">
            <button type="button" class="btn" id="op-peca-voltar">Voltar</button>
            <button type="button" class="btn btn-primario" id="op-peca-avancar">Avançar</button>
          </div>`;
      } else if (stPeca.passo === 4) {
        corpoWizard = `
          <div class="pec-campo-destaque">
            <label for="op-peca-num" style="font-size:12px;font-weight:600;color:#46505e">4. Número da peça (letras, números e hífen) *</label>
            <input id="op-peca-num" type="text" maxlength="40" placeholder="Ex.: PC-104" value="${esc(stPeca.numero_peca)}">
          </div>
          <div class="pec-wizard-acoes">
            <button type="button" class="btn" id="op-peca-voltar">Voltar</button>
            <button type="button" class="btn btn-verde" id="op-peca-confirmar">Confirmar</button>
          </div>`;
      } else {
        corpoWizard = `
          <div class="pec-resumo-confirma">
            <h3>As informações estão corretas?</h3>
            <div class="pec-resumo-lista">
              <div><span>Tabela global</span><strong>${esc(tabelaSel ? tabelaSel.nome : '—')}</strong></div>
              <div><span>Tipo da peça</span><strong>${esc(stPeca.peca_nome)}</strong></div>
              <div><span>Sequência</span><strong>${esc(seqFmt)}</strong></div>
              <div><span>OS</span><strong>${esc(stPeca.os.trim())}</strong></div>
              <div><span>Número da peça</span><strong>${esc(stPeca.numero_peca.trim())}</strong></div>
            </div>
            <div class="pec-wizard-acoes">
              <button type="button" class="btn" id="op-peca-voltar"${stPeca.enviando ? ' disabled' : ''}>Voltar</button>
              <button type="button" class="btn btn-verde" id="op-peca-enviar"${stPeca.enviando ? ' disabled' : ''}>${stPeca.enviando ? 'Enviando…' : 'Enviar lançamento'}</button>
            </div>
          </div>`;
      }

      const passos = [
        { n: 1, rot: 'Tipo' },
        { n: 2, rot: 'Seq.' },
        { n: 3, rot: 'OS' },
        { n: 4, rot: 'Nº Peça' },
        { n: 5, rot: 'Confirmar' },
      ];

      return `
        <div class="box pec-wizard">
          <div class="boxTitulo">Lançar Peça</div>
          ${stPeca.avisoSucesso ? `<div class="pec-sucesso-card">${esc(stPeca.avisoSucesso)}</div>` : ''}
          ${!semTabela ? `
            ${renderSeletorTabela(abertas, stPeca.tabela_id, 'op-peca-tabela')}
            <div class="pec-passos-nav">
              ${passos.map((p) => {
                const cls = stPeca.passo === p.n ? 'ativo' : (stPeca.passo > p.n ? 'feito' : '');
                return `<button type="button" class="pec-passo-pill ${cls}" data-ir-passo="${p.n}"><strong>Passo ${p.n}</strong>${p.rot}</button>`;
              }).join('')}
            </div>` : ''}
          ${stPeca.erroPasso ? `<div class="form-erro" style="margin-bottom:10px">${esc(stPeca.erroPasso)}</div>` : ''}
          ${corpoWizard}
        </div>
        <div class="box">
          <div class="boxTitulo">Meus envios recentes (somente leitura)</div>
          ${Ex.tabelaSimples(
            ['Data / Hora', 'Tabela', 'Peça', 'Seq.', 'OS', 'Nº Peça', 'Situação'],
            meus.pecas.map((l) => [
              `${esc(dataBR(l.data_envio))} ${esc(l.horario_envio)}`,
              esc(l.tabela_nome),
              esc(l.peca_nome),
              esc(pad2(l.sequencia)),
              esc(l.os),
              esc(l.numero_peca),
              badgeSituacao(l.situacao, l.baixa) + (l.motivo_analise ? `<span class="pec-motivo-chip">${esc(l.motivo_analise)}</span>` : ''),
            ]),
            'Você ainda não enviou peças.'
          )}
        </div>`;
    }

    function renderAbaTravas() {
      const abertas = resumo.tabelas_travas_abertas;
      const semTabela = abertas.length === 0;
      const tabelaSel = abertas.find((t) => String(t.id) === String(stTrava.tabela_id));

      let corpo = '';
      if (semTabela) {
        corpo = `<div class="pec-alerta-bloqueado">
          <strong>Não há tabela de travas e cordões aberta. Peça ao gerente para criar uma.</strong>
        </div>`;
      } else if (stTrava.confirmando) {
        corpo = `
          <div class="pec-resumo-confirma">
            <h3>Confira se as informações estão corretas antes de lançar</h3>
            <div class="pec-resumo-lista">
              <div><span>Tabela</span><strong>${esc(tabelaSel ? tabelaSel.nome : '—')}</strong></div>
              <div><span>OS</span><strong>${esc(stTrava.os.trim())}</strong></div>
              <div><span>Quantidade de travas</span><strong>${Number(stTrava.qtd_travas || 0)}</strong></div>
              <div><span>Quantidade de cordões</span><strong>${Number(stTrava.qtd_cordoes || 0)}</strong></div>
            </div>
            <div class="pec-wizard-acoes">
              <button type="button" class="btn" id="op-trava-voltar"${stTrava.enviando ? ' disabled' : ''}>Voltar</button>
              <button type="button" class="btn btn-verde" id="op-trava-enviar"${stTrava.enviando ? ' disabled' : ''}>${stTrava.enviando ? 'Enviando…' : 'Confirmar envio'}</button>
            </div>
          </div>`;
      } else {
        corpo = `
          ${renderSeletorTabela(abertas, stTrava.tabela_id, 'op-trava-tabela')}
          <div class="form-grid" style="max-width:520px">
            <div class="cheio">
              <label for="op-trava-os">Número da OS (somente dígitos, até 12) *</label>
              <input id="op-trava-os" type="text" inputmode="numeric" maxlength="12" placeholder="Ex.: 10452" value="${esc(stTrava.os)}">
            </div>
            <div>
              <label for="op-trava-qt">Quantidade de travas (0 a 999)</label>
              <input id="op-trava-qt" type="number" min="0" max="999" inputmode="numeric" value="${esc(stTrava.qtd_travas)}">
            </div>
            <div>
              <label for="op-trava-qc">Quantidade de cordões (0 a 999)</label>
              <input id="op-trava-qc" type="number" min="0" max="999" inputmode="numeric" value="${esc(stTrava.qtd_cordoes)}">
            </div>
            <div class="cheio">
              <div class="ajuda">Não é permitido lançar 0 travas e 0 cordões ao mesmo tempo.</div>
              <div class="pec-wizard-acoes">
                <button type="button" class="btn btn-primario" id="op-trava-confirmar">Confirmar</button>
              </div>
            </div>
          </div>`;
      }

      return `
        <div class="box pec-wizard">
          <div class="boxTitulo">Lançar Travas e Cordões</div>
          ${stTrava.avisoSucesso ? `<div class="pec-sucesso-card">${esc(stTrava.avisoSucesso)}</div>` : ''}
          ${stTrava.erro ? `<div class="form-erro" style="margin-bottom:10px">${esc(stTrava.erro)}</div>` : ''}
          ${corpo}
        </div>
        <div class="box">
          <div class="boxTitulo">Meus envios de travas e cordões (somente leitura)</div>
          ${Ex.tabelaSimples(
            ['Data / Hora', 'Tabela', 'OS', 'Travas', 'Cordões', 'Situação'],
            meus.travas.map((l) => [
              `${esc(dataBR(l.data_envio))} ${esc(l.horario_envio)}`,
              esc(l.tabela_nome),
              esc(l.os),
              String(l.qtd_travas),
              String(l.qtd_cordoes),
              badgeSituacao(l.situacao, l.baixa) + (l.motivo_analise ? `<span class="pec-motivo-chip">${esc(l.motivo_analise)}</span>` : ''),
            ]),
            'Você ainda não enviou travas ou cordões.'
          )}
        </div>`;
    }

    function pintar() {
      cont.innerHTML = `
        <div class="titulo">
          <div>
            <h2>Módulo Peças</h2>
            <p class="sub">Registre peças substituídas, travas e cordões para conferência do gerente.</p>
          </div>
        </div>
        <div class="pec-subabas">
          <button type="button" class="pec-subaba${subAba === 'pecas' ? ' ativo' : ''}" data-sub="pecas">Peças</button>
          <button type="button" class="pec-subaba${subAba === 'travas' ? ' ativo' : ''}" data-sub="travas">Travas e Cordões</button>
        </div>
        ${subAba === 'pecas' ? renderAbaPecas() : renderAbaTravas()}`;

      ligarEventos();
    }

    function capturarCamposAtuais() {
      const tPeca = cont.querySelector('#op-peca-tabela');
      if (tPeca) stPeca.tabela_id = tPeca.value;
      const b = cont.querySelector('#op-peca-busca');
      if (b) stPeca.busca = b.value;
      const seq = cont.querySelector('#op-peca-seq');
      if (seq) stPeca.sequencia = seq.value;
      const os = cont.querySelector('#op-peca-os');
      if (os) stPeca.os = os.value;
      const np = cont.querySelector('#op-peca-num');
      if (np) stPeca.numero_peca = np.value;

      const tTrava = cont.querySelector('#op-trava-tabela');
      if (tTrava) stTrava.tabela_id = tTrava.value;
      const tOs = cont.querySelector('#op-trava-os');
      if (tOs) stTrava.os = tOs.value;
      const tQt = cont.querySelector('#op-trava-qt');
      if (tQt) stTrava.qtd_travas = tQt.value;
      const tQc = cont.querySelector('#op-trava-qc');
      if (tQc) stTrava.qtd_cordoes = tQc.value;
    }

    function ligarEventos() {
      cont.querySelectorAll('.pec-subaba').forEach((btn) => {
        btn.onclick = () => {
          capturarCamposAtuais();
          subAba = btn.dataset.sub;
          pintar();
        };
      });

      if (subAba === 'pecas') {
        const busca = cont.querySelector('#op-peca-busca');
        if (busca) {
          busca.oninput = () => {
            const pos = busca.selectionStart;
            stPeca.busca = busca.value;
            pintar();
            const novo = cont.querySelector('#op-peca-busca');
            if (novo) { novo.focus(); if (pos != null) novo.setSelectionRange(pos, pos); }
          };
        }
        const tSel = cont.querySelector('#op-peca-tabela');
        if (tSel) tSel.onchange = () => { stPeca.tabela_id = tSel.value; };

        cont.querySelectorAll('[data-cat-id]').forEach((btn) => {
          btn.onclick = () => {
            stPeca.catalogo_id = Number(btn.dataset.catId);
            stPeca.peca_nome = btn.dataset.catNome;
            stPeca.erroPasso = '';
            stPeca.avisoSucesso = '';
            stPeca.passo = 2;
            pintar();
            const inp = cont.querySelector('#op-peca-seq');
            if (inp) inp.focus();
          };
        });

        cont.querySelectorAll('[data-ir-passo]').forEach((pill) => {
          pill.onclick = () => {
            capturarCamposAtuais();
            const alvo = Number(pill.dataset.irPasso);
            if (alvo <= stPeca.passo) {
              stPeca.erroPasso = '';
              stPeca.passo = alvo;
              pintar();
              return;
            }
            for (let p = 1; p < alvo; p++) {
              const err = validaPassoPeca(p);
              if (err) {
                stPeca.erroPasso = err;
                stPeca.passo = p;
                pintar();
                return;
              }
            }
            stPeca.erroPasso = '';
            stPeca.passo = alvo;
            pintar();
          };
        });

        const avancar = cont.querySelector('#op-peca-avancar');
        if (avancar) {
          avancar.onclick = () => {
            capturarCamposAtuais();
            const err = validaPassoPeca(stPeca.passo);
            if (err) { stPeca.erroPasso = err; pintar(); return; }
            stPeca.erroPasso = '';
            stPeca.avisoSucesso = '';
            stPeca.passo += 1;
            pintar();
          };
        }

        const confirmar = cont.querySelector('#op-peca-confirmar');
        if (confirmar) {
          confirmar.onclick = () => {
            capturarCamposAtuais();
            const err = validaPassoPeca(4);
            if (err) { stPeca.erroPasso = err; pintar(); return; }
            stPeca.erroPasso = '';
            stPeca.passo = 5;
            pintar();
          };
        }

        const voltar = cont.querySelector('#op-peca-voltar');
        if (voltar) {
          voltar.onclick = () => {
            capturarCamposAtuais();
            stPeca.erroPasso = '';
            stPeca.passo = Math.max(1, stPeca.passo - 1);
            pintar();
          };
        }

        const enviar = cont.querySelector('#op-peca-enviar');
        if (enviar) {
          enviar.onclick = async () => {
            if (stPeca.enviando) return;
            stPeca.enviando = true;
            stPeca.erroPasso = '';
            pintar();
            try {
              const resp = await api('/pecas', {
                method: 'POST',
                body: {
                  tabela_id: Number(stPeca.tabela_id),
                  catalogo_id: Number(stPeca.catalogo_id),
                  sequencia: Number(stPeca.sequencia),
                  os: String(stPeca.os).trim(),
                  numero_peca: String(stPeca.numero_peca).trim(),
                },
              });
              const msg = resp.tabela_fechada
                ? 'Peça enviada para a tabela de peças. A tabela atingiu 40 linhas e foi fechada automaticamente.'
                : 'Peça enviada para a tabela de peças.';
              stPeca.passo = 1;
              stPeca.catalogo_id = null;
              stPeca.peca_nome = '';
              stPeca.sequencia = '';
              stPeca.os = '';
              stPeca.numero_peca = '';
              stPeca.busca = '';
              stPeca.avisoSucesso = msg;
              Ex.toast('Peça enviada para a tabela de peças.');
              await carregarTudo();
            } catch (e) {
              stPeca.erroPasso = e.message || 'Erro ao enviar peça.';
              Ex.toast(stPeca.erroPasso, true);
              await carregarTudo().catch(() => {});
            } finally {
              stPeca.enviando = false;
              pintar();
            }
          };
        }
      } else {
        const tSel = cont.querySelector('#op-trava-tabela');
        if (tSel) tSel.onchange = () => { stTrava.tabela_id = tSel.value; };

        const btnConf = cont.querySelector('#op-trava-confirmar');
        if (btnConf) {
          btnConf.onclick = () => {
            capturarCamposAtuais();
            const err = validaTrava();
            if (err) { stTrava.erro = err; pintar(); return; }
            stTrava.erro = '';
            stTrava.avisoSucesso = '';
            stTrava.confirmando = true;
            pintar();
          };
        }

        const btnVolt = cont.querySelector('#op-trava-voltar');
        if (btnVolt) {
          btnVolt.onclick = () => {
            stTrava.erro = '';
            stTrava.confirmando = false;
            pintar();
          };
        }

        const btnEnv = cont.querySelector('#op-trava-enviar');
        if (btnEnv) {
          btnEnv.onclick = async () => {
            if (stTrava.enviando) return;
            stTrava.enviando = true;
            stTrava.erro = '';
            pintar();
            try {
              const resp = await api('/pecas/travas', {
                method: 'POST',
                body: {
                  tabela_id: Number(stTrava.tabela_id),
                  os: String(stTrava.os).trim(),
                  qtd_travas: Number(stTrava.qtd_travas === '' ? 0 : stTrava.qtd_travas),
                  qtd_cordoes: Number(stTrava.qtd_cordoes === '' ? 0 : stTrava.qtd_cordoes),
                },
              });
              stTrava.confirmando = false;
              stTrava.os = '';
              stTrava.qtd_travas = '0';
              stTrava.qtd_cordoes = '0';
              stTrava.avisoSucesso = resp.tabela_fechada
                ? 'Travas e cordões enviados. A tabela atingiu 40 linhas e foi fechada automaticamente.'
                : 'Travas e cordões enviados com sucesso.';
              Ex.toast('Travas e cordões enviados.');
              await carregarTudo();
            } catch (e) {
              stTrava.erro = e.message || 'Erro ao enviar travas e cordões.';
              Ex.toast(stTrava.erro, true);
              await carregarTudo().catch(() => {});
            } finally {
              stTrava.enviando = false;
              pintar();
            }
          };
        }
      }
    }

    await carregarTudo();
    pintar();
  }

  raiz.ExOperadorPecas = { pagina };
})(window);
