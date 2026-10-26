/* Private R2 photo access through the authenticated Supabase Edge Function. */
(() => {
  const config = window.MEMORIAL_SUPABASE;
  const urls = new Map();
  const renewal = new Map();
  const pendingKey = 'love-memorial.cloud-photo-pending.v1';
  const validURL = value => {
    const url = new URL(value);
    if (url.origin !== new URL(config.r2Endpoint).origin || url.protocol !== 'https:') throw new Error('照片接口返回了未知的存储地址。');
    return url.href;
  };
  const remember = photo => {
    urls.set(photo.id, { url: validURL(photo.url), expiresAt: photo.expiresAt });
    return { ...photo, createdAt: Date.parse(photo.createdAt), cloud: true };
  };
  const pending = () => {
    try { const value = JSON.parse(sessionStorage.getItem(pendingKey) || '[]'); return Array.isArray(value) ? value.filter(id => /^[0-9a-f-]{36}$/i.test(id)) : []; }
    catch { return []; }
  };
  const track = (id, keep) => {
    const ids = new Set(pending());
    if (keep) ids.add(id); else ids.delete(id);
    try { sessionStorage.setItem(pendingKey, JSON.stringify([...ids])); } catch { /* Refresh still recovers already-ready photos. */ }
  };
  const call = async (action, payload = {}, retry = true) => {
    const client = await window.MemorialAuth.getClient();
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.access_token) throw new Error('请先登录后再操作云端照片。');
    let response;
    try {
      response = await fetch(`${config.url.replace(/\/$/, '')}/functions/v1/memorial-photos`, {
        method: 'POST', headers: {
          'Content-Type': 'application/json', apikey: config.publishableKey,
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ ...payload, action }), signal: AbortSignal.timeout(60000),
      });
    } catch { throw new Error('云端连接失败或超时，请检查网络、云函数部署和跨域配置。'); }
    if (response.status === 401 && retry) {
      const refreshed = await client.auth.refreshSession();
      if (!refreshed.error && refreshed.data.session) return call(action, payload, false);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      let message = body.message;
      if (response.status === 404 && !body.error) message = '云函数尚未部署，请先部署 memorial-photos。';
      if (response.status === 401) message = '登录凭证被拒绝，请重新登录；若仍失败，请检查云函数 JWT 验证设置。';
      throw Object.assign(new Error(message || `云端请求失败（${response.status}）。`), { status: response.status, code: body.error });
    }
    return body;
  };
  const complete = async id => {
    const result = await call('complete', { id });
    const record = remember(result.photo);
    track(id, false);
    return record;
  };
  const list = async (offset = 0) => {
    let recoveryFailures = 0;
    if (offset === 0) {
      for (const id of pending()) {
        try { await complete(id); }
        catch (error) {
          if (error.status === 404 || error.status === 410) track(id, false);
          recoveryFailures += 1;
        }
      }
    }
    const result = await call('list', { offset });
    return { records: result.photos.map(remember), nextOffset: result.nextOffset, recoveryFailures };
  };
  const add = async record => {
    const prepared = await call('prepare', {
      name: record.name, mimeType: record.mimeType, size: record.size, width: record.width, height: record.height,
    });
    const uploadUrl = validURL(prepared.uploadUrl);
    let uploaded;
    try {
      uploaded = await fetch(uploadUrl, {
        method: 'PUT', headers: { 'Content-Type': record.mimeType }, body: record.blob,
        signal: AbortSignal.timeout(180000), credentials: 'omit',
      });
    } catch { throw new Error('照片上传失败或超时，请检查 R2 CORS 和网络；没有保存为云端照片。'); }
    if (!uploaded.ok) throw new Error(`R2 上传失败（${uploaded.status}），请检查密钥权限或重试。`);
    track(prepared.id, true);
    try { return await complete(prepared.id); }
    catch { throw new Error('文件已传到 R2，但相册确认未完成。请点击「刷新相册」重试确认，不要立即重复上传。'); }
  };
  const imageURL = async (id, force = false) => {
    const cached = urls.get(id);
    if (!force && cached && cached.expiresAt > Date.now() + 15000) return cached.url;
    if (!renewal.has(id)) renewal.set(id, call('read', { id }).then(result => {
      remember(result.photo);
      return urls.get(id).url;
    }).finally(() => renewal.delete(id)));
    return renewal.get(id);
  };
  const attachImage = (image, id, onError = () => {}) => {
    image.crossOrigin = 'anonymous'; // Required for the existing canvas/PNG export.
    let retried = false;
    image.onerror = async () => {
      if (retried) { onError('照片加载失败，请检查 R2 CORS 或刷新相册重试。'); return; }
      retried = true;
      try { image.src = await imageURL(id, true); } catch (error) { onError(error.message); }
    };
    imageURL(id).then(url => { image.src = url; }).catch(error => onError(error.message));
  };
  const read = async id => remember((await call('read', { id })).photo);
  const saveStickers = async (id, stickers, revision) => remember((await call('save-stickers', { id, stickers, revision })).photo);
  const remove = async id => {
    await call('delete', { id });
    urls.delete(id);
    track(id, false);
  };
  window.MemorialCloudPhotos = { list, add, attachImage, read, saveStickers, remove };
})();
