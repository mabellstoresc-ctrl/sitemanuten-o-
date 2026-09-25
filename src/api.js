// Cliente da API. Toda chamada vai para /api (Netlify Function) com o cookie de sessão.

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
    this.code = this.data.code;
    this.fields = this.data.fields;
  }
}

const listeners = { unauthorized: new Set(), mustChange: new Set() };
export function onApiEvent(name, fn) {
  listeners[name].add(fn);
  return () => listeners[name].delete(fn);
}

export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { 'x-requested-with': 'rdm', ...headers }, credentials: 'same-origin' };
  if (body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['content-type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError('Sem conexão com o servidor. Verifique sua internet.', 0);
  }
  const type = res.headers.get('content-type') || '';
  if (raw && res.ok) return res;
  let data = null;
  if (type.includes('application/json')) data = await res.json().catch(() => null);
  else if (type.includes('text/html')) {
    throw new ApiError('A API não respondeu corretamente. Verifique a configuração do servidor.', res.status);
  }
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'NAO_AUTENTICADO') listeners.unauthorized.forEach((f) => f());
    if (res.status === 403 && data?.code === 'TROCAR_SENHA') listeners.mustChange.forEach((f) => f());
    throw new ApiError(data?.error || `Erro ${res.status}`, res.status, data);
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p, body = {}) => api(p, { method: 'DELETE', body });

export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
}

/** Reduz fotos grandes (câmera do celular) antes de enviar. PDFs vão como estão. */
export async function prepareFile(file, maxSide = 1600, quality = 0.82) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  if (file.size < 400 * 1024 && file.type !== 'image/heic') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function uploadFile({ entity, entityId, category, file }) {
  const prepared = await prepareFile(file);
  return api(`/files${qs({ entity, entity_id: entityId, category })}`, {
    method: 'POST',
    body: prepared,
    headers: { 'content-type': prepared.type || 'application/octet-stream', 'x-filename': encodeURIComponent(prepared.name) },
  });
}

export async function downloadFile(path, fallbackName) {
  const res = await api(path, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = m ? decodeURIComponent(m[1]) : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
