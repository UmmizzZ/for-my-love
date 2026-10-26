/* Authenticated UI gate. Private cloud data still needs server-side RLS/access rules. */
(() => {
  const isProtected = document.currentScript.hasAttribute('data-protect');
  const auth = window.MemorialAuth;
  // The former date stored in sessionStorage is never accepted as authentication.
  try { sessionStorage.removeItem('love-memorial.access.v1'); } catch { /* optional cleanup */ }
  if (isProtected) {
    const panel = document.createElement('section');
    panel.className = 'auth-check-panel';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const back = document.createElement('a');
    back.href = 'index.html';
    back.textContent = '返回相遇日期入口';
    panel.append(status, back);
    document.body.prepend(panel);
    let checking = false;
    let generation = 0;
    const lock = () => { document.documentElement.removeAttribute('data-auth-ready'); panel.hidden = false; };
    const check = async () => {
      if (checking) return;
      checking = true;
      const current = ++generation;
      lock();
      status.textContent = '正在确认我们的通行凭证…';
      try {
        await auth.requireUser();
        if (current !== generation) return;
        document.documentElement.setAttribute('data-auth-ready', 'true');
        panel.hidden = true;
      } catch (error) {
        status.textContent = auth.message(error);
        if (error.name === 'AuthSessionMissingError' || error.status === 401 || error.status === 403 || error.code === 'refresh_token_not_found') {
          location.replace(new URL('index.html', location.href).href);
        }
      } finally { checking = false; }
    };
    auth.getClient().then(client => {
      client.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT') {
          generation += 1;
          lock();
          location.replace(new URL('index.html', location.href).href);
        }
      });
    }).catch(() => { /* check() displays configuration/network errors. */ });
    const logout = document.querySelector('[data-logout]');
    logout?.addEventListener('click', async () => {
      logout.disabled = true;
      generation += 1;
      lock();
      status.textContent = '正在退出登录…';
      try {
        await auth.logout();
        location.replace(new URL('index.html', location.href).href);
      } catch (error) {
        status.textContent = `退出未完成：${auth.message(error)}`;
      } finally { logout.disabled = false; }
    });
    check();
    window.addEventListener('pageshow', event => { if (event.persisted) check(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    window.addEventListener('pagehide', () => {
      generation += 1;
      lock();
    });
    return;
  }
  const form = document.querySelector('form');
  const submit = form.querySelector('button[type="submit"]');
  let busy = false;
  const inputs = [...form.querySelectorAll('input')];
  const status = document.querySelector('[role="status"]');
  auth.getClient().catch(error => {
    if (!busy) status.textContent = auth.message(error);
  });
  const normalize = value => value.replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 65248)).replace(/\D/g, '');
  const clearError = () => {
    status.textContent = '';
    inputs.forEach(input => input.removeAttribute('aria-invalid'));
  };
  inputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      input.value = normalize(input.value).slice(-1);
      clearError();
      if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
    });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', event => {
      if (event.key === 'Backspace' && !input.value && index > 0) inputs[index - 1].focus();
      if (event.key === 'ArrowLeft' && index > 0) inputs[index - 1].focus();
      if (event.key === 'ArrowRight' && index < inputs.length - 1) inputs[index + 1].focus();
    });
    input.addEventListener('paste', event => {
      event.preventDefault();
      const digits = normalize(event.clipboardData.getData('text')).slice(0, 6);
      if (!digits) return;
      clearError();
      const start = digits.length === 6 ? 0 : index;
      [...digits].forEach((digit, offset) => {
        if (inputs[start + offset]) inputs[start + offset].value = digit;
      });
      inputs[Math.min(start + digits.length, 5)].focus();
    });
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const value = inputs.map(input => input.value).join('');
    if (value.length !== 6) {
      status.textContent = '把那一天完整地填下来吧。';
      inputs.find(input => !input.value)?.focus();
      return;
    }
    busy = true;
    submit.disabled = true;
    inputs.forEach(input => { input.disabled = true; });
    submit.textContent = '正在验证…';
    status.textContent = '';
    try {
      await auth.login(value);
      inputs.forEach(input => { input.value = ''; });
      location.assign(new URL('preview.html', location.href).href);
    } catch (error) {
      status.textContent = auth.message(error);
      if (error.code === 'invalid_credentials') inputs.forEach(input => input.setAttribute('aria-invalid', 'true'));
    } finally {
      busy = false;
      submit.disabled = false;
      inputs.forEach(input => { input.disabled = false; });
      submit.textContent = '走进我们的故事';
    }
  });
})();
