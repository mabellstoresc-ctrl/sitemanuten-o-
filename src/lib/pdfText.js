// Extrai o texto de um PDF no navegador (pdf.js carregado só quando usado).
import { itemsFromTextContent, parseDocument } from '../../shared/docParse.js';

let loader;
async function pdfjs() {
  loader ??= (async () => {
    const lib = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return loader;
}

export async function readPdfItems(file, maxPages = 4) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const items = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    items.push(...itemsFromTextContent(await page.getTextContent(), p));
  }
  await doc.destroy();
  return items;
}

/** Lê CRLV ou AET. Retorna null se o PDF não for reconhecido (ex.: PDF escaneado, sem texto). */
export async function readOfficialDocument(file) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return null;
  const items = await readPdfItems(file);
  return parseDocument(items, file.name);
}
