# OpenCode Zen Precios Dashboard

Interactive single-page dashboard for exploring and comparing AI model pricing from [OpenCode Zen](https://opencode.ai/docs/es/zen/#precios).

### [>> Try it live <<](https://pfelipm.github.io/opencode-zen-precios/)

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Markup | Vanilla HTML5 |
| Styling | Vanilla CSS3 (custom properties, grid, flexbox) |
| Logic | Vanilla ES6+ (no frameworks, no dependencies) |
| Data source | Remote HTML scraped at runtime via `fetch()` |
| Deployment | Static file — serve from anywhere or open locally |

Zero npm dependencies. Zero build step. One file.

---

## Data Pipeline

### Fetch strategy (on page load + manual refresh)

```
1. Direct fetch → https://opencode.ai/docs/es/zen/
   │
   ├─ success → parse HTML
   │
   └─ fail (CORS) → try CORS proxies in order:
       │
       ├─ https://api.allorigins.win/raw?url=...
       │
       ├─ https://corsproxy.io/?...
       │
       └─ all fail → use hardcoded FALLBACK_DATA
```

### HTML parsing (`parseDataFromHTML`)

The page at `opencode.ai/docs/es/zen/` contains three HTML `<table>` elements. The parser uses `DOMParser` to extract:

| Table | Identified by | Extracted fields |
|-------|---------------|-----------------|
| **Endpoints** | Column header contains `"model id"` | `name → id` mapping |
| **Pricing** | Column header contains `"entrada"` or `"input"` | `name`, `input`, `output`, `cacheRead`, `cacheWrite` |
| **Deprecated** | Column header contains `"retirada"` or `"retirement"` | `name → deprecation date` mapping |

Price cells are parsed with `parsePriceCell()` which handles `"Free"` → `0`, `"$5.00"` → `5.0`, `"—"` → `null`.

Provider detection (`detectProvider`) classifies models by name/ID prefix:
- `gpt*` → OpenAI
- `claude*` → Anthropic
- `gemini*` → Google
- Everything else → Other

### Fallback data

`FALLBACK_DATA` is a hardcoded array of 46 model objects that ships with the file. Used when all network requests fail. Browsable immediately on page open before any fetch completes.

---

## Data Model

Each model is an object with this shape:

```js
{
  name:        string,   // Display name, e.g. "Claude Sonnet 4.5 (≤ 200K)"
  id:          string,   // Model ID for config, e.g. "claude-sonnet-4-5"
  provider:    string,   // "openai" | "anthropic" | "google" | "other"
  input:       number|null,   // Price per 1M input tokens (USD)
  output:      number|null,   // Price per 1M output tokens (USD)
  cacheRead:   number|null,   // Price per 1M cached read tokens
  cacheWrite:  number|null,   // Price per 1M cached write tokens
  free:        boolean,       // true if input===0 && output===0
  deprecated:  string|null,   // Retirement date, e.g. "July 23, 2026"
}
```

---

## Features

### Filtering

| Control | Behavior |
|---------|---------|
| **Search box** | Real-time text filter on `name` and `id` |
| **Provider chips** | Toggle OpenAI / Anthropic / Google / Other (multi-select) |
| **Type chips** | All / Free / Paid |
| **Hide deprecated** | Toggle removes models with a retirement date |
| **Only free** | Toggle shows only `free === true` models |

### Sorting

Click any column header to sort ascending/descending. Text columns (`name`, `id`, `provider`) default to asc on first click; numeric columns default to desc. Visual indicator (▲/▼) on the active column.

### Compare mode

1. Check individual model rows via per-row checkboxes
2. Header checkbox toggles select-all/deselect-all for visible rows
3. Click **Comparar** to filter the table to only checked models
4. Click **Salir de comparar** to return to normal view
5. Checkboxes persist across filter/sort changes

### Stats cards

Five summary cards at the top, computed from the currently filtered data:
- Total models (paid + free breakdown)
- Free model count
- Cheapest input price (model name shown)
- Most expensive output price (model name shown)
- Deprecated model count

### Status indicator

Pill in the header shows data source state:
- **Datos en vivo** (green) — successfully parsed from remote
- **Datos locales** (orange) — using fallback data
- **Fallback local** (red, temporary) — fetch just failed
- **Cargando…** (orange) — fetch in progress

### Refresh button

Re-runs the full fetch pipeline with a spinner animation during the request.

### Collapsible info section

Click "¿Qué hace esta app y cómo funciona?" below the header to expand a detailed explanation of the data source, parsing logic, and available controls.

### Attribution modal

"Autor" button opens a modal with author photo, name, and links to LinkedIn/GitHub profiles. Closes on overlay click, close button, or `Escape` key.

---

## Visual Design

- **Dark theme** with CSS custom properties
- **Color-coded prices**: green (free/cheap ≤$0.5) → yellow → orange → red (expensive >$10)
- **Price bars**: inline horizontal bars proportional to max column value
- **Provider badges**: color-coded by provider family
- **Deprecated badges**: red pill with tooltip showing retirement date
- **Responsive**: grid/cards reflow on mobile; price bars hide on narrow screens

---

## File Structure

```
.
├── index.html    # Complete SPA (HTML + CSS + JS in one file)
└── README.md     # This file
```

---

## Running

```bash
# Option 1: Open directly
open index.html              # macOS
xdg-open index.html          # Linux

# Option 2: Simple HTTP server (needed for some CORS proxies)
python3 -m http.server 8000
# Then visit http://localhost:8000

# Option 3: Any static host (Netlify, Vercel, GitHub Pages, etc.)
# Just deploy the single index.html
```

---

## Limitations

- **CORS**: Direct fetch to `opencode.ai` will likely be blocked by the browser's same-origin policy. The proxy fallback handles this, but proxies may have rate limits or downtime.
- **Parsing fragility**: If the source page structure changes (table headers, column order), the parser may break. The fallback data ensures the dashboard always works.
- **No persistence**: Checkbox selections and filter state are in-memory only — lost on page reload.
- **No server component**: All computation is client-side. No API keys needed.

---

## Author

**Pablo Felip**
- [LinkedIn](https://www.linkedin.com/in/pfelipm/)
- [GitHub](https://github.com/pfelipm/)

---

## License

This project is provided as-is for educational and personal use. Pricing data belongs to [OpenCode / Anomaly](https://opencode.ai).
