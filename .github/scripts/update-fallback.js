// Actualiza FALLBACK_DATA en index.html desde el endpoint Markdown canónico
// de la docs de OpenCode Console: https://opencode.ai/docs/console/models.md
//
// La política de opencode.ai/llms.txt publica cada página también como .md;
// la URL HTML canónica para humanos es la misma sin ".md". Parsear Markdown
// por CABECERAS de tabla (no por posición ni por heurísticas sueltas) hace el
// scrap robusto a reorganizaciones: la tabla de embeddings (solo "Model|Input")
// o la de imágenes ("Model|Price|Notes") nunca pueden confundirse con la de
// precios, que exige Input+Output+Cached Read.
//
// Guardianas de cordura (lección de la incidencia de octubre): si el parseo
// cae por debajo del 80% del fallback anterior, o falta la tabla de obsoletos,
// se aborta con error — un fallo ruidoso en el email de la Action, nunca un
// run verde con datos degradados en silencio.

const SOURCE_URL = 'https://opencode.ai/docs/console/models.md';
const INDEX_PATH = 'index.html';

const fs = require('fs');

async function fetchMarkdown() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OpencodeZenPreciosBot/1.0)',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error('Source is not Markdown (HTML interstitial or challenge page?)');
  }
  return text;
}

function cleanMdCell(raw) {
  return raw
    .replace(/~~[^~]*~~/g, '')               // precio tachado → precio efectivo con descuento
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [texto](url) → texto
    .replace(/<[^>]*>/g, '')                 // HTML embebido (divs de scroll, etc.)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .trim();
}

function splitMdRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanMdCell);
}

function extractMarkdownTables(text) {
  const lines = text.split(/\r?\n/);
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim().startsWith('|') && i + 1 < lines.length &&
        /^[\s|:-]+$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitMdRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitMdRow(lines[i]));
        i++;
      }
      tables.push({ header, rows });
    } else i++;
  }
  return tables;
}

function parsePriceCell(text) {
  const t = text.trim();
  if (!t || t === '—' || t === '-' || t.toLowerCase() === 'n/a' || t.toLowerCase() === 'not listed') return null;
  if (t.toLowerCase() === 'free') return 0;
  const m = t.match(/\$?([\d,.]+)/);
  if (!m) return null;
  return parseFloat(m[1].replace(',', ''));
}

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function detectProvider(name, id) {
  const n = name.toLowerCase(), i = id.toLowerCase();
  if (n.startsWith('gpt') || i.startsWith('gpt-')) return 'openai';
  if (n.startsWith('claude') || i.startsWith('claude-')) return 'anthropic';
  if (n.startsWith('gemini') || i.startsWith('gemini-')) return 'google';
  return 'other';
}

function parseDataFromMarkdown(md) {
  const tables = extractMarkdownTables(md);
  let endpointsTable, pricingTable, deprecatedTable;
  tables.forEach(t => {
    const hdrs = t.header.map(h => h.toLowerCase());
    if (hdrs.some(h => h.includes('model id') || h.includes('modelid'))) endpointsTable = endpointsTable || t;
    else if (hdrs.length >= 4 && hdrs.includes('input') && hdrs.includes('output') && hdrs.includes('cached read')) pricingTable = pricingTable || t;
    else if (hdrs.some(h => h.includes('retirada') || h.includes('retirement') || h.includes('deprecat'))) deprecatedTable = deprecatedTable || t;
  });

  const modelIdMap = {};
  if (endpointsTable) {
    for (const cells of endpointsTable.rows) {
      if (cells.length >= 2) modelIdMap[cells[0]] = cells[1];
    }
  }

  const deprecatedMap = {};
  if (deprecatedTable) {
    for (const cells of deprecatedTable.rows) {
      if (cells.length >= 2) deprecatedMap[cells[0]] = cells[1];
    }
  }

  const data = [];
  if (pricingTable) {
    for (const cells of pricingTable.rows) {
      if (cells.length < 4) continue;
      const name = cells[0];
      const input = parsePriceCell(cells[1]);
      const output = parsePriceCell(cells[2]);
      const cacheRead = parsePriceCell(cells[3]);
      const cacheWrite = cells.length >= 5 ? parsePriceCell(cells[4]) : null;

      let id = modelIdMap[name] || null;
      if (!id) {
        const baseName = name.replace(/\s*[\(\[].*[\)\]].*/, '').trim();
        id = modelIdMap[baseName] || null;
      }
      if (!id) {
        id = slugify(name);
      } else if (/[\(\[]/.test(name)) {
        const high = />|>\s*\d|high/i.test(name);
        if (high && !id.endsWith('-high')) id = id + '-high';
      }

      const provider = detectProvider(name, id);
      const free = input === 0 && output === 0;
      const deprecated = deprecatedMap[name] || null;

      data.push({ name, id, provider, input, output, cacheRead, cacheWrite, free, deprecated });
    }
  }
  return { data, pricingFound: !!pricingTable, deprecatedFound: !!deprecatedTable };
}

function previousFallbackCount(index) {
  const m = index.match(/const FALLBACK_DATA = \[([\s\S]*?)\n\];/);
  if (!m) return 0;
  return (m[1].match(/\{name:/g) || []).length;
}

function num(v) {
  return v === null ? 'null' : String(v);
}

function generateFallbackCode(data) {
  const entries = data.map(m => {
    let line = `  {name:${JSON.stringify(m.name)},id:${JSON.stringify(m.id)},provider:${JSON.stringify(m.provider)},` +
      `input:${num(m.input)},output:${num(m.output)},cacheRead:${num(m.cacheRead)},cacheWrite:${num(m.cacheWrite)},free:${m.free}`;
    if (m.deprecated) line += `,deprecated:${JSON.stringify(m.deprecated)}`;
    return line + '}';
  });
  return `const FALLBACK_DATA = [\n${entries.join(',\n')}\n];`;
}

async function main() {
  console.log('Fetching canonical Markdown source...');
  const md = await fetchMarkdown();

  console.log('Parsing tables...');
  const { data, pricingFound, deprecatedFound } = parseDataFromMarkdown(md);
  if (!pricingFound) {
    console.error('Pricing table not found');
    process.exit(1);
  }
  if (data.length === 0) {
    console.error('Parsed 0 models, aborting without changes.');
    process.exit(1);
  }

  const index = fs.readFileSync(INDEX_PATH, 'utf8');
  const re = /const FALLBACK_DATA = \[[\s\S]*?\n\];/;
  if (!re.test(index)) {
    console.error('FALLBACK_DATA block not found in index.html');
    process.exit(1);
  }

  // Guardianas de cordura: fallo ruidoso antes que degradación silenciosa.
  const prev = previousFallbackCount(index);
  const min = Math.max(1, Math.floor(prev * 0.8));
  if (data.length < min) {
    console.error(`Sanity guard: parsed ${data.length} models, below 80% of the ${prev} in the current fallback. Aborting.`);
    process.exit(1);
  }
  if (!deprecatedFound) {
    console.error('Sanity guard: deprecations table not found in source. Aborting (this dashboard marks retirement dates).');
    process.exit(1);
  }
  const deprecatedMatched = data.filter(m => m.deprecated).length;
  if (deprecatedMatched === 0) {
    console.error('Sanity guard: 0 models matched a retirement date (name drift between pricing and deprecations?). Aborting.');
    process.exit(1);
  }

  const updated = index.replace(re, generateFallbackCode(data));
  if (updated === index) {
    console.log('No changes in fallback data.');
    return;
  }
  fs.writeFileSync(INDEX_PATH, updated);
  console.log(`index.html updated with fresh FALLBACK_DATA: ${data.length} models, ${deprecatedMatched} deprecated.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
