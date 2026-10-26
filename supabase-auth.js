/* Supabase manages password verification, session persistence and refresh. */
(() => {
  let clientPromise;
  const config = window.MEMORIAL_SUPABASE || {};
  const failure = (code, message) => Object.assign(new Error(message), { code });
  const getClient = () => {
    if (!clientPromise) clientPromise = (async () => {
      if (!config.url || !config.publishableKey || !config.email) {
        throw failure('configuration', '尚未配置 Supabase，请先填写 supabase-config.js。');
      }
      let url;
      try { url = new URL(config.url); } catch { throw failure('configuration', 'Supabase 项目 URL 格式不正确。'); }
      if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
        throw failure('configuration', '请填写 HTTPS 项目根地址，不要填写控制台或 API 路径。');
      }
      const key = config.publishableKey;
      let publicKey = key.startsWith('sb_publishable_');
      if (!publicKey && key.split('.').length === 3) {
        try {
          const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          publicKey = JSON.parse(atob(payload)).role === 'anon';
        } catch { /* Reject unknown/privileged keys before making a request. */ }
      }
      if (!publicKey) throw failure('configuration', '这里只能填写 Publishable Key 或 anon key，不能使用管理密钥。');
      let sdk;
      try { sdk = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm'); }
      catch { throw failure('sdk_unavailable', '登录组件加载失败，请检查网络后重试。'); }
      return sdk.createClient(url.origin, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
      });
    })().catch(error => { clientPromise = null; throw error; });
    return clientPromise;
  };
  const allowed = user => user && user.email?.toLowerCase() === config.email?.trim().toLowerCase();
  const requireUser = async () => {
    const client = await getClient();
    // getUser contacts Supabase; a local flag/session alone never unlocks the UI.
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!allowed(data.user)) throw failure('not_allowed', '这个账号没有进入纪念页的权限。');
    return data.user;
  };
  const login = async password => {
    if (!/^\d{6}$/.test(password)) throw failure('invalid_date', '请填写完整的六位日期。');
    const client = await getClient();
    const { data, error } = await client.auth.signInWithPassword({ email: config.email.trim(), password });
    if (error) throw error;
    if (!data.session || !allowed(data.user)) {
      await client.auth.signOut({ scope: 'local' });
      throw failure('not_allowed', '这个账号没有进入纪念页的权限。');
    }
    return data.user;
  };
  const logout = async () => {
    const client = await getClient();
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
  };
  const message = error => {
    if (['configuration', 'sdk_unavailable', 'not_allowed', 'invalid_date'].includes(error?.code)) return error.message;
    if (error?.status === 429 || error?.code === 'over_request_rate_limit') return '尝试次数太多了，请稍后再试。';
    if (error?.code === 'email_not_confirmed') return '登录账号的邮箱尚未确认，请先完成确认。';
    if (error?.code === 'invalid_credentials') return '日期不正确，或登录账号尚未设置好。';
    if (error?.name === 'AuthSessionMissingError' || error?.status === 401 || error?.status === 403) return '登录已失效，请重新填写相遇日期。';
    return '暂时无法完成验证，请检查网络和 Supabase 项目状态后重试。';
  };
  window.MemorialAuth = { getClient, requireUser, login, logout, message };
})();
