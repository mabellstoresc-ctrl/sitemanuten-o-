// Ponto de entrada da API na Netlify. Toda a lógica fica em /server.
import { handle } from '../../server/app.js';

export default async (req) => handle(req);

export const config = {
  path: '/api/*',
};
