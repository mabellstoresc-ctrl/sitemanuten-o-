import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http.js';
import { UPLOAD_MAX_BYTES, UPLOAD_MIME } from '../shared/constants.js';

// Armazenamento de arquivos:
// - Produção: Supabase Storage (bucket privado), acessado somente pelo servidor com a chave secreta.
// - Desenvolvimento local: pasta definida em STORAGE_LOCAL_DIR.

const BUCKET = 'arquivos';

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url, key } : null;
}

function headers(key, extra = {}) {
  const h = { apikey: key, ...extra };
  // Chaves antigas (JWT "service_role") vão também no Authorization
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

function unavailable() {
  return new HttpError(503, 'Armazenamento de arquivos não configurado (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
}

export async function ensureBucket() {
  const cfg = supabaseConfig();
  if (!cfg) return;
  const res = await fetch(`${cfg.url}/storage/v1/bucket/${BUCKET}`, { headers: headers(cfg.key) });
  if (res.ok) return;
  const create = await fetch(`${cfg.url}/storage/v1/bucket`, {
    method: 'POST',
    headers: headers(cfg.key, { 'content-type': 'application/json' }),
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: UPLOAD_MAX_BYTES,
      allowed_mime_types: UPLOAD_MIME,
    }),
  });
  if (!create.ok && create.status !== 409) {
    const text = await create.text();
    if (!/already exists/i.test(text)) throw new Error(`Falha ao criar bucket: ${create.status} ${text}`);
  }
}

export async function putObject(key, buffer, mime) {
  const cfg = supabaseConfig();
  if (cfg) {
    const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${key}`, {
      method: 'POST',
      headers: headers(cfg.key, { 'content-type': mime, 'x-upsert': 'false' }),
      body: buffer,
    });
    if (!res.ok) throw new HttpError(502, `Falha ao salvar arquivo (${res.status}).`);
    return;
  }
  const dir = process.env.STORAGE_LOCAL_DIR;
  if (!dir) throw unavailable();
  const full = path.join(dir, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buffer);
}

export async function getObject(key) {
  const cfg = supabaseConfig();
  if (cfg) {
    const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${key}`, { headers: headers(cfg.key) });
    if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, 'Arquivo indisponível.');
    return Buffer.from(await res.arrayBuffer());
  }
  const dir = process.env.STORAGE_LOCAL_DIR;
  if (!dir) throw unavailable();
  try {
    return await readFile(path.join(dir, key));
  } catch {
    throw new HttpError(404, 'Arquivo indisponível.');
  }
}

/** Identifica o tipo real do arquivo pelos primeiros bytes (não confia na extensão). */
export function sniffMime(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
