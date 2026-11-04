// TAM / SAM / SOM model, ported from engine.py (Aprix team method).
// TAM: companies in scope × yearly contract. SAM: TAM × share that fit.
// SOM: SAM companies × win rate by year N, capped at N years of sales capacity.
// ICP: each company is checked against the ideal customer profile; answers come from
// columns in the screen or a viewer's answers file, assumed shares fill the gaps.
(() => {
  const DRIVERS = [
    ['Yearly contract value', 'acv'],
    ['Win rate by year 3', 'win'],
    ['Share of companies that fit', 'fit'],
    ['Clients signed per year', 'cap'],
  ];
  const KEYS = ['fit', 'acv', 'win', 'cap'];
  const DATASETS = ['cases', 'tiers', 'settings', 'segments', 'icp'];
  const finite = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // yes / y / true / 1 / x is a yes, no / n / false / 0 a no; anything else is unanswered.
  const readAnswer = (v) => {
    const t = norm(v);
    if (['yes', 'y', 'true', '1', 'x', 'sim', 's'].includes(t)) return true;
    if (['no', 'n', 'false', '0', 'nao'].includes(t)) return false;
    return null;
  };
  // Which column answers each ICP attribute: its exact name, else a header with one of its match words.
  const answerColumns = (headers, icp) => {
    const out = [];
    for (const a of icp.filter((r) => r.key !== 'revenue')) {
      const words = String(a.match ?? '').split('|').map(norm).filter(Boolean);
      const h = headers.find((k) => norm(k) === norm(a.column))
        || headers.find((k) => k !== 'Company Name' && !k.startsWith('Total Revenue') && words.some((w) => norm(k).includes(w)));
      if (h) out.push([a.key, h]);
    }
    return out;
  };
  const answersOf = (row, cols) => {
    const out = {};
    for (const [key, h] of cols) out[key] = readAnswer(row[h]);
    return out;
  };
  // A viewer's answers file: company name to answers.
  const answersFrom = (rows, icp) => {
    const cols = answerColumns(Object.keys(rows[0] || {}), icp);
    const map = new Map();
    for (const r of rows) {
      const name = norm(r['Company Name']);
      if (name) map.set(name, answersOf(r, cols));
    }
    return { map, columns: cols.length };
  };

  // Capital IQ rows mapped to segments, one row per company in any segment.
  const calcCompanies = (screen, segments, icp = []) => {
    const wanted = new Map();
    for (const s of segments) {
      if (!wanted.has(s.segment)) wanted.set(s.segment, { group: s.group, tags: new Set() });
      wanted.get(s.segment).tags.add(String(s.capital_iq_industry).trim());
    }
    const revenueColumn = Object.keys(screen[0] || {}).find((k) => k.startsWith('Total Revenue'));
    const cols = answerColumns(Object.keys(screen[0] || {}), icp);
    const seen = new Set();
    const out = [];
    for (const row of screen) {
      const name = row['Company Name'];
      const raw = row[revenueColumn];
      const revenue = Number(raw);
      if (!name || raw === '' || raw == null || !Number.isFinite(revenue)) continue;
      if (seen.has(name + '|' + revenue)) continue;
      seen.add(name + '|' + revenue);
      const tags = String(row['Industry Classifications'] ?? '').split(';').map((t) => t.replace('(Primary)', '').trim());
      for (const [segment, w] of wanted) {
        if (tags.some((t) => w.tags.has(t))) {
          const country = String(row['Geographic Locations'] ?? '').includes('Canada') ? 'Canada' : 'United States';
          out.push({ company: name, segment, group: w.group, revenue_usd_m: revenue, country, answers: answersOf(row, cols) });
          break;
        }
      }
    }
    return out;
  };

  // Size of the export and its revenue floor, to spot a cut-off at Capital IQ's row limit.
  const calcScreenStats = (screen) => {
    const revenueColumn = Object.keys(screen[0] || {}).find((k) => k.startsWith('Total Revenue'));
    const seen = new Set();
    const revenues = [];
    for (const row of screen) {
      const raw = row[revenueColumn];
      const revenue = Number(raw);
      if (!row['Company Name'] || raw === '' || raw == null || !Number.isFinite(revenue)) continue;
      if (seen.has(row['Company Name'] + '|' + revenue)) continue;
      seen.add(row['Company Name'] + '|' + revenue);
      revenues.push(revenue);
    }
    const floor = revenues.length ? Math.min(...revenues) : 0;
    const nearby = revenues.filter((r) => r >= floor && r <= floor * 1.5).length;
    return [{ exported: revenues.length, floor_usd_m: floor, nearby }];
  };

  function compute(d, p) {
    const set = {};
    for (const r of d.settings) set[String(r.setting).trim()] = Number(r.value);

    const segList = [];
    for (const r of d.segments) {
      if (!segList.some((s) => s.name === r.segment)) segList.push({ name: r.segment, group: r.group });
    }
    const core = segList.filter((s) => s.group === 'Core').map((s) => s.name);
    const segs = Array.isArray(p.segments)
      ? p.segments.filter((n) => segList.some((s) => s.name === n))
      : (core.length ? core : segList.map((s) => s.name));
    const countries = Array.isArray(p.countries) ? p.countries : ['United States', 'Canada'];
    const revMin = finite(p.rev_min) ? Number(p.rev_min) : set.revenue_min_usd_m;
    const revMax = finite(p.rev_max) ? Number(p.rev_max) : set.revenue_max_usd_m;
    const fx = finite(p.fx) && Number(p.fx) > 0 ? Number(p.fx) : set.fx_brl_per_usd;
    const years = set.years;
    const baseAcv = set.base_contract_usd;
    const pricing = p.pricing === 'tier' ? 'tier' : 'flat';
    const estimate = p.estimate === true;

    let over = {};
    try { over = p.cases ? JSON.parse(p.cases) : {}; } catch { over = {}; }
    const caseNames = [];
    const fileCases = {};
    for (const r of d.cases) {
      const n = String(r.case).trim();
      caseNames.push(n);
      fileCases[n] = { fit: Number(r.fit_share), acv: Number(r.yearly_contract_usd),
        win: Number(r.win_rate_year3), cap: Number(r.clients_per_year) };
    }
    const cases = {};
    for (const n of caseNames) {
      cases[n] = { ...fileCases[n] };
      for (const k of KEYS) if (over[n] && finite(over[n][k])) cases[n][k] = Number(over[n][k]);
    }
    const sel = cases[p.case] ? p.case : (cases.Base ? 'Base' : caseNames[0]);

    const tiers = d.tiers.map((r) => ({ name: String(r.tier).trim(), min: Number(r.min_revenue_brl_m),
      mrr: Number(r.target_mrr_brl) })).sort((a, b) => b.min - a.min);
    const lowest = tiers[tiers.length - 1].name;
    const below = 'Below ' + lowest;
    const tierNames = [...tiers.map((t) => t.name), below];
    const tierOf = (rev) => (tiers.find((t) => rev * fx >= t.min) || { name: below }).name;
    const tierAcv = Object.fromEntries(tiers.map((t) => [t.name, (t.mrr * 12) / fx]));
    tierAcv[below] = tierAcv[lowest];

    const inScope = (c) => segs.includes(c.segment) && countries.includes(c.country);
    const chosen = d.companies
      .filter((c) => inScope(c) && c.revenue_usd_m >= revMin && c.revenue_usd_m <= revMax)
      .map((c) => ({ ...c, tier: tierOf(c.revenue_usd_m) }));
    const units = chosen.map((c) => ({ segment: c.segment, group: c.group, tier: c.tier, country: c.country, n: 1 }));
    const focusEarly = p.focus && segs.includes(p.focus) ? p.focus : null;
    const icp = scoreIcp(d, p, focusEarly ? chosen.filter((c) => c.segment === focusEarly) : chosen, chosen);
    const samBasis = p.sam === 'icp' ? 'icp' : 'fit';
    const fitOf = (c) => (samBasis === 'icp' ? icp.ratio : c.fit);

    // Exports are sorted by revenue, so rows lost at the row limit sit just below the floor.
    // Assume they split across segments like the companies just above it.
    const st = d.screen_stats[0];
    const screenTotal = set.screen_total_companies;
    const screenMin = set.screen_revenue_min_usd_m;
    const missing = finite(screenTotal) ? Math.max(0, screenTotal - st.exported) : 0;
    const capped = finite(screenTotal) ? screenTotal > st.exported * 1.001 : st.exported > 0 && st.exported % 10000 === 0;
    const estUnits = [];
    if (missing > 0 && finite(screenMin) && st.floor_usd_m > screenMin && revMin < st.floor_usd_m && st.nearby > 0) {
      const inRange = (st.floor_usd_m - Math.max(revMin, screenMin)) / (st.floor_usd_m - screenMin);
      const tier = tierOf((screenMin + st.floor_usd_m) / 2);
      const groups = new Map();
      for (const c of d.companies) {
        if (!inScope(c) || c.revenue_usd_m < st.floor_usd_m || c.revenue_usd_m > st.floor_usd_m * 1.5) continue;
        const k = c.segment + '|' + c.country;
        if (!groups.has(k)) groups.set(k, { segment: c.segment, group: c.group, country: c.country, k: 0 });
        groups.get(k).k += 1;
      }
      for (const g of groups.values()) {
        estUnits.push({ segment: g.segment, group: g.group, tier, country: g.country,
          n: (g.k / st.nearby) * missing * inRange, estimated: true });
      }
    }
    const est = { capped, missing, screenTotal, exported: st.exported, floor: st.floor_usd_m,
      inScope: estUnits.reduce((a, u) => a + u.n, 0), screenMax: set.screen_revenue_max_usd_m };
    const everySeg = estimate ? units.concat(estUnits) : units;
    // A clicked segment narrows every figure to it; the breakdown still shows them all.
    const focus = p.focus && segs.includes(p.focus) ? p.focus : null;
    const all = focus ? everySeg.filter((u) => u.segment === focus) : everySeg;

    const acvFor = (u, c) => (pricing === 'tier' ? (tierAcv[u.tier] * c.acv) / baseAcv : c.acv);
    const size = (c) => {
      let n = 0;
      let money = 0;
      for (const u of all) { n += u.n; money += u.n * acvFor(u, c); }
      const acv = n ? money / n : c.acv;
      const samN = n * fitOf(c);
      const wanted = samN * c.win;
      const capacity = c.cap * years;
      const clients = Math.min(wanted, capacity);
      return { tamN: n, samN, clients, acv, TAM: n * acv, SAM: samN * acv, SOM: clients * acv,
        limit: wanted > capacity ? 'sales capacity' : 'win rate' };
    };
    const results = Object.fromEntries(caseNames.map((n) => [n, size(cases[n])]));
    const sens = cases.Low && cases.Base && cases.High
      ? DRIVERS.filter(([, k]) => samBasis === 'fit' || k !== 'fit').map(([label, k]) => {
        const low = size({ ...cases.Base, [k]: cases.Low[k] }).SOM;
        const high = size({ ...cases.Base, [k]: cases.High[k] }).SOM;
        return { label, low, high, swing: Math.abs(high - low) };
      }).sort((a, b) => b.swing - a.swing)
      : [];

    const poolAll = d.companies.filter(inScope);
    const pool = focus ? poolAll.filter((c) => c.segment === focus) : poolAll;
    const tierLines = tiers.map((t) => ({ name: t.name, usd_m: t.min / fx }));
    const mc = cases.Low && cases.Base && cases.High ? monteCarlo(all, cases, size, years, samBasis === 'icp' ? icp.ratio : null) : null;

    return { status: 'ok', icp, samBasis, set, segList, segs, countries, revMin, revMax, fx, years, pricing, estimate,
      cases, fileCases, over, caseNames, sel, tierNames, est, acvFor, results, sens, focus,
      chosen: focus ? chosen.filter((c) => c.segment === focus) : chosen, units: all, breakUnits: everySeg,
      pool, poolAll, tierLines, mc, topLow: set.top_down_low_usd, topHigh: set.top_down_high_usd };
  }

  // Scores companies against the ICP. Each attribute is yes, no or unanswered; an
  // unanswered one counts at its assumed share, so a company's chance of matching is the
  // product over attributes (treated as independent). Adds .icp and .priority to the rows.
  function scoreIcp(d, p, pool, chosen) {
    const rows = d.icp || [];
    const rev = rows.find((r) => r.key === 'revenue') || {};
    let over = {};
    try { over = p.icp_shares ? JSON.parse(p.icp_shares) : {}; } catch { over = {}; }
    const from = finite(p.icp_from) ? Number(p.icp_from) : finite(rev.from_usd_m) ? Number(rev.from_usd_m) : 0;
    const to = finite(p.icp_to) ? Number(p.icp_to) : finite(rev.to_usd_m) ? Number(rev.to_usd_m) : 1e9;
    const flags = rows.filter((r) => r.key !== 'revenue').map((r) => {
      const fileShare = finite(r.assumed_share) ? Number(r.assumed_share) : 0.5;
      return { key: String(r.key), label: String(r.attribute), fileShare,
        share: finite(over[r.key]) ? Math.min(1, Math.max(0, Number(over[r.key]))) : fileShare };
    });
    const big = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(2)}B` : `${Math.round(v)}M`);
    const attrs = [{ key: 'revenue', label: `Revenue US$${big(from)}–${big(to)}`, data: true }, ...flags];
    const upload = d.icpUpload;
    for (const c of chosen) {
      const fromFile = upload ? upload.map.get(norm(c.company)) : null;
      const ans = { revenue: c.revenue_usd_m >= from && c.revenue_usd_m <= to };
      for (const a of flags) {
        const u = fromFile ? fromFile[a.key] : null;
        ans[a.key] = u ?? (c.answers ? c.answers[a.key] ?? null : null);
      }
      let yes = 0;
      let no = 0;
      let chance = 1;
      for (const a of attrs) {
        if (ans[a.key] === true) yes += 1;
        else if (ans[a.key] === false) { no += 1; chance = 0; } else chance *= a.share;
      }
      const status = no ? 'out' : yes === attrs.length ? 'match' : 'possible';
      c.icp = { ans, yes, no, chance, status, inFile: Boolean(fromFile) };
      c.priority = (status === 'match' ? 2 : status === 'possible' ? 1 : 0) * 1e3 + yes * 10 + chance * 9.99;
    }
    // Funnel: companies still in after each attribute, confirmed and expected.
    const steps = [{ key: 'scope', label: 'Companies in scope', confirmed: pool.length, expected: pool.length }];
    const live = pool.map(() => ({ sure: true, p: 1 }));
    for (const a of attrs) {
      let confirmed = 0;
      let expected = 0;
      pool.forEach((c, i) => {
        const v = c.icp.ans[a.key];
        live[i].sure = live[i].sure && v === true;
        live[i].p *= v === true ? 1 : v === false ? 0 : a.share;
        if (live[i].sure) confirmed += 1;
        expected += live[i].p;
      });
      steps.push({ key: a.key, label: a.label, confirmed, expected, share: a.share, data: a.data,
        yes: pool.filter((c) => c.icp.ans[a.key] === true).length,
        no: pool.filter((c) => c.icp.ans[a.key] === false).length });
    }
    const expected = steps[steps.length - 1].expected;
    return { attrs, flags, from, to, over, steps, expected,
      answered: pool.filter((c) => flags.some((a) => c.icp.ans[a.key] !== null)).length,
      ratio: pool.length ? expected / pool.length : 0,
      match: pool.filter((c) => c.icp.status === 'match').length,
      possible: pool.filter((c) => c.icp.status === 'possible').length,
      out: pool.filter((c) => c.icp.status === 'out').length,
      file: upload ? { name: upload.name, matched: chosen.filter((c) => c.icp.inFile).length, columns: upload.columns } : null };
  }

  // SOM under uncertainty: each driver drawn from a triangular distribution with
  // Low as minimum, Base as mode and High as maximum. Seeded, so the chart is stable.
  const DRAWS = 5000;
  function monteCarlo(units, cases, size, years, fixedFit) {
    const base = size(cases.Base);
    const n = base.tamN;
    if (!n) return null;
    const acvFactor = base.acv / cases.Base.acv;
    let seed = 42;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const tri = (k) => {
      const [a, c, b] = [cases.Low[k], cases.Base[k], cases.High[k]].sort((x, y) => x - y);
      const mode = Math.min(Math.max(cases.Base[k], a), b);
      if (b === a) return a;
      const u = rand();
      const f = (mode - a) / (b - a);
      return u < f ? a + Math.sqrt(u * (b - a) * (mode - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - mode));
    };
    const draws = new Float64Array(DRAWS);
    for (let i = 0; i < DRAWS; i += 1) {
      const fit = fixedFit ?? tri('fit');
      const acv = tri('acv');
      const win = tri('win');
      const cap = tri('cap');
      draws[i] = Math.min(n * fit * win, cap * years) * acv * acvFactor;
    }
    draws.sort();
    const q = (p) => draws[Math.min(DRAWS - 1, Math.floor(p * DRAWS))];
    let above = 0;
    for (const v of draws) if (v > base.SOM) above += 1;
    return { draws, p10: q(0.1), p50: q(0.5), p90: q(0.9), above: above / DRAWS, base: base.SOM, count: DRAWS };
  }

  // Reads a Capital IQ export: CSV, TSV or .xlsx, as raw bytes or as a Google Drive
  // download answer (base64). Returns the Screening rows, plus the true screen size and
  // revenue bounds from the Aggregates and Screen Criteria sheets when the file has them.
  const readScreenFile = async ({ answer, kind = 'screen' }) => {
    const fail = (code, message) => Object.assign(new Error(message), { code });
    const decode = (b) => Uint8Array.from(atob(b.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    let bytes;
    if (answer instanceof ArrayBuffer) bytes = new Uint8Array(answer);
    else {
      const strings = [];
      const walk = (v) => {
        if (typeof v === 'string') {
          const s = v.trim();
          if (s.startsWith('{') || s.startsWith('[')) { try { walk(JSON.parse(s)); return; } catch { /* plain text */ } }
          strings.push(v);
        } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(answer);
      const s = strings.sort((a, b) => b.length - a.length)[0];
      if (!s) throw fail('drive', 'The Drive answer held no file content.');
      bytes = /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 4000)) && s.length > 64 ? decode(s) : new TextEncoder().encode(s);
    }
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw fail('xls', 'This is an old .xls file. Save it as .xlsx or CSV and load it again.');

    const toTable = (rows, meta) => {
      const h = rows.findIndex((r) => r.some((c) => String(c ?? '').trim() === 'Company Name'));
      if (h < 0) throw fail('bad', 'No Company Name column, so this does not look like a Capital IQ screen.');
      const header = rows[h].map((c) => String(c ?? '').trim());
      if (kind === 'screen' && !header.some((k) => k.startsWith('Total Revenue'))) throw fail('bad', 'No Total Revenue column, so this does not look like a Capital IQ screen.');
      const nameAt = header.indexOf('Company Name');
      const data = [];
      for (const r of rows.slice(h + 1)) {
        if (!String(r[nameAt] ?? '').trim()) continue;
        const o = {};
        header.forEach((k, i) => { if (k) o[k] = r[i] ?? ''; });
        data.push(o);
      }
      return { data, columns: header.filter(Boolean), meta };
    };

    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      let text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
      const first = text.slice(0, text.indexOf('\n') + 1 || text.length);
      const sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
      const rows = [];
      let row = [];
      let field = '';
      let quoted = false;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quoted) {
          if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === sep) { row.push(field); field = ''; } else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (ch !== '\r') field += ch;
      }
      if (field || row.length) { row.push(field); rows.push(row); }
      text = null;
      return toTable(rows, [{ label: 'File type', value: 'CSV' }]);
    }

    // .xlsx is a zip of XML parts: read the central directory, inflate the parts we need.
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
      if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw fail('read', 'This .xlsx file looks damaged.');
    const parts = {};
    const text = new TextDecoder();
    let p = dv.getUint32(end + 16, true);
    for (let k = dv.getUint16(end + 10, true); k > 0; k -= 1) {
      const nameLen = dv.getUint16(p + 28, true);
      const name = text.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      parts[name] = { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), offset: dv.getUint32(p + 42, true) };
      p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    const part = async (name) => {
      const f = parts[name.replace(/^\//, '')];
      if (!f) return null;
      const start = f.offset + 30 + dv.getUint16(f.offset + 26, true) + dv.getUint16(f.offset + 28, true);
      const raw = bytes.subarray(start, start + f.size);
      if (f.method === 0) return text.decode(raw);
      const out = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      return text.decode(out);
    };
    const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const tags = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
    const sharedXml = await part('xl/sharedStrings.xml');
    const shared = sharedXml ? tags(xml(sharedXml), 'si').map((si) => tags(si, 't').map((t) => t.textContent).join('')) : [];
    const rels = Object.fromEntries(tags(xml(await part('xl/_rels/workbook.xml.rels') || '<x/>'), 'Relationship')
      .map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
    const sheets = tags(xml(await part('xl/workbook.xml') || '<x/>'), 'sheet').map((s) => {
      const target = rels[s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')] || '';
      return { name: s.getAttribute('name'), path: target.startsWith('/') ? target.slice(1) : `xl/${target}` };
    });
    const sheetRows = async (sheet) => {
      const doc = xml(await part(sheet.path) || '<x/>');
      return tags(doc, 'row').map((r) => {
        const row = [];
        for (const c of tags(r, 'c')) {
          const letters = (c.getAttribute('r') || '').replace(/\d+/g, '');
          let col = 0;
          for (const ch of letters) col = col * 26 + ch.charCodeAt(0) - 64;
          const v = tags(c, 'v')[0];
          const t = c.getAttribute('t');
          row[col ? col - 1 : row.length] = t === 's' ? shared[Number(v?.textContent)] ?? ''
            : t === 'inlineStr' ? tags(c, 't').map((x) => x.textContent).join('') : v ? v.textContent : '';
        }
        return Array.from(row, (x) => x ?? '');
      });
    };
    if (!sheets.length) throw fail('read', 'This .xlsx file has no sheets.');
    const meta = [{ label: 'File type', value: 'Excel' }];
    const named = (n) => sheets.find((s) => s.name === n);
    if (named('Aggregates')) {
      const values = Object.fromEntries((await sheetRows(named('Aggregates'))).map((r) => [String(r[0]).trim(), Number(r[1])]));
      if (values.Total && values.Average) meta.push({ label: 'Screen total companies', value: String(Math.round(values.Total / values.Average)) });
    }
    if (named('Screen Criteria')) {
      const words = (await sheetRows(named('Screen Criteria'))).map((r) => r[0]).filter(Boolean).join(' ');
      const hit = words.match(/Total Revenue.*?between ([\d.,]+) and ([\d.,]+)/);
      if (hit) {
        meta.push({ label: 'Screen revenue from (US$M)', value: hit[1].replace(/,/g, '') });
        meta.push({ label: 'Screen revenue to (US$M)', value: hit[2].replace(/,/g, '') });
      }
    }
    return toTable(await sheetRows(named('Screening') || sheets[0]), meta);
  };

  // Which screen the figures use: a file the viewer loaded, or the saved
  // screen, whose version, date and true size come from its info file.
  function activeSource(p) {
    if (p.source === 'upload' && window.tsUpload) return { kind: 'upload', status: 'ok', ...window.tsUpload };
    const screen = dash.data('screen');
    const info = dash.data('screen_info');
    const status = screen.status !== 'ok' ? screen.status : info.status;
    const row = (status === 'ok' && info.data[0]) || {};
    const meta = Object.entries(META_SETTINGS)
      .filter(([, setting]) => finite(row[setting]))
      .map(([label, setting]) => ({ label, value: String(row[setting]) }));
    return { kind: 'saved', status, rows: screen.data, meta, label: row.label || 'Saved screen' };
  }

  // A loaded file brings its own screen size from its Aggregates and Screen Criteria sheets.
  const META_SETTINGS = {
    'Screen total companies': 'screen_total_companies',
    'Screen revenue from (US$M)': 'screen_revenue_min_usd_m',
    'Screen revenue to (US$M)': 'screen_revenue_max_usd_m',
  };
  const metaSettings = (meta) => Object.entries(META_SETTINGS).map(([label, setting]) => {
    const hit = (meta || []).find((x) => x.label === label);
    return { setting, value: hit ? hit.value : NaN };
  });

  let last = null;
  function model() {
    const p = dash.params();
    const source = activeSource(p);
    if (source.status !== 'ok') return { status: source.status, source };
    const ids = DATASETS;
    const got = ids.map((id) => dash.data(id));
    const bad = got.find((g) => g.status !== 'ok');
    if (bad) return { status: bad.status, source };
    const key = JSON.stringify(p);
    const refs = got.map((g) => g.data).concat(source.rows || null, window.tsIcpUpload || null);
    if (last && last.key === key && last.refs.length === refs.length && last.refs.every((r, i) => r === refs[i])) return last.m;
    const d = Object.fromEntries(ids.map((id, i) => [id, got[i].data]));
    d.companies = calcCompanies(source.rows, d.segments, d.icp);
    d.icpUpload = window.tsIcpUpload ? { ...window.tsIcpUpload, ...answersFrom(window.tsIcpUpload.rows, d.icp) } : null;
    d.screen_stats = calcScreenStats(source.rows);
    d.settings = d.settings.concat(metaSettings(source.meta));
    const m = compute(d, p);
    m.source = source;
    last = { key, refs, m };
    return m;
  }

  const money = (v) => {
    const a = Math.abs(v);
    if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  };
  const count = (v) => Math.round(v).toLocaleString('en-US');
  const clients = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = (v) => `${+(v * 100).toFixed(1)}%`;

  window.ts = { KEYS, DATASETS, calcCompanies, calcScreenStats, compute, model, money, count, clients, pct, finite,
    readScreenFile, activeSource, answersFrom };
})();
