// Servidor local da API (desenvolvimento/testes). Na Netlify quem roda é netlify/functions/api.mjs.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { handle } from '../server/app.js';

// Carrega .env simples, se existir
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
process.env.STORAGE_LOCAL_DIR ??= '.data/uploads';

const port = Number(process.env.API_PORT || 8888);

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    });
    const response = await handle(request);
    const headers = {};
    response.headers.forEach((v, k) => {
      if (k === 'set-cookie') return;
      headers[k] = v;
    });
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  })
  .listen(port, () => console.log(`API local em http://localhost:${port}/api`));
