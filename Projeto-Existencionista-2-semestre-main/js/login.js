/* Tela de login em duas etapas:
   Etapa 1: validação do PIN (mantendo compatibilidade com preenchimento automático)
   Etapa 2: confirmação do primeiro nome ou nome completo vinculado ao PIN
   Proteção contra tentativas repetidas sincronizada com o servidor. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const form = $('login-form');
  const subtitle = $('login-subtitle');
  const step1Panel = $('step-1-fields');
  const step2Panel = $('step-2-fields');
  const fieldPass = $('field-pass');
  const passField = $('senha');
  const errPass = $('error-pass');
  const fieldNome = $('field-nome');
  const nomeField = $('nome-confirmacao');
  const errNome = $('error-nome');
  const rememberBox = $('lembrar');
  const forgotBtn = $('forgot-link');
  const backBtn = $('btn-voltar-pin');
  const submitBtn = $('submit-btn');
  const statusMsg = $('status-msg');
  const statusText = $('status-text');
  const lockoutBanner = $('lockout-banner');
  const lockoutTimerEl = $('lockout-timer');
  const stepDot1 = $('step-dot-1');
  const stepDot2 = $('step-dot-2');
  const stepLine = $('step-line');
  const toggleBtn = $('toggle-pass');
  const eyeOpen = $('eye-open');
  const eyeClosed = $('eye-closed');

  const MSG_ESQUECEU = 'Se você esqueceu sua senha, avise o gerente responsável da empresa para solicitar a recuperação ou redefinição do acesso.';

  let etapaAtual = 1;
  let desafioToken = null; // mantido apenas em memória durante a Etapa 2
  let bloqueioDeadline = 0;
  let timerId = null;

  // Se já existe sessão completa válida no servidor, vai direto para o painel
  const atual = Ex.sessao();
  if (atual && atual.token && atual.perfil) {
    Ex.api('/eu')
      .then((d) => {
        if (d && d.usuario && d.usuario.perfil) Ex.irPainel(d.usuario.perfil);
      })
      .catch(() => { Ex.limparSessao(); });
  }

  if (new URLSearchParams(location.search).has('expirou')) {
    definirStatus('Sua sessão expirou. Informe seu PIN novamente.', 'info');
  }

  function definirStatus(texto, tipo = '') {
    statusMsg.className = 'login-status' + (tipo ? ' ' + tipo : '');
    statusText.textContent = texto || '';
  }

  function limparErroCampo(fieldEl, errEl) {
    errEl.textContent = '';
    errEl.classList.remove('show');
    fieldEl.classList.remove('shake');
  }

  function marcarErroCampo(fieldEl, errEl, msg) {
    errEl.textContent = msg;
    errEl.classList.add('show');
    fieldEl.classList.remove('shake');
    void fieldEl.offsetWidth;
    fieldEl.classList.add('shake');
  }

  function atualizarIndicador({ erroEtapa = 0, finalizado = false } = {}) {
    stepDot1.classList.remove('is-current', 'is-done', 'is-error');
    stepDot2.classList.remove('is-current', 'is-done', 'is-error');
    stepLine.classList.remove('is-done');

    if (finalizado) {
      stepDot1.classList.add('is-done');
      stepDot2.classList.add('is-done');
      stepLine.classList.add('is-done');
      return;
    }

    if (etapaAtual === 1) {
      stepDot1.classList.add(erroEtapa === 1 ? 'is-error' : 'is-current');
    } else {
      stepDot1.classList.add('is-done');
      stepLine.classList.add('is-done');
      stepDot2.classList.add(erroEtapa === 2 ? 'is-error' : 'is-current');
    }
  }

  function irEtapa(n, { focar = true } = {}) {
    etapaAtual = n;
    limparErroCampo(fieldPass, errPass);
    limparErroCampo(fieldNome, errNome);

    if (n === 1) {
      desafioToken = null;
      step1Panel.hidden = false;
      step2Panel.hidden = true;
      subtitle.textContent = 'Acesso restrito · Informe seu PIN';
      submitBtn.textContent = 'Continuar';
      nomeField.value = '';
      atualizarIndicador();
      if (focar && !estaBloqueado()) passField.focus();
    } else {
      step1Panel.hidden = true;
      step2Panel.hidden = false;
      subtitle.textContent = 'Confirmação de identidade · Informe seu nome';
      submitBtn.textContent = 'Confirmar e entrar';
      atualizarIndicador();
      if (focar && !estaBloqueado()) nomeField.focus();
    }
  }

  function estaBloqueado() {
    return bloqueioDeadline > Date.now();
  }

  function formatarSegundos(seg) {
    const s = Math.max(0, Math.ceil(seg));
    const min = String(Math.floor(s / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${min}:${sec}`;
  }

  function aplicarEstadoBloqueio(ativo) {
    lockoutBanner.hidden = !ativo;
    submitBtn.disabled = ativo;
    passField.disabled = ativo;
    nomeField.disabled = ativo;
    if (backBtn) backBtn.disabled = ativo;
    if (ativo) {
      atualizarIndicador({ erroEtapa: etapaAtual });
    } else {
      atualizarIndicador();
    }
  }

  function pararContagem() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    bloqueioDeadline = 0;
  }

  function iniciarContagem(restanteSeg) {
    const seg = Math.max(1, Number(restanteSeg) || 0);
    pararContagem();
    bloqueioDeadline = Date.now() + seg * 1000;
    aplicarEstadoBloqueio(true);

    const atualizarTick = () => {
      const faltaMs = bloqueioDeadline - Date.now();
      if (faltaMs <= 0) {
        pararContagem();
        lockoutTimerEl.textContent = '00:00';
        // Confirma no servidor que o bloqueio realmente expirou antes de liberar
        sincronizarBloqueio().then((bloq) => {
          if (!bloq) {
            aplicarEstadoBloqueio(false);
            definirStatus('Tempo de espera encerrado. Você já pode tentar novamente.', 'info');
            if (etapaAtual === 1) passField.focus();
            else nomeField.focus();
          }
        });
        return;
      }
      lockoutTimerEl.textContent = formatarSegundos(faltaMs / 1000);
    };

    atualizarTick();
    timerId = setInterval(atualizarTick, 1000);
  }

  async function sincronizarBloqueio() {
    try {
      const s = await Ex.api('/login/status');
      if (s && s.bloqueado && s.restante_seg > 0) {
        iniciarContagem(s.restante_seg);
        return true;
      }
      pararContagem();
      aplicarEstadoBloqueio(false);
      return false;
    } catch {
      return false;
    }
  }

  toggleBtn.addEventListener('click', () => {
    const showing = passField.type === 'text';
    passField.type = showing ? 'password' : 'text';
    eyeOpen.style.display = showing ? '' : 'none';
    eyeClosed.style.display = showing ? 'none' : '';
    toggleBtn.setAttribute('aria-label', showing ? 'Mostrar PIN' : 'Ocultar PIN');
  });

  passField.addEventListener('input', () => {
    limparErroCampo(fieldPass, errPass);
    if (!estaBloqueado()) atualizarIndicador();
  });

  nomeField.addEventListener('input', () => {
    limparErroCampo(fieldNome, errNome);
    if (!estaBloqueado()) atualizarIndicador();
  });

  forgotBtn.addEventListener('click', () => {
    definirStatus(MSG_ESQUECEU, 'info');
  });

  backBtn.addEventListener('click', () => {
    if (estaBloqueado()) return;
    passField.value = '';
    definirStatus('');
    irEtapa(1);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (estaBloqueado()) return;
    definirStatus('');

    if (etapaAtual === 1) {
      const pin = passField.value.trim();
      if (!pin) {
        marcarErroCampo(fieldPass, errPass, 'Informe seu PIN.');
        atualizarIndicador({ erroEtapa: 1 });
        return;
      }

      submitBtn.classList.add('loading');
      try {
        const d = await Ex.api('/login', { method: 'POST', body: { pin } });
        if (!d || !d.desafio_token) {
          throw new Error('Resposta inválida do servidor.');
        }
        desafioToken = d.desafio_token;
        irEtapa(2);
      } catch (err) {
        if (err.status === 429 && err.dados && err.dados.restante_seg) {
          limparErroCampo(fieldPass, errPass);
          iniciarContagem(err.dados.restante_seg);
        } else {
          marcarErroCampo(fieldPass, errPass, err.message);
          atualizarIndicador({ erroEtapa: 1 });
        }
      } finally {
        submitBtn.classList.remove('loading');
      }
      return;
    }

    // Etapa 2: confirmação do nome
    const nome = nomeField.value.trim();
    if (!nome) {
      marcarErroCampo(fieldNome, errNome, 'Informe seu primeiro nome ou nome completo.');
      atualizarIndicador({ erroEtapa: 2 });
      return;
    }

    submitBtn.classList.add('loading');
    try {
      const d = await Ex.api('/login/confirmar-nome', {
        method: 'POST',
        body: { desafio_token: desafioToken, nome },
      });
      passField.value = '';
      nomeField.value = '';
      desafioToken = null;
      Ex.salvarSessao(
        { token: d.token, id: d.usuario.id, nome: d.usuario.nome, perfil: d.usuario.perfil },
        rememberBox.checked,
      );
      atualizarIndicador({ finalizado: true });
      definirStatus(`Autenticação concluída. Bem-vindo, ${d.usuario.nome.split(' ')[0]}!`, 'ok');
      submitBtn.disabled = true;
      setTimeout(() => Ex.irPainel(d.usuario.perfil), 350);
    } catch (err) {
      submitBtn.classList.remove('loading');
      if (err.status === 429 && err.dados && err.dados.restante_seg) {
        passField.value = '';
        irEtapa(1, { focar: false });
        iniciarContagem(err.dados.restante_seg);
      } else if (err.dados && err.dados.desafio_expirado) {
        passField.value = '';
        irEtapa(1);
        marcarErroCampo(fieldPass, errPass, err.message);
        atualizarIndicador({ erroEtapa: 1 });
      } else {
        marcarErroCampo(fieldNome, errNome, err.message);
        atualizarIndicador({ erroEtapa: 2 });
        nomeField.focus();
      }
    }
  });

  // Inicializa sincronizando eventual bloqueio persistido no servidor
  sincronizarBloqueio();
})();
