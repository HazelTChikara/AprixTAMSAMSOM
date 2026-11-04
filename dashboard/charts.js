(() => {
  const TIER_OPACITY = [1, 0.78, 0.6, 0.44, 0.3];
  // Aprix brand: electric blue for the market, green for what is won, navy for contrast.
  const BRAND = { blue: 'var(--ap-blue)', navy: 'var(--ap-navy)', green: 'var(--ap-green)' };
  const SERIES = [BRAND.blue, BRAND.navy, BRAND.green];
  const accent = () => BRAND.blue;
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seen = new Set();
  let uid = 0;

  // ---- Shared plumbing ---------------------------------------------------------------------

  // Clears a drawing and returns the model, or shows the loading or failed state.
  function begin(el) {
    const m = ts.model();
    el.replaceChildren();
    el.classList.toggle('dash-skeleton', m.status === 'loading');
    if (m.status === 'ok') return m;
    if (m.status === 'empty') { emptyLine(el, 'Load a Capital IQ export in the Data panel to see this.'); return null; }
    if (m.status !== 'loading') {
      const line = document.createElement('div');
      line.className = 'ts-fail';
      const dot = document.createElement('span');
      dot.className = 'ts-fail-dot';
      const words = document.createElement('span');
      words.textContent = 'Failed to load';
      line.append(dot, words);
      el.append(line);
    }
    return null;
  }

  function emptyLine(el, text) {
    const p = document.createElement('p');
    p.className = 'ts-empty-line';
    p.textContent = text;
    el.append(p);
  }

  const svgIn = (el, width, height, label) => d3.select(el).append('svg')
    .attr('width', '100%').attr('viewBox', `0 0 ${width} ${height}`)
    .attr('class', 'ts-svg').attr('role', 'img').attr('aria-label', label);

  // A flat bar with slightly rounded corners.
  function bar(g, x, y, w, h, color, opacity = 1) {
    return g.append('rect').attr('class', 'ts-box').attr('x', x).attr('y', y).attr('width', w).attr('height', h)
      .attr('rx', Math.min(2, w / 2, h / 2)).style('fill', color).style('opacity', opacity);
  }

  // Plays a chart in once, the first time it has data: a wipe from the left or the floor.
  function reveal(svg, name, W, H, from = 'left') {
    if (seen.has(name)) return;
    seen.add(name);
    if (calm()) return;
    const start = from === 'left' ? 'inset(0% 100% 0% 0%)' : 'inset(100% 0% 0% 0%)';
    svg.style('clip-path', start)
      .transition().duration(900).ease(d3.easeCubicOut)
      .styleTween('clip-path', () => d3.interpolateString(start, 'inset(0% 0% 0% 0%)'))
      .on('end', function () { d3.select(this).style('clip-path', null); });
  }

  function tip(el) {
    const t = document.createElement('div');
    t.className = 'ts-tip';
    t.hidden = true;
    el.append(t);
    return {
      show(event, title, lines) {
        t.replaceChildren();
        const h = document.createElement('div');
        h.className = 'ts-tip-title';
        h.textContent = title;
        t.append(h);
        for (const [color, label, value, opacity] of lines) {
          const row = document.createElement('div');
          row.className = 'ts-tip-row';
          if (color) {
            const sw = document.createElement('span');
            sw.className = 'ts-sw';
            sw.style.background = color;
            if (opacity != null) sw.style.opacity = opacity;
            row.append(sw);
          }
          const a = document.createElement('span');
          a.textContent = label;
          const b = document.createElement('b');
          b.textContent = value;
          row.append(a, b);
          t.append(row);
        }
        t.hidden = false;
        const box = el.getBoundingClientRect();
        let x = event.clientX - box.left + 14;
        let y = event.clientY - box.top + 14;
        if (x + t.offsetWidth > el.clientWidth) x = event.clientX - box.left - t.offsetWidth - 14;
        if (y + t.offsetHeight > el.clientHeight) y = event.clientY - box.top - t.offsetHeight - 14;
        t.style.left = `${Math.max(0, x)}px`;
        t.style.top = `${Math.max(0, y)}px`;
      },
      hide() { t.hidden = true; },
    };
  }

  // Power BI style hover: the hovered mark stays, the rest step back.
  function spotlight(sel, svg) {
    sel.on('pointerenter.spot', function () {
      svg.selectAll('.ts-mark').classed('is-dim', true);
      d3.select(this).classed('is-dim', false);
    }).on('pointerleave.spot', () => svg.selectAll('.ts-mark').classed('is-dim', false));
  }

  const widest = (sel) => d3.max(sel.nodes(), (n) => n.getComputedTextLength()) || 0;

  function legend(el, items) {
    const box = document.createElement('div');
    box.className = 'ts-legend';
    for (const [color, label, opacity, dashed] of items) {
      const item = document.createElement('span');
      const sw = document.createElement('span');
      sw.className = dashed ? 'ts-sw ts-sw-line' : 'ts-sw';
      sw.style[dashed ? 'borderColor' : 'background'] = color;
      if (opacity != null) sw.style.opacity = opacity;
      const words = document.createElement('span');
      words.textContent = label;
      item.append(sw, words);
      box.append(item);
    }
    el.append(box);
  }

  function gridY(svg, y, x0, x1, ticks, fmt) {
    const g = svg.append('g');
    for (const v of ticks) {
      g.append('line').attr('x1', x0).attr('x2', x1).attr('y1', y(v)).attr('y2', y(v))
        .style('stroke', 'var(--cds-chart-grid)').style('stroke-dasharray', v ? '2 4' : null);
      if (fmt) g.append('text').attr('x', x0).attr('y', y(v) - 4).attr('class', 'ts-tick').text(fmt(v));
    }
  }

  // ---- Values in sentences and tiles -------------------------------------------------------

  const usdM = (v) => `US$${ts.count(v)}M`;
  const VALUES = {
    case: (m) => m.sel,
    years: (m) => String(m.years),
    limit: (m) => m.results[m.sel].limit,
    acv: (m) => ts.money(m.results[m.sel].acv),
    tamN: (m) => `${ts.count(m.results[m.sel].tamN)} companies × ${ts.money(m.results[m.sel].acv)} a year`,
    samN: (m) => (m.samBasis === 'icp'
      ? `${ts.count(m.results[m.sel].samN)} companies · ${ts.pct(m.icp.ratio)} expected to match the ICP`
      : `${ts.count(m.results[m.sel].samN)} companies · ${ts.pct(m.cases[m.sel].fit)} of TAM fit`),
    'sam-def': (m) => (m.samBasis === 'icp' ? 'companies that match the ICP' : 'the share that fit'),
    'icp-match': (m) => ts.count(m.icp.match),
    'icp-expected': (m) => ts.count(m.icp.expected),
    'icp-ratio': (m) => ts.pct(m.icp.ratio),
    'icp-possible': (m) => ts.count(m.icp.possible),
    'icp-out': (m) => ts.count(m.icp.out),
    'icp-answered': (m) => ts.count(m.icp.answered),
    'icp-scope': (m) => ts.count(m.icp.steps[0].confirmed),
    'icp-to': (m) => usdM(m.icp.to),
    'icp-from': (m) => usdM(m.icp.from),
    'rev-range': (m) => `${usdM(m.revMin)} to ${usdM(m.revMax)}`,
    somN: (m) => `${ts.clients(m.results[m.sel].clients)} clients by year ${m.years} · ${ts.pct(m.cases[m.sel].win)} win rate`,
    'td-share': (m) => {
      const t = m.results[m.sel].TAM;
      return `${Math.round((t / m.topHigh) * 100)}% to ${Math.round((t / m.topLow) * 100)}%`;
    },
    'td-range': (m) => `${ts.money(m.topLow)} to ${ts.money(m.topHigh)}`,
    exported: (m) => ts.count(m.est.exported),
    'screen-total': (m) => ts.count(m.est.screenTotal),
    missing: (m) => ts.count(m.est.missing),
    floor: (m) => `US$${m.est.floor.toFixed(1)}M`,
    'est-inscope': (m) => ts.count(m.est.inScope),
    'screen-max': (m) => usdM(m.est.screenMax),
    'mc-p10': (m) => (m.mc ? ts.money(m.mc.p10) : '—'),
    'mc-p50': (m) => (m.mc ? ts.money(m.mc.p50) : '—'),
    'mc-p90': (m) => (m.mc ? ts.money(m.mc.p90) : '—'),
    'mc-above': (m) => (m.mc ? `${Math.round(m.mc.above * 100)}%` : '—'),
    'mc-n': (m) => (m.mc ? ts.count(m.mc.count) : '—'),
  };

  dash.draw('v', (el) => {
    const m = ts.model();
    const key = el.getAttribute('data-v');
    if (m.status !== 'ok') { el.textContent = '—'; return; }
    if (VALUES[key]) { el.textContent = VALUES[key](m); return; }
    if (key.startsWith('icp-known@')) {
      const st = m.icp.steps.find((x) => x.key === key.slice(10));
      el.textContent = st ? (st.yes + st.no ? `${ts.count(st.yes)} yes · ${ts.count(st.no)} no` : 'no answers yet') : '—';
      return;
    }
    const [measure, name] = key.split('@');
    const r = m.results[name || m.sel];
    el.textContent = r ? ts.money(r[measure]) : '—';
  });

  // ---- Scenario strip ----------------------------------------------------------------------

  dash.draw('scenario', (el) => {
    const m = ts.model();
    el.replaceChildren();
    if (m.status !== 'ok') { el.textContent = '—'; return; }
    const both = m.countries.length === 2;
    const chips = [
      [`${m.sel} case`, 'is-strong'],
      [m.segs.length === 1 ? m.segs[0] : `${m.segs.length} segments`],
      [both ? 'US + Canada' : (m.countries[0] === 'Canada' ? 'Canada' : m.countries.length ? 'US only' : 'No country')],
      [`US$${ts.count(m.revMin)}M–${ts.count(m.revMax)}M revenue`],
      [m.pricing === 'tier' ? 'Tier pricing' : 'Flat pricing'],
      [`R$${+m.fx.toFixed(2)} per US$`],
    ];
    if (m.estimate) chips.push(['+ cut-off estimate']);
    if (Object.keys(m.over).length) chips.push(['Drivers edited', 'is-warn']);
    if (m.samBasis === 'icp') chips.push(['SAM from ICP']);
    if (Object.keys(m.icp.over).length) chips.push(['ICP shares edited', 'is-warn']);
    if (m.icp.file) chips.push([`ICP answers: ${m.icp.file.name}`]);
    for (const [text, cls] of chips) {
      const c = document.createElement('span');
      c.className = `ts-chip-static${cls ? ` ${cls}` : ''}`;
      c.textContent = text;
      el.append(c);
    }
    if (m.focus) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ts-chip-static is-focus';
      b.textContent = `Focused on ${m.focus}  ×`;
      b.setAttribute('aria-label', `Clear focus on ${m.focus}`);
      b.addEventListener('click', () => dash.setParams({ focus: null }));
      el.append(b);
    }
  });

  // ---- Which screen is in use -------------------------------------------------------------

  dash.draw('source-status', (el) => {
    const src = ts.activeSource(dash.params());
    const m = ts.model();
    const size = (n, total) => `${ts.count(n)} companies${ts.finite(total) ? ` of ${ts.count(total)} in the screen` : ''}`;
    if (src.status === 'loading') { el.textContent = 'Loading the saved screen…'; return; }
    if (m.status !== 'ok') { el.textContent = '—'; return; }
    const n = size(m.est.exported, m.est.screenTotal);
    if (src.kind === 'upload') el.textContent = `Your file · ${src.name} · ${n}`;
    else el.textContent = `Saved screen ${src.label} · ${n}`;
  });

  // ---- Segment chips -----------------------------------------------------------------------

  dash.draw('seg-picks', (el) => {
    const m = begin(el);
    if (!m) return;
    const counts = d3.rollup(m.poolAll.filter((c) => c.revenue_usd_m >= m.revMin && c.revenue_usd_m <= m.revMax),
      (v) => v.length, (c) => c.segment);
    for (const [group, segs] of d3.group(m.segList, (s) => s.group)) {
      const block = document.createElement('div');
      block.className = 'ts-chip-block';
      const head = document.createElement('div');
      head.className = 'ts-label';
      head.textContent = group;
      const row = document.createElement('div');
      row.className = 'ts-chips';
      for (const s of segs) {
        const on = m.segs.includes(s.name);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ts-chip';
        b.setAttribute('aria-pressed', String(on));
        const name = document.createElement('span');
        name.textContent = s.name;
        const n = document.createElement('span');
        n.className = 'ts-chip-n';
        n.textContent = ts.count(counts.get(s.name) || 0);
        b.append(name, n);
        b.addEventListener('click', () => {
          const next = on ? m.segs.filter((x) => x !== s.name) : m.segList.map((x) => x.name).filter((x) => x === s.name || m.segs.includes(x));
          dash.setParams({ segments: next });
        });
        row.append(b);
      }
      block.append(head, row);
      el.append(block);
    }
  });

  // ---- Hero: nested circles or a funnel -------------------------------------------------

  function drawCircles(el, m, W) {
    const r = m.results[m.sel];
    const c = m.cases[m.sel];
    const color = accent();
    const H = Math.round(Math.max(280, Math.min(440, W * 0.74)));
    const t = tip(el);
    const items = [
      { k: 'TAM', v: r.TAM, sub: `${ts.count(r.tamN)} companies`, base: 0.12 },
      { k: 'SAM', v: r.SAM, sub: `${ts.pct(c.fit)} of TAM`, base: 0.28 },
      { k: 'SOM', v: r.SOM, sub: `${ts.pct(r.TAM ? r.SOM / r.TAM : 0)} of TAM`, base: 1 },
    ];
    const ratio = (v) => (r.TAM ? Math.sqrt(v / r.TAM) : 0);
    const needs = (rad) => items.map((it, i) => {
      const own = rad * ratio(it.v);
      const next = items[i + 1] ? rad * ratio(items[i + 1].v) : 0;
      return 2 * (own - next) < 58 || own * 2 < 64;
    });
    let R = (H - 40) / 2;
    let side = needs(R);
    const gutter = side.some(Boolean) ? 150 : 0;
    R = Math.min(R, (W - gutter - 12) / 2);
    side = needs(R);
    const cx = gutter ? R + 6 : W / 2;
    const bottom = H - 22;
    const svg = svgIn(el, W, H, `${m.sel} case TAM, SAM and SOM as nested circles, area to scale`);

    const stage = svg.append('g');
    for (const it of items) {
      it.r = Math.max(R * ratio(it.v), 2.5);
      it.cy = bottom - it.r;
      it.top = bottom - 2 * it.r;
      const tone = it.k === 'SOM' ? BRAND.green : color;
      const g = stage.append('g').attr('class', 'ts-mark');
      g.append('circle').attr('cx', cx).attr('cy', it.cy).attr('r', it.r).style('fill', tone).style('fill-opacity', it.base);
      g.append('circle').attr('cx', cx).attr('cy', it.cy).attr('r', it.r)
        .style('fill', 'none').style('stroke', tone).style('stroke-opacity', it.k === 'SOM' ? 0.9 : 0.5).style('stroke-width', 1);
      g.on('pointermove', (event) => { event.stopPropagation(); t.show(event, `${it.k} · ${m.sel} case`, [[null, it.sub, ts.money(it.v)]]); })
        .on('pointerleave', () => t.hide());
    }
    // Hovering a circle keeps it; the others step back.
    stage.selectAll('.ts-mark').on('pointerenter.spot', function () {
      stage.selectAll('.ts-mark').classed('is-dim', true);
      d3.select(this).classed('is-dim', false);
    }).on('pointerleave.spot', () => stage.selectAll('.ts-mark').classed('is-dim', false));

    let lastY = -Infinity;
    const lx = cx + R + 30;
    for (const [i, it] of items.entries()) {
      if (!side[i]) {
        const inv = it.k === 'SOM';
        const y = it.top + 26;
        svg.append('text').attr('x', cx).attr('y', y).attr('text-anchor', 'middle')
          .attr('class', `ts-ring-tag${inv ? ' ts-on-accent' : ''}`).text(it.k);
        svg.append('text').attr('x', cx).attr('y', y + 26).attr('text-anchor', 'middle')
          .attr('class', `ts-ring-val${inv ? ' ts-on-accent' : ''}`).text(ts.money(it.v));
        continue;
      }
      const ly = Math.max(it.top + 6, lastY + 52, 34);
      lastY = ly;
      svg.append('path').attr('d', `M${cx},${it.top} V${Math.min(it.top, ly - 18)} H${lx - 8}`)
        .style('stroke', 'var(--cds-chart-reference)').style('fill', 'none').style('stroke-dasharray', '3 3');
      svg.append('circle').attr('cx', cx).attr('cy', it.top).attr('r', 3).style('fill', it.k === 'SOM' ? BRAND.green : color);
      svg.append('text').attr('x', lx).attr('y', ly - 14).attr('class', 'ts-ring-tag').text(it.k);
      svg.append('text').attr('x', lx).attr('y', ly + 8).attr('class', 'ts-ring-val').text(ts.money(it.v));
    }
    if (!seen.has('circles') && !calm()) {
      stage.attr('transform', `translate(${cx},${bottom}) scale(0.01) translate(${-cx},${-bottom})`)
        .transition().duration(900).ease(d3.easeBackOut.overshoot(1.1))
        .attr('transform', `translate(${cx},${bottom}) scale(1) translate(${-cx},${-bottom})`);
    }
    seen.add('circles');
  }

  function drawFunnel(el, m, W) {
    const r = m.results[m.sel];
    const c = m.cases[m.sel];
    const color = accent();
    const steps = [
      { k: 'TAM', v: r.TAM, keep: null },
      { k: 'SAM', v: r.SAM, keep: `${ts.pct(c.fit)} fit` },
      { k: 'SOM', v: r.SOM, keep: `${ts.pct(r.SAM ? r.SOM / r.SAM : 0)} won` },
    ];
    const rowH = 96;
    const H = rowH * 3 + 16;
    const svg = svgIn(el, W, H, `${m.sel} case funnel from TAM to SOM`);
    const t = tip(el);
    const span = W - 130;
    const mid = span / 2;
    const x = d3.scaleLinear([0, r.TAM || 1], [0, span - 8]);
    steps.forEach((st, i) => {
      const w = Math.max(8, x(st.v));
      const next = steps[i + 1] ? Math.max(8, x(steps[i + 1].v)) : w * 0.92;
      const y0 = i * rowH + 18;
      const y1 = y0 + 60;
      const g = svg.append('g').attr('class', 'ts-mark');
      const body = `M${mid - w / 2},${y0} L${mid - next / 2},${y1} H${mid + next / 2} L${mid + w / 2},${y0} Z`;
      g.append('path').attr('d', body).style('fill', i === 2 ? BRAND.green : color).style('opacity', [0.55, 0.78, 1][i]);
      g.on('pointermove', (event) => t.show(event, `${st.k} · ${m.sel} case`, [[null, 'Value', ts.money(st.v)]]))
        .on('pointerleave', () => t.hide());
      svg.append('line').attr('x1', mid + w / 2 + 8).attr('x2', span + 10).attr('y1', y0 + 24).attr('y2', y0 + 24)
        .style('stroke', 'var(--cds-chart-grid)');
      svg.append('text').attr('x', span + 16).attr('y', y0 + 14).attr('class', 'ts-ring-tag').text(st.k);
      svg.append('text').attr('x', span + 16).attr('y', y0 + 38).attr('class', 'ts-ring-val').text(ts.money(st.v));
      if (st.keep) {
        svg.append('text').attr('x', mid).attr('y', y0 - 6).attr('text-anchor', 'middle')
          .attr('class', 'ts-tick ts-strong').text(`↓ ${st.keep}`);
      }
    });
    spotlight(svg.selectAll('.ts-mark'), svg);
    reveal(svg, 'funnel', W, H, 'floor');
  }

  dash.draw('size', (el) => {
    const m = begin(el);
    if (!m) return;
    if (!m.results[m.sel].tamN) { emptyLine(el, 'No companies match these choices.'); return; }
    const W = Math.max(280, el.clientWidth);
    if (dash.params().view === 'funnel') drawFunnel(el, m, W);
    else drawCircles(el, m, W);
  });

  // ---- KPI range: where the selected case sits between Low and High ------------------------

  dash.draw('range', (el) => {
    const m = begin(el);
    if (!m) return;
    const measure = el.getAttribute('data-m');
    const names = m.caseNames.filter((n) => m.results[n]);
    const vals = names.map((n) => m.results[n][measure]);
    const tone = measure === 'SOM' ? BRAND.green : accent();
    const W = Math.max(160, el.clientWidth);
    const H = 36;
    const svg = svgIn(el, W, H, `${measure} across cases`);
    const t = tip(el);
    const x = d3.scaleLinear([0, d3.max(vals) || 1], [6, W - 6]);
    svg.append('rect').attr('x', 2).attr('y', 7).attr('width', W - 4).attr('height', 8).attr('rx', 4).style('fill', 'var(--cds-chart-grid)');
    const lo = d3.min(vals);
    const hi = d3.max(vals);
    svg.append('rect').attr('x', x(lo)).attr('y', 7).attr('width', Math.max(2, x(hi) - x(lo))).attr('height', 8).attr('rx', 4)
      .style('fill', tone).style('opacity', 0.55);
    names.forEach((n, i) => {
      const on = n === m.sel;
      const g = svg.append('g');
      g.append('circle').attr('cx', x(vals[i])).attr('cy', 11).attr('r', on ? 7 : 4).style('fill', on ? tone : 'var(--color-panel)')
        .style('stroke', tone).style('stroke-width', 1.5);
      g.on('pointermove', (event) => t.show(event, `${measure} · ${n} case`, [[null, 'Value', ts.money(vals[i])]]))
        .on('pointerleave', () => t.hide());
    });
    const loName = names[vals.indexOf(lo)];
    const hiName = names[vals.indexOf(hi)];
    svg.append('text').attr('x', 0).attr('y', 33).attr('class', 'ts-tick').text(`${loName} ${ts.money(lo)}`);
    svg.append('text').attr('x', W).attr('y', 33).attr('text-anchor', 'end').attr('class', 'ts-tick').text(`${hiName} ${ts.money(hi)}`);
  });

  // ---- Column histogram, shared by the simulation and revenue charts --------------------

  function columns(el, svg, t, bins, x, y, H, padB, isOn, label, name, W) {
    const g = svg.append('g');
    const color = accent();
    for (const b of bins) {
      const x0 = x(b.x0) + 1;
      const w = Math.max(1, x(b.x1) - x(b.x0) - 3);
      const h = y(0) - y(b.length);
      if (h <= 0) continue;
      const on = isOn(b);
      const box = bar(g, x0, y(b.length), w, h, on ? color : 'var(--cds-chart-muted)', on ? 1 : 0.7);
      box.classed('ts-mark', true)
        .on('pointermove', (event) => t.show(event, label(b), [[null, name, ts.count(b.length)], [null, 'Share', `${((b.length / d3.sum(bins, (q) => q.length)) * 100).toFixed(1)}%`]]))
        .on('pointerleave', () => t.hide());
    }
    spotlight(g.selectAll('.ts-mark'), svg);
    reveal(svg, name + label.name, W, H, 'floor');
  }

  // ---- Monte Carlo distribution of SOM -----------------------------------------------------

  dash.draw('montecarlo', (el) => {
    const m = begin(el);
    if (!m) return;
    if (!m.mc) { emptyLine(el, 'Needs Low, Base and High cases and at least one company.'); return; }
    const { draws, p10, p50, p90 } = m.mc;
    const W = Math.max(280, el.clientWidth);
    const H = 250;
    const pad = { t: 34, r: 12, b: 26, l: 36 };
    legend(el, [[accent(), 'P10 to P90'], ['var(--cds-chart-muted)', 'Tails'], ['var(--color-fg)', 'Base case', null, true]]);
    const svg = svgIn(el, W, H, 'Distribution of simulated SOM');
    const t = tip(el);
    const lo = draws[0];
    const hi = draws[draws.length - 1];
    const x = d3.scaleLinear([lo, hi === lo ? lo + 1 : hi], [pad.l, W - pad.r]).nice();
    const bins = d3.bin().domain(x.domain()).thresholds(x.ticks(Math.min(36, Math.floor(W / 12))))(draws);
    const y = d3.scaleLinear([0, d3.max(bins, (b) => b.length) || 1], [H - pad.b, pad.t]).nice();
    gridY(svg, y, pad.l, W - pad.r, y.ticks(4));
    for (const v of y.ticks(4)) {
      svg.append('text').attr('x', pad.l - 6).attr('y', y(v) + 4).attr('text-anchor', 'end').attr('class', 'ts-tick')
        .text(`${((v / draws.length) * 100).toFixed(0)}%`);
    }
    const label = (b) => `${ts.money(b.x0)} to ${ts.money(b.x1)}`;
    columns(el, svg, t, bins, x, y, H, pad.b, (b) => b.x1 > p10 && b.x0 < p90, label, 'Draws', W);
    const ax = svg.append('g').attr('transform', `translate(0,${H - pad.b})`)
      .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(W / 110))).tickFormat(ts.money).tickSize(0).tickPadding(8));
    ax.attr('font-size', null).attr('font-family', null).select('.domain').remove();
    ax.selectAll('text').attr('class', 'ts-tick');
    let lastX = -Infinity;
    for (const [v, name] of [[p10, 'P10'], [p50, 'P50'], [p90, 'P90']]) {
      svg.append('line').attr('x1', x(v)).attr('x2', x(v)).attr('y1', pad.t - 8).attr('y2', H - pad.b)
        .style('stroke', 'var(--cds-chart-reference)').style('stroke-dasharray', '2 3');
      const tx = Math.min(Math.max(x(v), lastX + 70), W - 34);
      lastX = tx;
      svg.append('text').attr('x', tx).attr('y', pad.t - 14).attr('text-anchor', 'middle').attr('class', 'ts-tick ts-strong')
        .text(`${name} ${ts.money(v)}`);
    }
    svg.append('line').attr('x1', x(m.mc.base)).attr('x2', x(m.mc.base)).attr('y1', pad.t).attr('y2', H - pad.b)
      .style('stroke', 'var(--color-fg)').style('stroke-width', 1.5).style('stroke-dasharray', '5 3');
  });

  // ---- Sensitivity tornado --------------------------------------------------------

  dash.draw('tornado', (el) => {
    const m = begin(el);
    if (!m) return;
    if (!m.sens.length || !m.results.Base.tamN) { emptyLine(el, 'Needs Low, Base and High cases and at least one company.'); return; }
    const W = Math.max(280, el.clientWidth);
    const base = m.results.Base.SOM;
    const lowC = BRAND.navy;
    const highC = accent();
    legend(el, [[lowC, 'Driver at Low'], [highC, 'Driver at High']]);
    const rowH = 50;
    const top = 30;
    const H = top + m.sens.length * rowH + 4;
    const svg = svgIn(el, W, H, 'Base SOM when each driver moves to its Low or High value');
    const t = tip(el);
    const names = svg.append('g').selectAll('text').data(m.sens).join('text')
      .attr('class', 'ts-small').text((d) => d.label);
    const left = Math.min(widest(names) + 18, W * 0.4);
    names.attr('x', 0).attr('y', (d, i) => top + i * rowH + 22);
    const all = m.sens.flatMap((q) => [q.low, q.high]).concat(base);
    const lo = d3.min(all);
    const hi = d3.max(all);
    const span = hi - lo || base * 0.5 || 1;
    const x = d3.scaleLinear([Math.max(0, lo - span * 0.32), hi + span * 0.32], [left, W - 12]);
    const g = svg.append('g');
    m.sens.forEach((q, i) => {
      const y = top + i * rowH + 6;
      g.append('rect').attr('x', left).attr('y', y - 4).attr('width', W - 12 - left).attr('height', 30).attr('rx', 4)
        .style('fill', 'var(--cds-chart-grid)').style('opacity', i % 2 ? 0 : 0.3);
      const row = g.append('g').attr('class', 'ts-mark');
      for (const [v, color] of [[q.low, lowC], [q.high, highC]]) {
        const x0 = Math.min(x(v), x(base));
        const w = Math.abs(x(v) - x(base));
        if (w > 0) bar(row, x0, y + 2, w, 18, color);
        if (w > 0) {
          const right = v > base;
          row.append('text').attr('x', right ? x(v) + 6 : x(v) - 6).attr('y', y + 15)
            .attr('text-anchor', right ? 'start' : 'end').attr('class', 'ts-tick ts-strong').text(ts.money(v));
        }
      }
      if (!q.swing) row.append('text').attr('class', 'ts-tick').attr('x', x(base) + 8).attr('y', y + 15).text('no effect at these values');
      row.on('pointermove', (event) => t.show(event, q.label, [[lowC, 'At Low', ts.money(q.low)], [highC, 'At High', ts.money(q.high)], [null, 'Swing', ts.money(q.swing)]]))
        .on('pointerleave', () => t.hide());
    });
    spotlight(g.selectAll('.ts-mark'), svg);
    svg.append('line').attr('x1', x(base)).attr('x2', x(base)).attr('y1', top - 8).attr('y2', H)
      .style('stroke', 'var(--color-fg)').style('stroke-width', 1.25);
    svg.append('text').attr('x', x(base)).attr('y', top - 14).attr('text-anchor', 'middle')
      .attr('class', 'ts-tick ts-strong').text(`Base ${ts.money(base)}`);
    reveal(svg, 'tornado', W, H, 'left');
  });

  // ---- Breakdown by segment, stacked bars; a click focuses the dashboard ----------------

  dash.draw('breakdown', (el) => {
    const m = begin(el);
    if (!m) return;
    if (!m.breakUnits.length) { emptyLine(el, 'No companies match these choices.'); return; }
    const W = Math.max(280, el.clientWidth);
    const params = dash.params();
    const byTam = params.measure === 'tam';
    const stack = params.stack === 'country' ? 'country' : 'tier';
    const c = m.cases[m.sel];
    const keys = stack === 'tier' ? m.tierNames : m.countries;
    const fill = (i) => (stack === 'tier' ? accent() : SERIES[i % SERIES.length]);
    const opacity = (i) => (stack === 'tier' ? TIER_OPACITY[i] ?? 0.25 : 1);
    const fmt = byTam ? ts.money : ts.count;
    const rows = m.segs.map((segment) => {
      const parts = keys.map((k) => d3.sum(m.breakUnits.filter((u) => u.segment === segment && u[stack] === k),
        (u) => (byTam ? u.n * m.acvFor(u, c) : u.n)));
      return { segment, parts, total: d3.sum(parts) };
    }).sort((a, b) => b.total - a.total);
    const grand = d3.sum(rows, (r) => r.total);

    legend(el, keys.map((k, i) => [fill(i), k, opacity(i)]));
    const rowH = 50;
    const H = rows.length * rowH + 4;
    const svg = svgIn(el, W, H, `${byTam ? 'TAM' : 'Companies'} by segment, split by ${stack}`);
    const t = tip(el);
    const x = d3.scaleLinear([0, d3.max(rows, (r) => r.total) || 1], [0, W - 12]);
    const g = svg.append('g');
    rows.forEach((r, i) => {
      const y = i * rowH + 4;
      const row = g.append('g').attr('class', 'ts-mark ts-clickable')
        .classed('is-faded', Boolean(m.focus && m.focus !== r.segment));
      row.append('rect').attr('x', 0).attr('y', y - 4).attr('width', W).attr('height', rowH - 4).style('fill', 'transparent');
      row.append('text').attr('x', 0).attr('y', y + 12).attr('class', 'ts-small ts-strong').text(r.segment);
      row.append('text').attr('x', W).attr('y', y + 12).attr('text-anchor', 'end').attr('class', 'ts-tick')
        .text(`${fmt(r.total)} · ${grand ? Math.round((r.total / grand) * 100) : 0}%`);
      row.append('rect').attr('x', 0).attr('y', y + 22).attr('width', W - 12).attr('height', 14).attr('rx', 2)
        .style('fill', 'var(--cds-chart-grid)').style('opacity', 0.4);
      let at = 0;
      r.parts.forEach((v, j) => {
        if (!v) return;
        const w = Math.max(1.5, x(v));
        bar(row, at, y + 22, Math.max(1, w - 1.5), 14, fill(j), opacity(j));
        at += w;
      });
      row.on('pointermove', (event) => t.show(event, r.segment, keys.map((k, q) => [fill(q), k, fmt(r.parts[q]), opacity(q)])
        .filter((_, q) => r.parts[q]).concat([[null, 'Total', fmt(r.total)], [null, 'Click to', m.focus === r.segment ? 'clear focus' : 'focus']])))
        .on('pointerleave', () => t.hide())
        .on('click', () => dash.setParams({ focus: m.focus === r.segment ? null : r.segment }));
    });
    spotlight(g.selectAll('.ts-mark'), svg);
    reveal(svg, 'breakdown', W, H, 'left');
  });

  // ---- Revenue distribution, log scale, with tier thresholds --------------------

  dash.draw('revenue', (el) => {
    const m = begin(el);
    if (!m) return;
    const revs = m.pool.map((c) => c.revenue_usd_m).filter((v) => v > 0);
    if (!revs.length) { emptyLine(el, 'No companies in the chosen segments and countries.'); return; }
    const W = Math.max(280, el.clientWidth);
    const H = 250;
    const pad = { t: 38, r: 12, b: 26, l: 30 };
    legend(el, [[accent(), 'In revenue range'], ['var(--cds-chart-muted)', 'Outside range'], ['var(--cds-chart-reference)', 'Tier threshold', null, true]]);
    const svg = svgIn(el, W, H, 'Companies by revenue, log scale');
    const t = tip(el);
    const x = d3.scaleLog([Math.max(1, d3.min(revs) * 0.9), d3.max(revs) * 1.1], [pad.l, W - pad.r]);
    const [a, b] = x.domain().map(Math.log10);
    const thresholds = d3.range(a, b, (b - a) / Math.min(30, Math.floor(W / 15))).map((v) => 10 ** v);
    const bins = d3.bin().domain(x.domain()).thresholds(thresholds)(revs);
    const y = d3.scaleLinear([0, d3.max(bins, (q) => q.length) || 1], [H - pad.b, pad.t]).nice();
    gridY(svg, y, pad.l, W - pad.r, y.ticks(4));
    for (const v of y.ticks(4)) {
      svg.append('text').attr('x', pad.l - 6).attr('y', y(v) + 4).attr('text-anchor', 'end').attr('class', 'ts-tick').text(ts.count(v));
    }
    const lo = Math.max(m.revMin, x.domain()[0]);
    const hi = Math.min(m.revMax, x.domain()[1]);
    if (hi > lo) {
      svg.append('rect').attr('x', x(lo)).attr('y', pad.t - 10).attr('width', x(hi) - x(lo)).attr('height', H - pad.b - pad.t + 10)
        .attr('rx', 4).style('fill', accent()).style('opacity', 0.07);
    }
    const label = (q) => `US$${q.x0.toFixed(0)}M to ${q.x1.toFixed(0)}M`;
    columns(el, svg, t, bins, x, y, H, pad.b, (q) => q.x1 > m.revMin && q.x0 < m.revMax, label, 'Companies', W);
    const ax = svg.append('g').attr('transform', `translate(0,${H - pad.b})`)
      .call(d3.axisBottom(x).tickValues([10, 30, 100, 300, 1000, 3000].filter((v) => v >= x.domain()[0] && v <= x.domain()[1]))
        .tickFormat((v) => `$${v >= 1000 ? `${v / 1000}B` : `${v}M`}`).tickSize(0).tickPadding(8));
    ax.attr('font-size', null).attr('font-family', null).select('.domain').remove();
    ax.selectAll('text').attr('class', 'ts-tick');
    let lastX = Infinity;
    for (const tl of [...m.tierLines].sort((p, q) => q.usd_m - p.usd_m)) {
      if (tl.usd_m < x.domain()[0] || tl.usd_m > x.domain()[1]) continue;
      const px = x(tl.usd_m);
      svg.append('line').attr('x1', px).attr('x2', px).attr('y1', pad.t - 16).attr('y2', H - pad.b)
        .style('stroke', 'var(--cds-chart-reference)').style('stroke-dasharray', '3 3');
      if (lastX - px > 46) {
        svg.append('text').attr('x', px + 4).attr('y', pad.t - 20).attr('class', 'ts-tick ts-strong').text(tl.name);
        lastX = px;
      }
    }
  });

  // ---- ICP funnel: companies left after each attribute ---------------------------------

  dash.draw('icp-funnel', (el) => {
    const m = begin(el);
    if (!m) return;
    const steps = m.icp.steps;
    if (!steps[0].confirmed) { emptyLine(el, 'No companies match these choices.'); return; }
    const W = Math.max(280, el.clientWidth);
    legend(el, [[BRAND.blue, 'Confirmed by answers'], [BRAND.blue, 'Expected, using assumed shares', 0.3]]);
    const rowH = 46;
    const H = steps.length * rowH + 4;
    const svg = svgIn(el, W, H, 'Companies left after each ICP attribute');
    const t = tip(el);
    const x = d3.scaleLinear([0, steps[0].expected || 1], [0, W - 12]);
    const g = svg.append('g');
    steps.forEach((st, i) => {
      const y = i * rowH + 4;
      const last = i === steps.length - 1;
      const color = last ? BRAND.green : BRAND.blue;
      const row = g.append('g').attr('class', 'ts-mark');
      row.append('rect').attr('x', 0).attr('y', y - 4).attr('width', W).attr('height', rowH - 4).style('fill', 'transparent');
      row.append('text').attr('x', 0).attr('y', y + 12).attr('class', `ts-small${last || !i ? ' ts-strong' : ''}`)
        .text(i ? `${i === 1 ? '' : '+ '}${st.label}` : st.label);
      const pctOf = steps[0].expected ? Math.round((st.expected / steps[0].expected) * 100) : 0;
      row.append('text').attr('x', W).attr('y', y + 12).attr('text-anchor', 'end').attr('class', 'ts-tick')
        .text(i ? `≈${ts.count(st.expected)} · ${pctOf}%` : ts.count(st.expected));
      row.append('rect').attr('x', 0).attr('y', y + 20).attr('width', W - 12).attr('height', 14).attr('rx', 2)
        .style('fill', 'var(--cds-chart-grid)').style('opacity', 0.4);
      if (st.expected > 0) bar(row, 0, y + 20, Math.max(1.5, x(st.expected)), 14, color, 0.3);
      if (st.confirmed > 0) bar(row, 0, y + 20, Math.max(1.5, x(st.confirmed)), 14, color, 1);
      const lines = [[color, 'Confirmed', ts.count(st.confirmed)], [color, 'Expected', ts.count(st.expected), 0.3]];
      if (i && !st.data) {
        lines.push([null, 'Answered yes / no', `${ts.count(st.yes)} / ${ts.count(st.no)}`]);
        lines.push([null, 'Assumed share if unanswered', ts.pct(st.share)]);
      }
      row.on('pointermove', (event) => t.show(event, i ? st.label : 'Companies in scope', lines))
        .on('pointerleave', () => t.hide());
    });
    spotlight(g.selectAll('.ts-mark'), svg);
    reveal(svg, 'icp-funnel', W, H, 'left');
  });

  dash.draw('icp-file', (el) => {
    const m = ts.model();
    if (m.status !== 'ok') { el.textContent = '—'; return; }
    const f = m.icp.file;
    if (f) {
      el.textContent = f.columns
        ? `${f.name}: answers for ${ts.count(f.matched)} of ${ts.count(m.chosen.length)} companies in scope`
        : `${f.name}: no ICP columns found`;
    } else if (m.icp.answered) el.textContent = `Saved screen: answers for ${ts.count(m.icp.answered)} companies`;
    else el.textContent = 'No answers loaded yet, so every company uses the assumed shares';
  });

  // ---- Company table -----------------------------------------------------------------------

  window.tsTable = window.tsTable || { q: '', key: 'priority', dir: -1, only: 'all' };

  function tableRows(m) {
    const { q, key, dir, only } = window.tsTable;
    const needle = q.trim().toLowerCase();
    return m.chosen
      .filter((c) => !needle || `${c.company} ${c.segment} ${c.country}`.toLowerCase().includes(needle))
      .filter((c) => only === 'all' || (only === 'match' ? c.icp.status === 'match' : c.icp.status !== 'out'))
      .sort((a, b) => (typeof a[key] === 'number' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]))) * dir
        || b.revenue_usd_m - a.revenue_usd_m);
  }

  dash.draw('company-rows', (el) => {
    const m = ts.model();
    el.replaceChildren();
    if (m.status !== 'ok') return;
    const max = d3.max(m.chosen, (c) => c.revenue_usd_m) || 1;
    for (const c of tableRows(m)) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-key', `${encodeURIComponent(c.company)},${encodeURIComponent(String(c.revenue_usd_m))}`);
      const fit = document.createElement('td');
      fit.className = 'ts-icp-cell';
      const dots = document.createElement('span');
      dots.className = 'ts-icp-dots';
      for (const a of m.icp.attrs) {
        const v = c.icp.ans[a.key];
        const dot = document.createElement('span');
        dot.className = `ts-icp-dot ${v === true ? 'is-yes' : v === false ? 'is-no' : 'is-unknown'}`;
        dot.title = `${a.label}: ${v === true ? 'yes' : v === false ? 'no' : `unanswered, assumed ${ts.pct(a.share)}`}`;
        dots.append(dot);
      }
      const word = document.createElement('span');
      word.className = `ts-icp-word is-${c.icp.status}`;
      word.textContent = c.icp.status === 'match' ? 'Match' : c.icp.status === 'out' ? 'Out' : `${Math.round(c.icp.chance * 100)}%`;
      fit.setAttribute('aria-label', `${c.icp.yes} of ${m.icp.attrs.length} ICP attributes confirmed; ${word.textContent}`);
      fit.append(dots, word);
      for (const [v, cls] of [[c.company, ''], [null, 'icp'], [c.segment, 'ts-hide-narrow'], [String(c.revenue_usd_m), 'ts-num ts-bar-cell'], [c.country, 'ts-hide-narrow']]) {
        if (cls === 'icp') { tr.append(fit); continue; }
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.textContent = v;
        if (cls.includes('ts-bar-cell')) {
          td.style.setProperty('--w', `${(c.revenue_usd_m / max) * 100}%`);
          td.style.setProperty('--c', accent());
        }
        tr.append(td);
      }
      el.append(tr);
    }
  });

  dash.draw('rows-n', (el) => {
    const m = ts.model();
    if (m.status !== 'ok') { el.textContent = '—'; return; }
    const shown = tableRows(m).length;
    el.textContent = shown === m.chosen.length ? ts.count(shown) : `${ts.count(shown)} of ${ts.count(m.chosen.length)}`;
  });
})();
