const SOURCE_URL = 'https://opencode.ai/docs/es/zen/';
const INDEX_PATH = 'index.html';

const fs = require('fs');

async function fetchHTML() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OpencodeZenPreciosBot/1.0)',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.text();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cellText(raw) {
  return decodeEntities(raw.replace(/<[^>]*>/g, '')).trim();
}

function extractTables(html) {
  return html.match(/<table[\s\S]*?<\/table>/g) || [];
}

function headerCells(table) {
  const out = [];
  const re = /<th[^>]*>([\s\S]*?)<\/th>/gi;
  let m;
  while ((m = re.exec(table)) !== null) out.push(cellText(m[1]).toLowerCase());
  return out;
}

function bodyRows(table) {
  const tbodyMatch = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const body = tbodyMatch ? tbodyMatch[1] : table;
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rm;
  while ((rm = rowRe.exec(body)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cellRe.exec(rm[1])) !== null) cells.push(cellText(cm[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function parsePriceCell(text) {
  const t = text.trim();
  if (!t || t === '—' || t === '-' || t.toLowerCase() === 'n/a') return null;
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

function parseDataFromHTML(html) {
  let endpointsTable, pricingTable, deprecatedTable;
  for (const table of extractTables(html)) {
    const hdrs = headerCells(table);
    if (hdrs.some(h => h.includes('model id') || h.includes('modelid'))) endpointsTable = table;
    else if (hdrs.some(h => h.includes('entrada') || h.includes('input'))) pricingTable = table;
    else if (hdrs.some(h => h.includes('retirada') || h.includes('retirement'))) deprecatedTable = table;
  }
  if (!pricingTable) throw new Error('Pricing table not found');

  const modelIdMap = {};
  if (endpointsTable) {
    for (const cells of bodyRows(endpointsTable)) {
      if (cells.length >= 2) modelIdMap[cells[0]] = cells[1];
    }
  }

  const deprecatedMap = {};
  if (deprecatedTable) {
    for (const cells of bodyRows(deprecatedTable)) {
      if (cells.length >= 2) deprecatedMap[cells[0]] = cells[1];
    }
  }

  const data = [];
  for (const cells of bodyRows(pricingTable)) {
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
  return data;
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
  console.log('Fetching source page...');
  const html = await fetchHTML();

  console.log('Parsing tables...');
  const data = parseDataFromHTML(html);
  if (data.length === 0) {
    console.error('Parsed 0 models, aborting without changes.');
    process.exit(1);
  }
  console.log(`Parsed ${data.length} models.`);

  const index = fs.readFileSync(INDEX_PATH, 'utf8');
  const re = /const FALLBACK_DATA = \[[\s\S]*?\n\];/;
  if (!re.test(index)) {
    console.error('FALLBACK_DATA block not found in index.html');
    process.exit(1);
  }
  const updated = index.replace(re, generateFallbackCode(data));

  if (updated === index) {
    console.log('No changes in fallback data.');
    return;
  }
  fs.writeFileSync(INDEX_PATH, updated);
  console.log('index.html updated with fresh FALLBACK_DATA.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
