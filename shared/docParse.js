// Leitura dos PDFs oficiais (CRLV digital e AET do DNIT/DER) a partir do texto extraído do PDF.
// items: [{ str, x, y, h, page }] na ordem do arquivo (y cresce para cima, como no PDF).
// Funções puras: rodam no navegador (importação) e nos testes.

const PLATE_RE = /\b[A-Z]{3}\d[A-Z0-9]\d{2}\b/g;

export function textOf(items) {
  return items.map((i) => i.str).join('\n');
}

export function detectDocType(text) {
  if (/CERTIFICADO DE REGISTRO E LICENCIAMENTO/i.test(text)) return 'crlv';
  if (/AUTORIZA[ÇC][ÃA]O ESPECIAL DE TR[ÂA]NSITO/i.test(text) || /A\.E\.T\./.test(text)) return 'aet';
  return null;
}

const brDate = (s) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const num = (s) => {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/[^\d.,]/g, '');
  if (!t) return null;
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return Number.isFinite(n) ? n : null;
};
const clean = (s) => {
  const t = String(s ?? '').trim();
  return !t || /^\*+$/.test(t) ? null : t;
};

/**
 * CRLV digital (modelo nacional SENATRAN): cada rótulo (fonte pequena) tem o valor logo abaixo,
 * alinhado à esquerda. Procura o valor mais próximo abaixo de cada rótulo.
 */
export function valueBelow(items, label, { maxGap = 32, tol = 5 } = {}) {
  const lab = items.find((i) => i.str.trim().toUpperCase() === label);
  if (!lab) return null;
  let best = null;
  for (const it of items) {
    if (it === lab || it.page !== lab.page) continue;
    if (it.h && lab.h && it.h <= lab.h) continue; // outro rótulo
    const dy = lab.y - it.y;
    if (dy <= 0 || dy > maxGap) continue;
    if (Math.abs(it.x - lab.x) > tol) continue;
    if (!best || dy < lab.y - best.y) best = it;
  }
  if (!best) return null;
  // Valor quebrado em pedaços na mesma linha (ex.: "M.BENZ/AX0R 1933" + "S")
  const parts = [best];
  const line = items.filter((it) => it !== best && it.page === best.page && Math.abs(it.y - best.y) < 1.5 && it.x > best.x).sort((a, b) => a.x - b.x);
  for (const it of line) {
    const prev = parts[parts.length - 1];
    if (!prev.w || it.x > prev.x + prev.w + 12 || Math.abs((it.h || 0) - (prev.h || 0)) > 0.5) break;
    parts.push(it);
  }
  return parts.map((it) => it.str.trim()).join(' ');
}

const VEHICLE_TYPE_BY_SPECIES = [
  [/TRATOR/, 'cavalo'],
  [/SEMI-?REBOQUE/, 'carreta'],
  [/REBOQUE/, 'implemento'],
  [/CAMINH[AÃ]O/, 'caminhao'],
  [/CAMIONETA|UTILIT|AUTOM[OÓ]VEL|MISTO/, 'utilitario'],
];

function axleConfig(type, axles, model) {
  if (!axles) return null;
  if (type === 'carreta' || type === 'implemento') return axles >= 2 && axles <= 4 ? `${axles} eixos` : null;
  if (axles === 2) return '4x2';
  if (axles === 3) return /6X4/i.test(model || '') ? '6x4' : '6x2';
  if (axles === 4) return /8X4/i.test(model || '') ? '8x4' : '8x2';
  return null;
}

function fuelType(s, type) {
  if (type === 'carreta' || type === 'implemento') return 'nenhum';
  const f = String(s || '').toUpperCase();
  if (f.includes('ALCOOL/GASOLINA') || f.includes('FLEX')) return 'flex';
  if (f.includes('DIESEL')) return 'diesel_s10';
  if (f.includes('GASOLINA')) return 'gasolina';
  if (f.includes('ALCOOL') || f.includes('ETANOL')) return 'etanol';
  if (f.includes('ELETRIC')) return 'eletrico';
  if (f.includes('GAS NATURAL') || f.includes('GNV')) return 'gnv';
  return null;
}

export function parseCrlv(items) {
  const v = (label) => clean(valueBelow(items, label));
  const plate = (v('PLACA') || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
  const brandModel = v('MARCA / MODELO / VERSÃO') || '';
  // "SR/FACCHINI SRF CF", "VW/24.250E WORKER 6X2", "REB/PASTRE"
  const bm = brandModel.split('/');
  let brand = null;
  let model = null;
  if (bm.length >= 2) {
    const prefixed = /^(SR|REB|S\.REB|SEMI-?REB)$/i.test(bm[0].trim());
    const rest = prefixed ? bm.slice(1).join('/').trim() : null;
    if (prefixed) {
      const [b, ...m] = rest.split(/\s+/);
      brand = b || null;
      model = m.join(' ') || null;
    } else {
      brand = bm[0].trim();
      model = bm.slice(1).join('/').trim() || null;
    }
  } else if (brandModel) {
    model = brandModel;
  }
  const species = (v('ESPÉCIE / TIPO') || '').toUpperCase();
  const type = VEHICLE_TYPE_BY_SPECIES.find(([re]) => re.test(species))?.[1] || 'outros';
  const axles = num(v('EIXOS'));
  const chassis = (v('CHASSI') || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
  const renavam = (v('CÓDIGO RENAVAM') || '').replace(/\D/g, '') || null;
  // Valores abaixo de 3 t não são plausíveis para PBT/CMT (alguns CRLVs trazem o campo truncado)
  const plausible = (x) => (x !== null && x >= 3 ? x : null);
  const pbt = plausible(num(v('PESO BRUTO TOTAL')));
  const cmt = num(v('CMT')) >= 10 ? num(v('CMT')) : null;
  const cap = num(v('CAPACIDADE'));
  const body = v('CARROCERIA');
  return {
    kind: 'crlv',
    plate,
    renavam,
    chassis: chassis && chassis.length >= 11 ? chassis : null,
    exercise_year: num(v('EXERCÍCIO')),
    year_manufacture: num(v('ANO FABRICAÇÃO')),
    year_model: num(v('ANO MODELO')),
    crv_number: v('NÚMERO DO CRV'),
    brand,
    model,
    species: species || null,
    type,
    axles,
    axle_config: axleConfig(type, axles, model),
    fuel_type: fuelType(v('COMBUSTÍVEL'), type),
    color: v('COR PREDOMINANTE'),
    body_type: body && !/^N[AÃ]O APLIC/i.test(body) ? body : null,
    pbt: pbt || null,
    cmt: cmt || null,
    capacity: cap || null,
    owner_name: v('NOME'),
    owner_doc: v('CPF / CNPJ'),
    issued_on: brDate(v('DATA')),
    issuer: (() => {
      const m = /DETRAN\s*-?\s*\n?\s*([A-Z]{2})\b/.exec(textOf(items));
      return m ? `DETRAN-${m[1]}` : 'DETRAN';
    })(),
  };
}

export function parseAet(items, fileName = '') {
  const text = textOf(items);
  const flat = text.replace(/\s+/g, ' ');
  const dnit = /\bDNIT\b/.test(flat);
  const der = /DEPARTAMENTO DE ESTRADAS DE RODAGEM|\bDER\b/i.test(flat);
  let issuer = dnit ? 'DNIT' : der ? 'DER' : null;
  if (issuer === 'DER') {
    // UF pelo nome do arquivo (ex.: ..._DERSP_AET-...) ou pelo cabeçalho da secretaria paulista
    const uf = /DER[-_ ]?([A-Z]{2})(?![A-Z])/.exec(fileName.toUpperCase());
    const sp = /SECRETARIA DE MEIO AMBIENTE, INFRAESTRUTURA E LOG[ÍI]STICA|DER\/DV/i.test(flat);
    issuer = uf ? `DER-${uf[1]}` : sp ? 'DER-SP' : 'DER';
  }
  const number = (/A\.E\.T\.\s*N[ºo°]\s*([\w/-]+)/.exec(flat) || /N[ºo°]\s*(AET-\d+)/.exec(flat) || /\b(AET-\d+)\b/.exec(flat) || [])[1] || null;
  const period = /(?:per[íi]odo de:?|VALIDADE)\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i.exec(flat);
  const pbtc = num((/PBTC INFORMADO \(t\):\s*([\d.,]+)/i.exec(flat) || /TOTAL BRUTO:\s*([\d.,]+)\s*t/i.exec(flat) || [])[1]);
  let combination = (/CONJUNTO TIPO:\s*([A-Z0-9+][A-Z0-9 +]*?)(?=\s+(?:DESENHO|COMPRIMENTO|PBTC|DIMENS|N[úu]mero|[A-Z][a-zà-ú])|\s*$)/.exec(flat) || [])[1] || null;
  if (!combination) {
    const header = /A\.E\.T\.\s*N[ºo°]\s*[\w/-]+\s+([A-Z][A-Z0-9 +]+?)\s+PROPRIET/.exec(flat);
    combination = header ? header[1] : (/CONJUNTO:\s*([A-Z /]+?)\s+PESO/.exec(flat) || [])[1]?.replace(/\s*\/\s*/g, ' / ') || null;
  }
  const art = (/\bART\s*(?:N[ºo°])?\s*:?\s*(\d[\d/A-Z-]*)/.exec(flat) || [])[1] || null;
  const plates = [];
  for (const m of flat.matchAll(PLATE_RE)) if (!plates.includes(m[0])) plates.push(m[0]);
  return {
    kind: 'aet',
    issuer,
    number,
    valid_from: period ? brDate(period[1]) : null,
    expires_on: period ? brDate(period[2]) : null,
    pbtc,
    combination: combination ? combination.trim().slice(0, 80) : null,
    art,
    plates,
  };
}

/** Lê um documento a partir dos itens de texto. Retorna null se não reconhecer. */
export function parseDocument(items, fileName = '') {
  const type = detectDocType(textOf(items));
  if (type === 'crlv') return parseCrlv(items);
  if (type === 'aet') return parseAet(items, fileName);
  return null;
}

/** Converte o getTextContent() do pdf.js em itens { str, x, y, h, page }. */
export function itemsFromTextContent(textContent, page) {
  return textContent.items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 0, page }));
}
