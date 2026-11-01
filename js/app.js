/* Production Engineering Handbook — application shell.
   Hash router, navigation, markdown pipeline, search, progress, bookmarks, theme. No build step. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = Components.esc;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('peh:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('peh:' + k, JSON.stringify(v)); } catch (e) {} },
  };
  const state = { curriculum: null, glossary: null, index: null, chapterCache: {}, route: null, current: null };

  /* ---------------- Theme ---------------- */
  function effectiveTheme() { const t = document.documentElement.getAttribute('data-theme'); if (t === 'light' || t === 'dark') return t; return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  function toggleTheme() { const next = effectiveTheme() === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); try { localStorage.setItem('peh:theme', next); } catch (e) {} }

  /* ---------------- Slugs ---------------- */
  const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80);

  /* ---------------- Curriculum helpers ---------------- */
  function flatChapters() { const out = []; state.curriculum.parts.forEach((p) => p.chapters.forEach((c) => out.push({ part: p, chapter: c, id: `${p.id}/${c.id}` }))); return out; }
  function findChapter(pid, cid) { const p = state.curriculum.parts.find((x) => x.id === pid); if (!p) return null; const c = p.chapters.find((x) => x.id === cid); return c ? { part: p, chapter: c, id: `${pid}/${cid}` } : null; }
  function progressOf(id) { return store.get('progress', {})[id] || { pct: 0, done: false }; }
  function setProgress(id, patch) { const all = store.get('progress', {}); all[id] = { ...(all[id] || { pct: 0, done: false }), ...patch, ts: Date.now() }; store.set('progress', all); }
  function bookmarks() { return store.get('bookmarks', []); }
  function isBookmarked(id) { return bookmarks().some((b) => b.id === id); }
  function toggleBookmark(id, title) { let b = bookmarks(); if (b.some((x) => x.id === id)) b = b.filter((x) => x.id !== id); else b.unshift({ id, title, ts: Date.now() }); store.set('bookmarks', b); renderNav(); renderTocActions(); }

  /* ---------------- Markdown pipeline ---------------- */
  const CALLOUT_TITLES = { note: 'Note', tip: 'Tip', warning: 'Warning', danger: 'Danger', security: 'Security', cost: 'Cost', fde: 'FDE perspective', vulnerable: 'Vulnerable example — do not deploy', secure: 'Secure version', objectives: 'Learning objectives', prereq: 'Prerequisites' };
  const CALLOUT_ICONS = { note: 'ℹ', tip: '✓', warning: '⚠', danger: '⛔', security: '🔒', cost: '$', fde: '◎', vulnerable: '✗', secure: '✓', objectives: '◆', prereq: '▣' };
  const COMPONENT_LANGS = new Set(['diagram', 'flow', 'layers', 'quiz', 'checklist', 'scenario', 'tabs', 'compare']);

  function preprocess(md, ctx) {
    // Protect fenced code blocks with placeholders so the regexes below never touch them,
    // while still allowing callouts to *contain* fenced code.
    const codes = [];
    let seg = md.replace(/```[\s\S]*?```/g, (m) => { codes.push(m); return `\u0000CODE${codes.length - 1}\u0000`; });
    // callouts  :::kind Optional title ... :::
    seg = seg.replace(/^:::(\w+)(?:[ \t]+([^\n]*))?\n([\s\S]*?)\n:::[ \t]*$/gm, (_, kind, title, body) => {
      kind = kind.toLowerCase();
      if (kind === 'details') return `<details class="expand"><summary>${esc(title || 'Show more')}</summary><div class="expand-body">\n\n${body}\n\n</div></details>`;
      const t = title || CALLOUT_TITLES[kind] || kind;
      const cls = kind === 'prereq' ? 'objectives' : kind;
      return `<div class="callout ${cls}"><div class="callout-title"><span>${CALLOUT_ICONS[kind] || '•'}</span>${esc(t)}</div>\n\n${body}\n\n</div>`;
    });
    // glossary terms [[term]] or [[term|shown text]]
    seg = seg.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, term, shown) => `<span class="term" data-term="${esc(term.trim().toLowerCase())}">${esc(shown || term)}</span>`);
    // file labels  @file: path  (blank line after the div so the following fence is not swallowed into the HTML block)
    seg = seg.replace(/^@file:\s*(.+)$/gm, '<div class="file-label">$1</div>\n');
    // restore code blocks
    return seg.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codes[+i]);
  }

  function makeRenderer(ctx) {
    const r = new marked.Renderer();
    const used = {};
    r.heading = function (text, level, raw) {
      let id = slugify(raw) || 'section'; if (used[id]) id = `${id}-${++used[id]}`; else used[id] = 1;
      if (level >= 2 && level <= 4) ctx.headings.push({ id, text: raw.replace(/<[^>]+>/g, ''), level });
      const anchor = level >= 2 ? `<a class="anchor" href="#/${ctx.chapterId}/${id}" aria-label="Link to section">#</a>` : '';
      return `<h${level} id="${id}">${text}${anchor}</h${level}>\n`;
    };
    r.code = function (code, info) {
      const lang = (info || '').trim().split(/\s+/)[0] || '';
      const title = (info || '').trim().slice(lang.length).trim();
      if (lang.startsWith('widget:')) { const idx = ctx.pending.push({ kind: 'widget', name: lang.slice(7), raw: code }) - 1; return `<div class="cmp-placeholder" data-p="${idx}"></div>`; }
      if (COMPONENT_LANGS.has(lang)) { const idx = ctx.pending.push({ kind: lang, raw: code }) - 1; return `<div class="cmp-placeholder" data-p="${idx}"></div>`; }
      let html;
      try { html = lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : esc(code); } catch (e) { html = esc(code); }
      const label = title || (lang ? lang : 'text');
      return `<pre><div class="code-head"><span class="lang">${esc(label)}</span><button class="copy-btn" type="button">Copy</button></div><code class="hljs language-${esc(lang)}">${html}</code></pre>\n`;
    };
    r.link = function (href, title, text) {
      let h = href || '';
      if (h.startsWith('#') && !h.startsWith('#/')) h = `#/${ctx.chapterId}/${h.slice(1)}`;
      const ext = /^https?:\/\//.test(h);
      return `<a href="${esc(h)}"${title ? ` title="${esc(title)}"` : ''}${ext ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
    };
    return r;
  }

  function renderMarkdown(md, ctx) {
    ctx.headings = ctx.headings || []; ctx.pending = ctx.pending || [];
    const pre = preprocess(md, ctx);
    return marked.parse(pre, { renderer: makeRenderer(ctx), gfm: true, breaks: false, mangle: false, headerIds: false });
  }
  window.renderMarkdownFragment = (md, ctx) => renderMarkdown(md, ctx);
  window.renderInlineMarkdown = (md) => marked.parse(md || '', { gfm: true, mangle: false, headerIds: false });

  function hydrate(root, ctx) {
    let guard = 0;
    while (guard++ < 20) {
      const ph = $$('.cmp-placeholder', root); if (!ph.length) break;
      ph.forEach((el) => {
        const p = ctx.pending[+el.dataset.p]; const box = document.createElement('div'); box.id = `cmp-${ctx.chapterId.replace('/', '-')}-${el.dataset.p}`;
        el.replaceWith(box);
        const cctx = { chapterId: ctx.chapterId, index: +el.dataset.p, pending: ctx.pending, headings: [] };
        try {
          if (p.kind === 'widget') { const fn = Widgets[p.name]; let opts = {}; try { opts = p.raw.trim() ? JSON.parse(p.raw) : {}; } catch (e) {} if (fn) fn(box, opts); else box.innerHTML = `<div class="callout warning">Unknown widget: ${esc(p.name)}</div>`; }
          else if (p.kind === 'checklist' || p.kind === 'tabs') Components[p.kind](box, p.raw, cctx);
          else Components[p.kind](box, JSON.parse(p.raw), cctx);
        } catch (e) { box.className = 'callout danger'; box.innerHTML = `<div class="callout-title">Component error (${esc(p.kind)})</div><pre><code>${esc(e.message)}</code></pre>`; console.error(e, p); }
      });
    }
    // copy buttons
    $$('.copy-btn', root).forEach((b) => b.addEventListener('click', async () => {
      const code = b.closest('pre').querySelector('code').innerText;
      try { await navigator.clipboard.writeText(code); } catch (e) { const ta = document.createElement('textarea'); ta.value = code; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      b.textContent = 'Copied'; b.classList.add('ok'); setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('ok'); }, 1400);
    }));
    // glossary tooltips
    $$('.term', root).forEach((t) => { t.addEventListener('mouseenter', showTip); t.addEventListener('mouseleave', hideTip); t.addEventListener('focus', showTip); t.addEventListener('blur', hideTip); t.setAttribute('tabindex', '0'); t.addEventListener('click', (e) => { e.preventDefault(); location.hash = `#/glossary/${slugify(t.dataset.term)}`; }); });
  }
  function showTip(e) {
    const t = e.currentTarget; const g = state.glossary || {}; const def = g[t.dataset.term] || Object.entries(g).find(([k]) => k.startsWith(t.dataset.term) || t.dataset.term.startsWith(k))?.[1];
    const tip = $('#tooltip'); tip.innerHTML = `<strong>${esc(t.dataset.term)}</strong>${def ? esc(def) : 'See glossary.'}`; tip.hidden = false;
    const r = t.getBoundingClientRect(); const tw = Math.min(340, window.innerWidth - 24);
    let x = Math.max(12, Math.min(r.left, window.innerWidth - tw - 12)); let y = r.bottom + 8; if (y + 120 > window.innerHeight) y = r.top - tip.offsetHeight - 8;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { $('#tooltip').hidden = true; }

  /* ---------------- Fetch helpers ---------------- */
  async function getJSON(path) { const r = await fetch(path, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); }
  async function getText(path) { const r = await fetch(path, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.text(); }

  /* ---------------- Navigation ---------------- */
  function renderNav() {
    const nav = $('#nav-tree'); const prog = store.get('progress', {}); const bm = new Set(bookmarks().map((b) => b.id));
    const cur = state.route;
    nav.innerHTML = state.curriculum.parts.map((p) => {
      const open = cur && cur.pid === p.id;
      const done = p.chapters.filter((c) => prog[`${p.id}/${c.id}`]?.done).length;
      return `<div class="part ${open ? 'open active' : ''}" data-pid="${p.id}"><button class="part-btn" aria-expanded="${open}"><span class="num">${esc(p.num)}</span><span>${esc(p.title)}</span><span class="chev">▸</span></button><div class="chapters">
        <a class="chapter" href="#/part/${p.id}" style="font-style:italic">Part overview · ${done}/${p.chapters.length} done</a>
        ${p.chapters.map((c, i) => { const id = `${p.id}/${c.id}`; const pr = prog[id]; const mk = pr?.done ? 'done' : pr?.pct > 5 ? 'partial' : ''; const active = cur && cur.pid === p.id && cur.cid === c.id; return `<a class="chapter ${active ? 'active' : ''}" href="#/${id}"><span class="mark ${mk}" title="${pr?.done ? 'Completed' : pr?.pct ? Math.round(pr.pct) + '% read' : 'Not started'}"></span><span>${i + 1}. ${esc(c.title)}</span>${bm.has(id) ? '<span class="bm" title="Bookmarked">★</span>' : ''}</a>`; }).join('')}
      </div></div>`;
    }).join('');
    $$('.part-btn', nav).forEach((b) => b.addEventListener('click', () => { const part = b.parentElement; part.classList.toggle('open'); b.setAttribute('aria-expanded', part.classList.contains('open')); }));
    const all = flatChapters(); const doneCount = all.filter((c) => prog[c.id]?.done).length;
    $('#sidebar-progress').innerHTML = `<div style="display:flex;justify-content:space-between"><span>Overall progress</span><b>${Math.round((doneCount / all.length) * 100)}%</b></div><div class="bar"><span style="width:${(doneCount / all.length) * 100}%"></span></div><div style="margin-top:4px">${doneCount} of ${all.length} chapters completed</div>`;
    const active = $('.chapter.active', nav); if (active) setTimeout(() => active.scrollIntoView({ block: 'nearest' }), 0);
  }

  function renderBreadcrumbs(items) {
    $('#breadcrumbs').innerHTML = items.map((it, i) => i === items.length - 1 ? `<span class="current">${esc(it.label)}</span>` : `<a href="${it.href}">${esc(it.label)}</a><span class="sep">›</span>`).join('');
  }

  function renderPager(entry) {
    const all = flatChapters(); const i = all.findIndex((x) => x.id === entry.id);
    const prev = all[i - 1], next = all[i + 1];
    $('#pager').innerHTML = `${prev ? `<a class="prev" href="#/${prev.id}"><span class="label">← Previous</span><span class="title">${esc(prev.chapter.title)}</span></a>` : '<span></span>'}${next ? `<a class="next" href="#/${next.id}"><span class="label">Next →</span><span class="title">${esc(next.chapter.title)}</span></a>` : '<span></span>'}`;
  }

  function renderToc(headings) {
    const toc = $('#toc');
    if (!headings.length) { toc.innerHTML = ''; return; }
    toc.innerHTML = `<h4>On this page</h4><ul>${headings.filter((h) => h.level <= 3).map((h) => `<li class="h${h.level}"><a href="#/${state.current.id}/${h.id}" data-id="${h.id}">${esc(h.text)}</a></li>`).join('')}</ul><div class="toc-actions"></div>`;
    renderTocActions();
  }
  function renderTocActions() {
    const el = $('.toc-actions'); if (!el || !state.current) return;
    const id = state.current.id; const pr = progressOf(id);
    el.innerHTML = `<button class="bm-toggle ${isBookmarked(id) ? 'on' : ''}">${isBookmarked(id) ? '★ Bookmarked' : '☆ Bookmark chapter'}</button><button class="done-toggle ${pr.done ? 'on' : ''}">${pr.done ? '✓ Completed' : 'Mark as complete'}</button><button class="top-btn">↑ Back to top</button>`;
    $('.bm-toggle', el).onclick = () => toggleBookmark(id, state.current.chapter.title);
    $('.done-toggle', el).onclick = () => { setProgress(id, { done: !pr.done, pct: pr.done ? pr.pct : 100 }); renderNav(); renderTocActions(); renderChapterEnd(); };
    $('.top-btn', el).onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderChapterEnd() {
    const el = $('.chapter-end'); if (!el || !state.current) return; const id = state.current.id; const pr = progressOf(id);
    el.innerHTML = `<div><b>${pr.done ? 'Chapter completed.' : 'Finished this chapter?'}</b> <span style="color:var(--fg-muted)">Progress is stored locally in your browser.</span></div><div style="display:flex;gap:8px"><button class="btn ${pr.done ? 'done' : ''} ce-done">${pr.done ? '✓ Completed' : 'Mark as complete'}</button><button class="btn ce-bm">${isBookmarked(id) ? '★ Bookmarked' : '☆ Bookmark'}</button></div>`;
    $('.ce-done', el).onclick = () => { setProgress(id, { done: !pr.done, pct: 100 }); renderNav(); renderTocActions(); renderChapterEnd(); };
    $('.ce-bm', el).onclick = () => { toggleBookmark(id, state.current.chapter.title); renderChapterEnd(); };
  }

  /* ---------------- Pages ---------------- */
  function renderHome() {
    state.current = null; renderBreadcrumbs([{ label: 'Home' }]); $('#pager').innerHTML = ''; $('#toc').innerHTML = '';
    const prog = store.get('progress', {}); const all = flatChapters(); const doneCount = all.filter((c) => prog[c.id]?.done).length;
    const last = store.get('last', null); const lastEntry = last ? all.find((c) => c.id === last.id) : null;
    const words = state.curriculum.stats?.words;
    $('#article').innerHTML = `
      <div class="hero">
        <div class="badge">Interactive textbook · ${all.length} chapters · ${state.curriculum.parts.length} parts</div>
        <h1>The Production Engineering Handbook</h1>
        <p class="lede">Software engineering, networking, application security, Linux, containers, AWS, databases, system design, delivery and operations: taught from first principles to production, for engineers who can already code and now need to own what happens after the code is written.</p>
        <div class="hero-actions"><a class="btn primary" href="#/p01/c01">Start reading</a><a class="btn" href="#/part/p13">Forward Deployed Engineer playbook</a><a class="btn" href="#/part/p15">Checklists &amp; runbooks</a><a class="btn" href="#/p02/c20">Interactive: what happens when you type a URL</a></div>
      </div>
      ${lastEntry ? `<div class="continue-card"><div style="font-size:12px;color:var(--fg-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700">Continue reading</div><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center"><a href="#/${lastEntry.id}" style="font-weight:650;font-size:1.05rem">${esc(lastEntry.part.title)} › ${esc(lastEntry.chapter.title)}</a><span style="color:var(--fg-muted);font-size:13px">${Math.round(prog[lastEntry.id]?.pct || 0)}% read</span></div></div>` : ''}
      <div class="stats-row"><div class="stat"><b>${doneCount}/${all.length}</b><span>chapters completed</span></div><div class="stat"><b>${bookmarks().length}</b><span>bookmarks</span></div>${words ? `<div class="stat"><b>${Math.round(words / 1000)}k</b><span>words</span></div><div class="stat"><b>~${Math.round(words / 220 / 60)}h</b><span>reading time</span></div>` : ''}</div>
      <h2 id="how-to-use">How to use this book</h2>
      <p>Read the parts in order if you want the full curriculum; each chapter lists its prerequisites so you can also jump straight to what you need today. Every substantial chapter follows the same structure: learning objectives, the problem the technology solves, how it works internally, diagrams, practical implementation, how real teams use it, security and operational concerns, common mistakes, troubleshooting, exercises, and links to related chapters.</p>
      <ul>
        <li><strong>Search</strong> with <kbd>/</kbd> to find chapters, sections and glossary definitions.</li>
        <li><strong>Interactive diagrams and flows</strong> are clickable: select components, step through request flows, take quizzes, and work through troubleshooting scenarios before revealing the answer.</li>
        <li><strong>Progress, bookmarks, quiz answers and checklists</strong> are saved in your browser only. Nothing leaves your machine.</li>
        <li><strong>Keyboard:</strong> <kbd>[</kbd> / <kbd>]</kbd> previous and next chapter, <kbd>t</kbd> theme, <kbd>b</kbd> bookmarks, <kbd>m</kbd> menu.</li>
        <li>Dotted-underlined <span class="term" data-term="idempotency">terms</span> show a definition on hover and open the glossary on click.</li>
      </ul>
      <h2 id="curriculum">Curriculum</h2>
      <div class="parts-grid">${state.curriculum.parts.map((p) => { const d = p.chapters.filter((c) => prog[`${p.id}/${c.id}`]?.done).length; return `<a class="part-card" href="#/part/${p.id}"><div class="pc-num">PART ${esc(p.num)}</div><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p><div class="pc-bar"><span style="width:${(d / p.chapters.length) * 100}%"></span></div><div class="pc-meta">${p.chapters.length} chapters · ${d} completed</div></a>`; }).join('')}</div>
      <h2 id="who">Who this is for</h2>
      <p>You are a developer, perhaps a Forward Deployed Engineer, who ships code for real clients and wants to understand everything around that code: how it reaches a server, how that server is secured, how a request travels through DNS, TLS, load balancers and proxies into your process and database, how to deploy to AWS without surprises, how to decide between architectures, and what to do at 2 a.m. when production is down. Nothing is assumed beyond the ability to program.</p>
      <div class="callout note"><div class="callout-title"><span>ℹ</span>Safety and ethics</div><p>Security chapters teach defensive engineering with deliberately vulnerable code that runs only on your own machine. Never test techniques against systems you do not own or have explicit written authorisation to test.</p></div>`;
    hydrate($('#article'), { chapterId: 'home', pending: [] });
  }

  function renderPart(pid) {
    const p = state.curriculum.parts.find((x) => x.id === pid); if (!p) return render404();
    state.current = null; renderBreadcrumbs([{ label: 'Home', href: '#/' }, { label: `Part ${p.num}: ${p.title}` }]); $('#pager').innerHTML = ''; $('#toc').innerHTML = '';
    const prog = store.get('progress', {});
    $('#article').innerHTML = `<div class="chapter-meta" style="border:0;margin-bottom:4px;padding:0"><span class="part-label">Part ${esc(p.num)}</span></div><h1>${esc(p.title)}</h1><p class="lede" style="color:var(--fg-muted);font-size:1.1rem">${esc(p.desc)}</p>${p.intro ? window.renderInlineMarkdown(p.intro) : ''}<ol class="chapter-list">${p.chapters.map((c, i) => { const id = `${p.id}/${c.id}`; const pr = prog[id]; return `<li><a href="#/${id}"><span class="cl-num">${String(i + 1).padStart(2, '0')}</span><span><div class="cl-title">${esc(c.title)} ${pr?.done ? '<span class="badge ok">done</span>' : pr?.pct > 5 ? `<span class="badge">${Math.round(pr.pct)}%</span>` : ''}</div><div class="cl-desc">${esc(c.desc || '')}</div></span></a></li>`; }).join('')}</ol>`;
  }

  async function renderGlossary(termSlug) {
    state.current = null; renderBreadcrumbs([{ label: 'Home', href: '#/' }, { label: 'Glossary' }]); $('#pager').innerHTML = ''; $('#toc').innerHTML = '';
    const g = state.glossary; const entries = Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]));
    $('#article').innerHTML = `<h1>Glossary</h1><p style="color:var(--fg-muted)">${entries.length} terms. Hovering a dotted term anywhere in the book shows its definition; clicking it brings you here.</p><input class="glossary-filter" id="gl-filter" placeholder="Filter terms…" autocomplete="off"><dl class="glossary-list" id="gl-list">${entries.map(([k, v]) => `<div class="gl-item" id="${slugify(k)}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    $('#gl-filter').addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('.gl-item').forEach((el) => { el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none'; }); });
    if (termSlug) { const el = document.getElementById(termSlug) || $$('.gl-item').find((x) => x.id.startsWith(termSlug)); if (el) { setTimeout(() => { el.scrollIntoView({ block: 'center' }); el.style.background = 'var(--accent-soft)'; el.style.borderRadius = '8px'; el.style.padding = '6px 10px'; }, 50); } }
  }

  function render404() { $('#article').innerHTML = `<h1>Not found</h1><p>That page does not exist. <a href="#/">Return home</a>.</p>`; $('#pager').innerHTML = ''; $('#toc').innerHTML = ''; }

  async function renderChapter(pid, cid, anchor) {
    const entry = findChapter(pid, cid); if (!entry) return render404();
    state.current = entry; const { part, chapter } = entry;
    renderBreadcrumbs([{ label: 'Home', href: '#/' }, { label: `Part ${part.num}`, href: `#/part/${part.id}` }, { label: chapter.title }]);
    const art = $('#article');
    const path = `content/${part.id}/${chapter.id}.md`;
    let md = state.chapterCache[path];
    if (!md) { art.innerHTML = '<div class="loading">Loading chapter…</div>'; try { md = await getText(path); state.chapterCache[path] = md; } catch (e) { art.innerHTML = `<h1>${esc(chapter.title)}</h1><div class="callout warning"><div class="callout-title">Chapter file not found</div><p>Expected <code>${esc(path)}</code>. If you opened <code>index.html</code> directly from disk, serve the folder over HTTP instead (see README).</p></div>`; return; } }
    if (state.current !== entry) return; // navigated away while loading
    const ctx = { chapterId: entry.id, headings: [], pending: [] };
    // Strip a leading H1 from the markdown (the title comes from the curriculum).
    const body = md.replace(/^#\s+[^\n]+\n/, '');
    const words = body.split(/\s+/).length; const mins = Math.max(1, Math.round(words / 220));
    const idx = part.chapters.indexOf(chapter);
    const html = renderMarkdown(body, ctx);
    art.innerHTML = `<div class="chapter-meta" style="border:0;margin:0;padding:0"><span class="part-label">Part ${esc(part.num)} · ${esc(part.title)}</span></div><h1>${idx + 1}. ${esc(chapter.title)}</h1><div class="chapter-meta"><span>${mins} min read</span><span>${words.toLocaleString()} words</span>${chapter.level ? `<span>Level: ${esc(chapter.level)}</span>` : ''}</div>${html}<div class="chapter-end"></div>`;
    hydrate(art, ctx);
    renderToc(ctx.headings); renderPager(entry); renderNav(); renderChapterEnd();
    store.set('last', { id: entry.id, ts: Date.now() });
    if (anchor) { const el = document.getElementById(anchor); if (el) { setTimeout(() => el.scrollIntoView({ block: 'start' }), 30); } }
    else window.scrollTo(0, 0);
    document.title = `${chapter.title} · Production Engineering Handbook`;
    setTimeout(onScroll, 100);
  }

  /* ---------------- Router ---------------- */
  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, ''); const parts = h.split('/').filter(Boolean);
    if (!parts.length) return { page: 'home' };
    if (parts[0] === 'part') return { page: 'part', pid: parts[1] };
    if (parts[0] === 'glossary') return { page: 'glossary', term: parts[1] };
    if (parts[0] === 'reference') return { page: 'chapter', pid: parts[1]?.split('-')[0], cid: parts[1]?.split('-')[1] };
    if (/^p\d+$/.test(parts[0]) && /^c\d+$/.test(parts[1] || '')) return { page: 'chapter', pid: parts[0], cid: parts[1], anchor: parts.slice(2).join('/') };
    if (/^p\d+-c\d+$/.test(parts[0])) { const [pid, cid] = parts[0].split('-'); return { page: 'chapter', pid, cid, anchor: parts[1] }; }
    return { page: '404' };
  }
  async function route() {
    const r = parseRoute(); state.route = r; document.body.classList.remove('nav-open');
    document.title = 'Production Engineering Handbook';
    if (r.page === 'home') renderHome();
    else if (r.page === 'part') renderPart(r.pid);
    else if (r.page === 'glossary') renderGlossary(r.term);
    else if (r.page === 'chapter') await renderChapter(r.pid, r.cid, r.anchor);
    else render404();
    if (r.page !== 'chapter') renderNav();
  }

  /* ---------------- Scroll tracking ---------------- */
  let scrollTimer = null;
  function onScroll() {
    const doc = document.documentElement; const max = doc.scrollHeight - window.innerHeight; const pct = max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 100;
    $('#progress-bar').style.width = (state.current ? pct : 0) + '%';
    if (!state.current) return;
    // TOC highlight
    const hs = $$('.article h2, .article h3'); let activeId = null; for (const h of hs) { if (h.getBoundingClientRect().top <= 90) activeId = h.id; else break; }
    $$('#toc a').forEach((a) => a.classList.toggle('active', a.dataset.id === activeId));
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { if (!state.current) return; const id = state.current.id; const pr = progressOf(id); const newPct = Math.max(pr.pct || 0, pct); const done = pr.done || pct >= 92; if (newPct !== pr.pct || done !== pr.done) { setProgress(id, { pct: newPct, done }); if (done !== pr.done) { renderNav(); renderTocActions(); renderChapterEnd(); } } }, 400);
  }

  /* ---------------- Search ---------------- */
  let searchSel = 0, searchResults = [];
  async function ensureIndex() { if (state.index) return state.index; try { state.index = await getJSON('content/search-index.json'); } catch (e) { state.index = []; } return state.index; }
  function tokenize(q) { return q.toLowerCase().replace(/[^a-z0-9.\-/ ]/g, ' ').split(/\s+/).filter((t) => t.length > 1); }
  function snippet(text, terms) {
    const lower = text.toLowerCase(); let pos = -1; for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
    const start = Math.max(0, pos - 70); let s = text.slice(start, start + 200); if (start > 0) s = '…' + s; if (start + 200 < text.length) s += '…';
    return highlight(esc(s), terms);
  }
  function highlight(html, terms) { terms.forEach((t) => { html = html.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>'); }); return html; }
  async function doSearch(q) {
    const res = $('#search-results'); const terms = tokenize(q); if (!terms.length) { res.innerHTML = `<div class="empty">Type to search ${flatChapters().length} chapters and ${Object.keys(state.glossary || {}).length} glossary terms.</div>`; searchResults = []; return; }
    const idx = await ensureIndex(); const phrase = q.toLowerCase().trim();
    const scored = [];
    for (const e of idx) {
      let score = 0; const t = e.t.toLowerCase(), h = (e.h || '').toLowerCase(), x = e.x.toLowerCase();
      for (const term of terms) { if (t.includes(term)) score += 10; if (h.includes(term)) score += 7; const c = x.split(term).length - 1; if (c) score += Math.min(4, 1 + Math.log2(c + 1)); }
      if (terms.length > 1 && (h.includes(phrase) || t.includes(phrase))) score += 12; else if (terms.length > 1 && x.includes(phrase)) score += 6;
      if (terms.every((term) => !(t.includes(term) || h.includes(term) || x.includes(term)))) continue;
      if (score > 0) scored.push({ ...e, score });
    }
    for (const [k, v] of Object.entries(state.glossary || {})) { const kl = k.toLowerCase(), vl = v.toLowerCase(); let score = 0; terms.forEach((term) => { if (kl.includes(term)) score += 14; else if (vl.includes(term)) score += 2; }); if (score) scored.push({ kind: 'definition', t: k, x: v, score, href: `#/glossary/${slugify(k)}` }); }
    scored.sort((a, b) => b.score - a.score);
    searchResults = scored.slice(0, 40); searchSel = 0;
    if (!searchResults.length) { res.innerHTML = `<div class="empty">No results for “${esc(q)}”.</div>`; return; }
    res.innerHTML = searchResults.map((r, i) => r.kind === 'definition' ? `<a class="sr ${i === 0 ? 'sel' : ''}" href="${r.href}" data-i="${i}"><div class="sr-title"><span class="sr-kind">definition</span>${highlight(esc(r.t), terms)}</div><div class="sr-snippet">${highlight(esc(r.x), terms)}</div></a>` : `<a class="sr ${i === 0 ? 'sel' : ''}" href="#/${r.c}${r.s ? '/' + r.s : ''}" data-i="${i}"><div class="sr-crumb">${esc(r.pt)} › ${esc(r.t)}</div><div class="sr-title">${highlight(esc(r.h || r.t), terms)}</div><div class="sr-snippet">${snippet(r.x, terms)}</div></a>`).join('');
  }
  function openSearch() { $('#search-modal').hidden = false; const i = $('#search-input'); i.value = ''; i.focus(); doSearch(''); ensureIndex(); }
  function closeModals() { $('#search-modal').hidden = true; $('#bookmarks-modal').hidden = true; }

  function openBookmarks() {
    const b = $('#bookmarks-body'); const bms = bookmarks(); const prog = store.get('progress', {}); const all = flatChapters();
    const inprog = all.filter((c) => prog[c.id] && !prog[c.id].done && prog[c.id].pct > 5).sort((x, y) => (prog[y.id].ts || 0) - (prog[x.id].ts || 0)).slice(0, 8);
    const done = all.filter((c) => prog[c.id]?.done);
    b.innerHTML = `<h3>Bookmarks</h3>${bms.length ? `<ul>${bms.map((x) => { const e = all.find((c) => c.id === x.id); return e ? `<li><a href="#/${x.id}">${esc(e.part.title)} › ${esc(e.chapter.title)}</a><button class="danger-btn" data-rm="${x.id}">remove</button></li>` : ''; }).join('')}</ul>` : '<p style="color:var(--fg-muted);font-size:14px">No bookmarks yet. Use the ☆ button in a chapter.</p>'}
      <h3>In progress</h3>${inprog.length ? `<ul>${inprog.map((c) => `<li><a href="#/${c.id}">${esc(c.chapter.title)}</a><small>${Math.round(prog[c.id].pct)}%</small></li>`).join('')}</ul>` : '<p style="color:var(--fg-muted);font-size:14px">Nothing in progress.</p>'}
      <h3>Completed (${done.length})</h3>${done.length ? `<ul>${done.slice(0, 30).map((c) => `<li><a href="#/${c.id}">${esc(c.chapter.title)}</a></li>`).join('')}${done.length > 30 ? `<li><small>…and ${done.length - 30} more</small></li>` : ''}</ul>` : '<p style="color:var(--fg-muted);font-size:14px">No chapters completed yet.</p>'}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="danger-btn" id="reset-progress">Reset all progress</button><button class="danger-btn" id="export-progress" style="color:var(--fg)">Export progress JSON</button></div>`;
    $$('[data-rm]', b).forEach((x) => x.addEventListener('click', () => { toggleBookmark(x.dataset.rm); openBookmarks(); }));
    $('#reset-progress').addEventListener('click', () => { if (confirm('Reset reading progress, bookmarks, quiz answers and checklists stored in this browser?')) { Object.keys(localStorage).filter((k) => k.startsWith('peh:') && k !== 'peh:theme').forEach((k) => localStorage.removeItem(k)); openBookmarks(); renderNav(); } });
    $('#export-progress').addEventListener('click', () => { const data = {}; Object.keys(localStorage).filter((k) => k.startsWith('peh:')).forEach((k) => (data[k] = localStorage.getItem(k))); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'handbook-progress.json'; a.click(); });
    $('#bookmarks-modal').hidden = false;
  }

  /* ---------------- Events ---------------- */
  function bind() {
    window.addEventListener('hashchange', route);
    window.addEventListener('scroll', onScroll, { passive: true });
    $('#theme-btn').addEventListener('click', toggleTheme);
    $('#search-btn').addEventListener('click', openSearch);
    $('#bookmarks-btn').addEventListener('click', openBookmarks);
    $('#menu-btn').addEventListener('click', () => { if (window.innerWidth <= 900) document.body.classList.toggle('nav-open'); else document.body.classList.toggle('nav-collapsed'); });
    $('#sidebar-backdrop').addEventListener('click', () => document.body.classList.remove('nav-open'));
    $$('[data-close]').forEach((el) => el.addEventListener('click', closeModals));
    $('#search-input').addEventListener('input', (e) => doSearch(e.target.value));
    $('#search-input').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!searchResults.length) return; searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + searchResults.length) % searchResults.length; $$('.sr').forEach((a, i) => a.classList.toggle('sel', i === searchSel)); $$('.sr')[searchSel]?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { const a = $$('.sr')[searchSel]; if (a) { location.hash = a.getAttribute('href'); closeModals(); } }
    });
    $('#search-results').addEventListener('click', (e) => { if (e.target.closest('a')) closeModals(); });
    $('#bookmarks-body').addEventListener('click', (e) => { if (e.target.closest('a')) closeModals(); });
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName; const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
      if (e.key === 'Escape') { closeModals(); document.body.classList.remove('nav-open'); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); } return; }
      if (e.key === '/') { e.preventDefault(); openSearch(); }
      else if (e.key === 't') toggleTheme();
      else if (e.key === 'b') openBookmarks();
      else if (e.key === 'm') $('#menu-btn').click();
      else if ((e.key === '[' || e.key === ']') && state.current) { const all = flatChapters(); const i = all.findIndex((x) => x.id === state.current.id); const n = all[i + (e.key === ']' ? 1 : -1)]; if (n) location.hash = `#/${n.id}`; }
    });
  }

  /* ---------------- Boot ---------------- */
  async function boot() {
    try { [state.curriculum, state.glossary] = await Promise.all([getJSON('content/curriculum.json'), getJSON('content/glossary.json').catch(() => ({}))]); }
    catch (e) { $('#article').innerHTML = `<h1>Could not load the book</h1><div class="callout danger"><div class="callout-title">Serve over HTTP</div><p>Browsers block <code>fetch()</code> from <code>file://</code> URLs. Run a static server from this folder, for example:</p><pre><code>python3 -m http.server 8080\n# then open http://localhost:8080</code></pre><p>Error: <code>${esc(e.message)}</code></p></div>`; return; }
    bind(); renderNav(); route();
  }
  boot();
})();
