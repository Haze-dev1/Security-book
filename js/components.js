/* Interactive components rendered from fenced code blocks.
   Each renderer receives (container, spec, ctx) where spec is parsed JSON (or raw text). */
window.Components = (function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Minimal inline markdown (code, bold, italics) for labels inside components.
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const md = (s) => (window.renderInlineMarkdown ? window.renderInlineMarkdown(s) : `<p>${inline(s)}</p>`);

  function wrap(container, kind, title) {
    container.className = 'cmp ' + kind;
    container.innerHTML = `<div class="cmp-head"><span class="kind">${esc(kind)}</span><span>${inline(title || '')}</span></div>`;
    return container;
  }

  /* ---------- Architecture diagram ----------
     spec: { title, nodes:[{id,label,sub,kind,desc,col,row}], edges:[{from,to,label,desc,dashed}], zones:[{label,nodes:[ids]}], legend:true }
     Layout: if nodes have col/row use them; otherwise longest-path layering left→right. */
  function diagram(container, spec) {
    wrap(container, 'diagram', spec.title);
    const nodes = spec.nodes.map((n, i) => ({ ...n, i }));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const edges = (spec.edges || []).filter((e) => byId[e.from] && byId[e.to]);
    // layering
    if (!nodes.every((n) => n.col != null)) {
      const indeg = {}; nodes.forEach((n) => (indeg[n.id] = 0));
      edges.forEach((e) => { if (e.from !== e.to) indeg[e.to]++; });
      const layer = {}; nodes.forEach((n) => (layer[n.id] = 0));
      // longest path via repeated relaxation (graphs are tiny)
      for (let k = 0; k < nodes.length; k++) edges.forEach((e) => { if (e.from !== e.to && !e.back && layer[e.to] < layer[e.from] + 1) layer[e.to] = layer[e.from] + 1; });
      const rows = {};
      nodes.forEach((n) => { n.col = layer[n.id]; n.row = rows[n.col] = (rows[n.col] ?? -1) + 1; });
    }
    const W = 150, H = 54, GX = 96, GY = 26, PAD = 24;
    const cols = Math.max(...nodes.map((n) => n.col)) + 1;
    const rowsPerCol = {}; nodes.forEach((n) => (rowsPerCol[n.col] = Math.max(rowsPerCol[n.col] || 0, n.row + 1)));
    const maxRows = Math.max(...Object.values(rowsPerCol));
    const totalH = maxRows * H + (maxRows - 1) * GY;
    nodes.forEach((n) => {
      const colH = rowsPerCol[n.col] * H + (rowsPerCol[n.col] - 1) * GY;
      n.x = PAD + n.col * (W + GX); n.y = PAD + (totalH - colH) / 2 + n.row * (H + GY);
      if (n.dy) n.y += n.dy;
    });
    const svgW = PAD * 2 + cols * W + (cols - 1) * GX, svgH = PAD * 2 + totalH + (spec.zones ? 18 : 0);
    const defs = `<defs><marker id="arr-${container.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;
    let zones = '';
    (spec.zones || []).forEach((z) => {
      const zn = z.nodes.map((id) => byId[id]).filter(Boolean); if (!zn.length) return;
      const x0 = Math.min(...zn.map((n) => n.x)) - 10, y0 = Math.min(...zn.map((n) => n.y)) - 22;
      const x1 = Math.max(...zn.map((n) => n.x + W)) + 10, y1 = Math.max(...zn.map((n) => n.y + H)) + 10;
      zones += `<g class="zone"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/><text x="${x0 + 10}" y="${y0 + 14}">${esc(z.label)}</text></g>`;
    });
    let edgesSvg = '';
    edges.forEach((e, idx) => {
      const a = byId[e.from], b = byId[e.to];
      let x1, y1, x2, y2;
      if (a.col < b.col) { x1 = a.x + W; y1 = a.y + H / 2; x2 = b.x; y2 = b.y + H / 2; }
      else if (a.col > b.col) { x1 = a.x; y1 = a.y + H / 2; x2 = b.x + W; y2 = b.y + H / 2; }
      else if (a.y < b.y) { x1 = a.x + W / 2; y1 = a.y + H; x2 = b.x + W / 2; y2 = b.y; }
      else { x1 = a.x + W / 2; y1 = a.y; x2 = b.x + W / 2; y2 = b.y + H; }
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const d = a.col === b.col ? `M${x1} ${y1}L${x2} ${y2}` : `M${x1} ${y1}C${mx} ${y1},${mx} ${y2},${x2} ${y2}`;
      const lbl = e.label ? `<text x="${mx}" y="${my - 6 + (e.ly || 0)}" text-anchor="middle">${esc(e.label)}</text>` : '';
      edgesSvg += `<g class="edge" data-i="${idx}" style="color:var(--fg-faint)"><path d="${d}" ${e.dashed ? 'stroke-dasharray="5 4"' : ''} marker-end="url(#arr-${container.id})"/>${lbl}</g>`;
    });
    let nodesSvg = '';
    nodes.forEach((n) => {
      const sub = n.sub ? `<text class="sub" x="${n.x + W / 2}" y="${n.y + H / 2 + 14}" text-anchor="middle">${esc(n.sub)}</text>` : '';
      nodesSvg += `<g class="node k-${esc(n.kind || 'app')}" data-id="${esc(n.id)}" tabindex="0" role="button"><rect x="${n.x}" y="${n.y}" width="${W}" height="${H}"/><text x="${n.x + W / 2}" y="${n.y + H / 2 + (n.sub ? -2 : 4)}" text-anchor="middle" font-weight="600">${esc(n.label)}</text>${sub}</g>`;
    });
    const legend = spec.legend === false ? '' : `<div class="diagram-legend"><span><i style="border-color:var(--purple)"></i>client</span><span><i style="border-color:var(--info)"></i>edge / network</span><span><i style="border-color:var(--accent)"></i>application</span><span><i style="border-color:var(--ok)"></i>data</span><span><i style="border-color:var(--warn);border-style:dashed"></i>external / managed</span><span>Click a node or edge for details.</span></div>`;
    container.insertAdjacentHTML('beforeend', `<div class="cmp-body" style="padding:6px"><svg viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="${esc(spec.title || 'Architecture diagram')}">${defs}${zones}${edgesSvg}${nodesSvg}</svg></div><div class="diagram-info">${spec.intro ? inline(spec.intro) : 'Click a component to learn what it does and why it is there.'}</div>${legend}`);
    const info = container.querySelector('.diagram-info');
    const svg = container.querySelector('svg');
    function selectNode(id) {
      svg.querySelectorAll('.node').forEach((g) => g.classList.toggle('sel', g.dataset.id === id));
      svg.querySelectorAll('.edge').forEach((g) => { const e = edges[g.dataset.i]; g.classList.toggle('hl', e.from === id || e.to === id); });
      const n = byId[id];
      const conn = edges.filter((e) => e.from === id || e.to === id).map((e) => e.from === id ? `→ ${byId[e.to].label}${e.label ? ` (${e.label})` : ''}` : `← ${byId[e.from].label}${e.label ? ` (${e.label})` : ''}`);
      info.innerHTML = `<b>${esc(n.label)}</b>${n.sub ? ` <span style="color:var(--fg-faint)">· ${esc(n.sub)}</span>` : ''}<br>${inline(n.desc || 'No description.')}${conn.length ? `<div style="margin-top:6px;font-size:12.5px;color:var(--fg-faint)">${conn.map(esc).join(' &nbsp; ')}</div>` : ''}`;
    }
    svg.querySelectorAll('.node').forEach((g) => {
      g.addEventListener('click', () => selectNode(g.dataset.id));
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectNode(g.dataset.id); } });
    });
    svg.querySelectorAll('.edge').forEach((g) => {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => {
        const e = edges[g.dataset.i];
        svg.querySelectorAll('.edge').forEach((x) => x.classList.toggle('hl', x === g));
        svg.querySelectorAll('.node').forEach((x) => x.classList.toggle('sel', x.dataset.id === e.from || x.dataset.id === e.to));
        info.innerHTML = `<b>${esc(byId[e.from].label)} → ${esc(byId[e.to].label)}</b>${e.label ? ` <span style="color:var(--fg-faint)">· ${esc(e.label)}</span>` : ''}<br>${inline(e.desc || 'Connection between these components.')}`;
      });
    });
  }

  /* ---------- Flow: sequence diagram with step-through ----------
     spec: { title, actors:[{id,label}], steps:[{from,to,label,title,detail,note}] } */
  function flow(container, spec) {
    wrap(container, 'flow', spec.title);
    const actors = spec.actors; const steps = spec.steps;
    const AW = 118, AH = 36, GAP = 40, TOP = 14, STEP_H = 34, PAD = 16;
    const idx = Object.fromEntries(actors.map((a, i) => [a.id, i]));
    const cx = (i) => PAD + i * (AW + GAP) + AW / 2;
    const svgW = PAD * 2 + actors.length * AW + (actors.length - 1) * GAP;
    const svgH = TOP + AH + 16 + steps.length * STEP_H + 20;
    let s = `<defs><marker id="farr-${container.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;
    actors.forEach((a, i) => {
      s += `<g class="actor"><rect x="${cx(i) - AW / 2}" y="${TOP}" width="${AW}" height="${AH}"/><text x="${cx(i)}" y="${TOP + AH / 2 + 4}" text-anchor="middle">${esc(a.label)}</text></g>`;
      s += `<line class="lifeline" x1="${cx(i)}" y1="${TOP + AH}" x2="${cx(i)}" y2="${svgH - 10}"/>`;
    });
    steps.forEach((st, k) => {
      const y = TOP + AH + 26 + k * STEP_H;
      const a = idx[st.from], b = idx[st.to];
      let path, tx, anchor = 'middle';
      if (a === b) { const x = cx(a); path = `M${x} ${y - 8}H${x + 34}V${y + 8}H${x + 2}`; tx = x + 40; anchor = 'start'; }
      else { const x1 = cx(a), x2 = cx(b); const dir = x2 > x1 ? -1 : 1; path = `M${x1} ${y}L${x2 + dir * 2} ${y}`; tx = (x1 + x2) / 2; }
      s += `<g class="msg" data-k="${k}" style="color:var(--fg-faint);cursor:pointer"><path d="${path}" marker-end="url(#farr-${container.id})" ${st.dashed ? 'stroke-dasharray="4 3"' : ''}/><circle class="dot" cx="${cx(a)}" cy="${y}" r="3" fill="var(--fg-faint)"/><text x="${tx}" y="${y - 5}" text-anchor="${anchor}">${esc(k + 1)}. ${esc(st.label)}</text></g>`;
    });
    container.insertAdjacentHTML('beforeend', `
      <div class="flow-controls"><button data-a="first" title="First step">⏮</button><button data-a="prev">← Prev</button><button data-a="next">Next →</button><button data-a="play">▶ Play</button><span class="counter"></span></div>
      <div class="cmp-body" style="padding:6px 6px 0"><svg viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="${esc(spec.title || 'Request flow')}">${s}</svg></div>
      <div class="flow-steps"></div>
      <div class="flow-detail"></div>`);
    const detail = container.querySelector('.flow-detail'), counter = container.querySelector('.counter'), stepsBar = container.querySelector('.flow-steps');
    stepsBar.innerHTML = steps.map((_, k) => `<button data-k="${k}" title="Step ${k + 1}">${k + 1}</button>`).join('');
    let cur = -1, timer = null;
    function render() {
      container.querySelectorAll('.msg').forEach((g) => { const k = +g.dataset.k; g.classList.toggle('cur', k === cur); g.classList.toggle('done', k < cur); });
      stepsBar.querySelectorAll('button').forEach((b) => { const k = +b.dataset.k; b.classList.toggle('cur', k === cur); b.classList.toggle('done', k < cur); });
      counter.textContent = cur < 0 ? `0 / ${steps.length}` : `${cur + 1} / ${steps.length}`;
      if (cur < 0) detail.innerHTML = `<div class="fd-title">${inline(spec.intro || 'Press Next to step through the flow.')}</div>`;
      else { const st = steps[cur]; detail.innerHTML = `<div class="fd-step">Step ${cur + 1} · ${esc(actors[idx[st.from]].label)} → ${esc(actors[idx[st.to]].label)}</div><div class="fd-title">${inline(st.title || st.label)}</div>${md(st.detail || '')}${st.note ? `<div class="callout note" style="margin:10px 0 0;padding:8px 12px"><div class="callout-title">Why it matters</div>${md(st.note)}</div>` : ''}`; }
      container.querySelector('[data-a=prev]').disabled = cur <= 0; container.querySelector('[data-a=next]').disabled = cur >= steps.length - 1;
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; container.querySelector('[data-a=play]').textContent = '▶ Play'; } }
    container.querySelector('.flow-controls').addEventListener('click', (ev) => {
      const a = ev.target.closest('button')?.dataset.a; if (!a) return;
      if (a === 'first') { stop(); cur = 0; } else if (a === 'prev') { stop(); cur = Math.max(0, cur - 1); } else if (a === 'next') { stop(); cur = Math.min(steps.length - 1, cur + 1); }
      else if (a === 'play') { if (timer) stop(); else { if (cur >= steps.length - 1) cur = -1; ev.target.textContent = '⏸ Pause'; timer = setInterval(() => { if (cur >= steps.length - 1) stop(); else { cur++; render(); } }, 2200); cur++; } }
      render();
    });
    stepsBar.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { stop(); cur = +b.dataset.k; render(); } });
    container.querySelectorAll('.msg').forEach((g) => g.addEventListener('click', () => { stop(); cur = +g.dataset.k; render(); }));
    render();
  }

  /* ---------- Layers: clickable stack (e.g., OSI model, packet encapsulation) ----------
     spec: { title, layers:[{name, sub, summary, more, examples}] } */
  function layers(container, spec) {
    wrap(container, 'layers', spec.title);
    const body = document.createElement('div'); body.className = 'cmp-body layers';
    body.innerHTML = spec.layers.map((l, i) => `<div class="layer" data-i="${i}" tabindex="0"><div class="l-name">${esc(l.name)}${l.sub ? `<small>${esc(l.sub)}</small>` : ''}</div><div class="l-body">${inline(l.summary)}${l.examples ? `<div class="l-ex">${esc(l.examples)}</div>` : ''}<div class="l-more">${md(l.more || '')}</div></div></div>`).join('');
    container.appendChild(body);
    body.querySelectorAll('.layer').forEach((el) => {
      const toggle = () => el.classList.toggle('open');
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
  }

  /* ---------- Quiz ---------- spec: { title, questions:[{q, options:[], answer:index|[indices], explain}] } */
  function quiz(container, spec, ctx) {
    wrap(container, 'quiz', spec.title || 'Check your understanding');
    const letters = 'ABCDEFGH';
    const key = `peh:quiz:${ctx.chapterId}:${ctx.index}`;
    let state = {}; try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
    const body = document.createElement('div');
    body.innerHTML = spec.questions.map((q, qi) => `<div class="q" data-qi="${qi}"><div class="q-text"><span class="q-num">Q${qi + 1}</span>${inline(q.q)}</div>${q.options.map((o, oi) => `<div class="opt" data-oi="${oi}" role="button" tabindex="0"><span class="ltr">${letters[oi]}</span><span>${inline(o)}</span></div>`).join('')}<div class="explain" hidden></div></div>`).join('') + `<div class="score"><span class="score-text">Answer the questions to see your score.</span><button class="sm reset">Reset</button></div>`;
    container.appendChild(body);
    const total = spec.questions.length;
    function paint(qi) {
      const q = spec.questions[qi], el = body.querySelector(`.q[data-qi="${qi}"]`); const chosen = state[qi]; if (chosen == null) return;
      el.classList.add('answered');
      const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
      el.querySelectorAll('.opt').forEach((o) => { const oi = +o.dataset.oi; if (answers.includes(oi)) o.classList.add('correct'); else if (oi === chosen) o.classList.add('wrong'); });
      const ok = answers.includes(chosen);
      const ex = el.querySelector('.explain'); ex.hidden = false; ex.innerHTML = `<b>${ok ? 'Correct.' : 'Not quite.'}</b> ${inline(q.explain || '')}`;
    }
    function score() {
      const answered = Object.keys(state).length; let correct = 0;
      Object.entries(state).forEach(([qi, c]) => { const a = spec.questions[qi].answer; if ((Array.isArray(a) ? a : [a]).includes(c)) correct++; });
      body.querySelector('.score-text').textContent = answered ? `Score: ${correct} / ${total}${answered < total ? ` (${total - answered} unanswered)` : correct === total ? ' — excellent.' : ''}` : 'Answer the questions to see your score.';
    }
    Object.keys(state).forEach((qi) => paint(+qi)); score();
    body.addEventListener('click', (ev) => {
      if (ev.target.closest('.reset')) { state = {}; localStorage.removeItem(key); body.querySelectorAll('.q').forEach((q) => { q.classList.remove('answered'); q.querySelectorAll('.opt').forEach((o) => o.classList.remove('correct', 'wrong')); q.querySelector('.explain').hidden = true; }); score(); return; }
      const opt = ev.target.closest('.opt'); if (!opt) return; const qEl = opt.closest('.q'); const qi = +qEl.dataset.qi; if (state[qi] != null) return;
      state[qi] = +opt.dataset.oi; try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {}
      paint(qi); score();
    });
    body.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList.contains('opt')) { ev.preventDefault(); ev.target.click(); } });
  }

  /* ---------- Checklist ---------- raw text: lines "- item", "## section" */
  function checklist(container, raw, ctx) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    let title = 'Checklist'; if (lines[0]?.startsWith('# ')) title = lines.shift().slice(2);
    wrap(container, 'checklist', title);
    const key = `peh:check:${ctx.chapterId}:${ctx.index}`;
    let state = {}; try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
    let n = 0; const items = [];
    const html = lines.map((l) => {
      if (l.startsWith('## ')) return `<li class="h">${inline(l.slice(3))}</li>`;
      const text = l.replace(/^[-*]\s+/, ''); const id = `${key}:${n}`; const i = n++; items.push(i);
      return `<li class="${state[i] ? 'checked' : ''}" data-i="${i}"><input type="checkbox" id="${esc(id)}" ${state[i] ? 'checked' : ''}><label for="${esc(id)}">${inline(text)}</label></li>`;
    }).join('');
    container.insertAdjacentHTML('beforeend', `<div class="cmp-body" style="padding:4px 14px"><ul>${html}</ul></div><div class="cl-foot"><span class="cl-count"></span><span><button class="sm cl-reset">Reset</button></span></div>`);
    const count = container.querySelector('.cl-count');
    const upd = () => { const done = items.filter((i) => state[i]).length; count.textContent = `${done} / ${items.length} complete${done === items.length && items.length ? ' ✓' : ''}`; };
    upd();
    container.addEventListener('change', (ev) => { const li = ev.target.closest('li'); if (!li) return; const i = +li.dataset.i; state[i] = ev.target.checked; li.classList.toggle('checked', ev.target.checked); try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {} upd(); });
    container.querySelector('.cl-reset').addEventListener('click', () => { state = {}; localStorage.removeItem(key); container.querySelectorAll('li').forEach((li) => { li.classList.remove('checked'); const c = li.querySelector('input'); if (c) c.checked = false; }); upd(); });
  }

  /* ---------- Troubleshooting scenario ----------
     spec: { title, situation, symptoms:[], steps:[{action, command, output, insight}], rootCause, fix, prevention } */
  function scenario(container, spec) {
    wrap(container, 'scenario', spec.title);
    const hl = (code) => { try { return window.hljs ? hljs.highlight(code, { language: 'bash' }).value : esc(code); } catch (e) { return esc(code); } };
    let html = `<div class="sc-sit">${md(spec.situation)}${spec.symptoms?.length ? `<strong style="font-size:13px">Symptoms</strong><ul class="sc-sym">${spec.symptoms.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}</div><div class="sc-steps"></div><div class="sc-reveal"><button class="sm sc-next">Reveal next diagnostic step</button><span class="hint">Think about what you would check first, then reveal.</span></div><div class="sc-final" hidden><div><b>Root cause</b>${md(spec.rootCause)}</div><div><b>Fix</b>${md(spec.fix)}</div>${spec.prevention ? `<div><b>Prevention</b>${md(spec.prevention)}</div>` : ''}</div>`;
    container.insertAdjacentHTML('beforeend', html);
    const stepsEl = container.querySelector('.sc-steps'), btn = container.querySelector('.sc-next'), hint = container.querySelector('.hint'), fin = container.querySelector('.sc-final');
    let k = 0;
    btn.addEventListener('click', () => {
      if (k < spec.steps.length) {
        const st = spec.steps[k];
        stepsEl.insertAdjacentHTML('beforeend', `<div class="sc-step"><div class="sc-act"><span class="sc-n">${k + 1}</span><span>${inline(st.action)}</span></div>${st.command ? `<pre><code class="hljs">${hl(st.command)}</code></pre>` : ''}${st.output ? `<pre><code>${esc(st.output)}</code></pre>` : ''}${st.insight ? `<div class="sc-insight">${inline(st.insight)}</div>` : ''}</div>`);
        k++; hint.textContent = k < spec.steps.length ? `${spec.steps.length - k} step${spec.steps.length - k === 1 ? '' : 's'} remaining.` : 'All diagnostic steps shown.';
        if (k === spec.steps.length) btn.textContent = 'Reveal root cause and fix';
      } else { fin.hidden = false; btn.disabled = true; hint.textContent = ''; }
    });
  }

  /* ---------- Tabs ---------- raw markdown with "--- Tab Title" separators */
  function tabs(container, raw, ctx) {
    const parts = raw.split(/^---\s+(.+)$/m); // ['', title1, body1, title2, body2...]
    wrap(container, 'tabs', '');
    container.querySelector('.cmp-head').remove();
    const titles = [], bodies = [];
    for (let i = 1; i < parts.length; i += 2) { titles.push(parts[i].trim()); bodies.push(parts[i + 1] || ''); }
    container.innerHTML += `<div class="tab-bar">${titles.map((t, i) => `<button class="${i === 0 ? 'on' : ''}" data-i="${i}">${esc(t)}</button>`).join('')}</div>${bodies.map((b, i) => `<div class="tab-panel ${i === 0 ? 'on' : ''}" data-i="${i}">${window.renderMarkdownFragment ? window.renderMarkdownFragment(b, ctx) : esc(b)}</div>`).join('')}`;
    container.querySelector('.tab-bar').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; container.querySelectorAll('.tab-bar button').forEach((x) => x.classList.toggle('on', x === b)); container.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('on', p.dataset.i === b.dataset.i)); });
  }

  /* ---------- Compare table from JSON (optional convenience) ---------- */
  function compare(container, spec) {
    wrap(container, 'compare', spec.title);
    const rows = spec.rows.map((r) => `<tr>${r.map((c, i) => i === 0 ? `<th style="text-align:left;font-weight:600">${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
    container.insertAdjacentHTML('beforeend', `<div class="cmp-body" style="padding:0"><table style="margin:0;display:table"><thead><tr>${spec.columns.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`);
  }

  return { diagram, flow, layers, quiz, checklist, scenario, tabs, compare, esc, inline };
})();
