(() => {
  const MESSAGE = 'Servidor local indisponível. Verifique se o computador servidor está ligado e conectado à mesma rede.';
  let timer = null;

  function setServerStatus(available) {
    const el = document.querySelector('#serverStatus');
    if (!el) return;
    el.className = `server-status ${available ? 'available' : 'unavailable'}`;
    const label = el.querySelector('span');
    if (label) label.textContent = available ? 'Servidor local disponível' : 'Servidor local indisponível';
  }

  async function checkServerStatus() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
      setServerStatus(response.ok);
      return response.ok;
    } catch {
      setServerStatus(false);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function request(input, init) {
    try {
      const response = await fetch(input, init);
      setServerStatus(true);
      return response;
    } catch (cause) {
      setServerStatus(false);
      const error = new Error(MESSAGE);
      error.cause = cause;
      throw error;
    }
  }

  function startHealthMonitor() {
    checkServerStatus();
    if (timer) clearInterval(timer);
    timer = setInterval(checkServerStatus, 15000);
  }

  window.localRuntime = { message: MESSAGE, setServerStatus, checkServerStatus, request };
  window.addEventListener('load', startHealthMonitor, { once: true });
})();
