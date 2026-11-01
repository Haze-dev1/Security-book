/* Educational calculators: ```widget:<name> blocks. */
window.Widgets = (function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function shell(container, title, kind) { container.className = 'cmp widget-cmp'; container.innerHTML = `<div class="cmp-head"><span class="kind">interactive · ${esc(kind)}</span><span>${esc(title)}</span></div><div class="widget"></div>`; return container.querySelector('.widget'); }

  /* CIDR / subnet calculator */
  function cidr(container, opts) {
    const w = shell(container, 'CIDR and subnet calculator', 'networking');
    w.innerHTML = `<div class="row"><label>CIDR block <input type="text" id="cidr-in" value="${esc(opts.value || '10.0.1.0/24')}" spellcheck="false"></label><button class="sm" id="cidr-go">Calculate</button></div><div class="out" id="cidr-out"></div><div class="bits" id="cidr-bits"></div><div style="font-size:12.5px;color:var(--fg-muted)">Blue bits are the network prefix (fixed), green bits are the host portion (vary within the block). Try <code>10.0.0.0/16</code>, <code>192.168.1.37/27</code> or <code>172.31.0.0/20</code>. Remember that AWS reserves 5 addresses per subnet, not 2.</div>`;
    const inp = w.querySelector('#cidr-in'), out = w.querySelector('#cidr-out'), bits = w.querySelector('#cidr-bits');
    function calc() {
      const m = inp.value.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
      if (!m) { out.innerHTML = `<span class="err">Enter an IPv4 CIDR like 10.0.1.0/24</span>`; bits.innerHTML = ''; return; }
      const oct = m.slice(1, 5).map(Number), p = +m[5];
      if (oct.some((o) => o > 255) || p > 32) { out.innerHTML = `<span class="err">Octets must be 0–255 and prefix 0–32</span>`; return; }
      const ip = ((oct[0] << 24) | (oct[1] << 16) | (oct[2] << 8) | oct[3]) >>> 0;
      const mask = p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0;
      const net = (ip & mask) >>> 0, bcast = (net | (~mask >>> 0)) >>> 0;
      const toS = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
      const total = 2 ** (32 - p);
      const usable = p >= 31 ? (p === 31 ? 2 : 1) : total - 2, aws = Math.max(0, total - 5);
      const priv = (oct[0] === 10) || (oct[0] === 172 && oct[1] >= 16 && oct[1] <= 31) || (oct[0] === 192 && oct[1] === 168);
      out.innerHTML = `<div class="kv"><span>Network address</span><span><b>${toS(net)}</b>/${p}</span><span>Subnet mask</span><span>${toS(mask)}</span><span>Wildcard</span><span>${toS(~mask >>> 0)}</span><span>First host</span><span>${toS(p >= 31 ? net : net + 1)}</span><span>Last host</span><span>${toS(p >= 31 ? bcast : bcast - 1)}</span><span>Broadcast</span><span>${toS(bcast)}</span><span>Total addresses</span><span>${total.toLocaleString()}</span><span>Usable hosts (classic)</span><span>${usable.toLocaleString()}</span><span>Usable in an AWS subnet</span><span>${aws.toLocaleString()} <span style="color:var(--fg-faint)">(AWS reserves .0 network, .1 router, .2 DNS, .3 future, and broadcast)</span></span><span>Address space</span><span>${priv ? 'Private (RFC 1918) — not routable on the public Internet' : 'Public / other'}</span><span>Input is network address?</span><span>${ip === net ? 'yes' : `no — ${toS(ip)} is a host inside ${toS(net)}/${p}`}</span></div>`;
      bits.innerHTML = [...Array(32)].map((_, i) => `<span class="${i < p ? 'net' : 'host'}">${(ip >>> (31 - i)) & 1}</span>${(i + 1) % 8 === 0 && i < 31 ? '<span style="background:none">.</span>' : ''}`).join('');
    }
    w.querySelector('#cidr-go').addEventListener('click', calc); inp.addEventListener('keydown', (e) => e.key === 'Enter' && calc()); inp.addEventListener('input', calc); calc();
  }

  /* chmod permission calculator */
  function chmod(container, opts) {
    const w = shell(container, 'Unix permission calculator', 'linux');
    const who = ['Owner (u)', 'Group (g)', 'Others (o)'], what = ['read (r)', 'write (w)', 'execute (x)'];
    let v = (opts.value || '750').split('').map(Number);
    w.innerHTML = `<div class="row"><label>Octal mode <input type="text" id="pm-oct" value="${esc(opts.value || '750')}" maxlength="4" style="min-width:90px"></label><label>Target <select id="pm-type"><option value="f">regular file</option><option value="d">directory</option></select></label></div><div class="perm-grid" id="pm-grid"></div><div class="out" id="pm-out"></div><div style="font-size:12.5px;color:var(--fg-muted)">For directories, <b>read</b> lists entries, <b>write</b> creates/deletes entries, and <b>execute</b> allows entering the directory and accessing files inside. Common production modes: <code>600</code> for secrets and private keys, <code>640</code> for config read by a service group, <code>750</code> for application directories, <code>755</code> for public binaries. Never <code>777</code>.</div>`;
    const grid = w.querySelector('#pm-grid'), out = w.querySelector('#pm-out'), oct = w.querySelector('#pm-oct');
    function draw() {
      grid.innerHTML = `<b></b>${what.map((x) => `<b>${x}</b>`).join('')}` + who.map((wn, i) => `<span>${wn}</span>` + [4, 2, 1].map((b) => `<input type="checkbox" data-i="${i}" data-b="${b}" ${(v[i] & b) ? 'checked' : ''}>`).join('')).join('');
      const sym = v.map((n) => `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`).join('');
      const t = w.querySelector('#pm-type').value;
      const warns = [];
      if (v[2] & 2) warns.push('World-writable: any user on the machine can modify this. Almost never acceptable in production.');
      if (v[2] & 4 && t === 'f') warns.push('World-readable: fine for public files, dangerous for secrets, keys, .env files and databases.');
      if (t === 'd' && (v[0] & 4) && !(v[0] & 1)) warns.push('Directory readable but not executable for owner: can list names but cannot access files inside.');
      out.innerHTML = `<div class="kv"><span>Symbolic</span><span><b>${t === 'd' ? 'd' : '-'}${sym}</b></span><span>Octal</span><span>${v.join('')}</span><span>Command</span><span>chmod ${v.join('')} path</span><span>ls -l shows</span><span>${t === 'd' ? 'd' : '-'}${sym}  1 owner group  ...</span></div>${warns.map((x) => `<div class="warnbox" style="margin-top:8px">⚠ ${x}</div>`).join('')}`;
      oct.value = v.join('');
    }
    grid.addEventListener('change', (e) => { const i = +e.target.dataset.i, b = +e.target.dataset.b; v[i] = e.target.checked ? (v[i] | b) : (v[i] & ~b); draw(); });
    oct.addEventListener('input', () => { const m = oct.value.trim().match(/^[0-7]?([0-7])([0-7])([0-7])$/); if (m) { v = [+m[1], +m[2], +m[3]]; draw(); } });
    w.querySelector('#pm-type').addEventListener('change', draw); draw();
  }

  /* JWT decoder (offline, no verification: that is the lesson) */
  function jwt(container, opts) {
    const w = shell(container, 'JWT inspector (decodes only; it does NOT verify)', 'security');
    const sample = opts.value || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzQyIiwicm9sZSI6ImFkbWluIiwiZXhwIjoxNzUwMDAwMDAwLCJpYXQiOjE3NDk5OTY0MDB9.r2fXSw4t7e1rN1m8xR1xkYyS1h1z8V0W6a3cLqz7rYk';
    w.innerHTML = `<label>Paste a JWT <textarea id="jwt-in" spellcheck="false">${esc(sample)}</textarea></label><div class="jwt-part h" id="jwt-h"></div><div class="jwt-part p" id="jwt-p"></div><div class="jwt-part s" id="jwt-s"></div><div id="jwt-notes"></div><div class="warnbox">Anyone can decode a JWT — it is only base64url, not encryption. Decoding tells you nothing about whether it is authentic. The server must <b>verify the signature</b> with the expected algorithm and key, then check <code>exp</code>, <code>iss</code> and <code>aud</code>, before trusting a single claim.</div>`;
    const inp = w.querySelector('#jwt-in');
    const b64 = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; try { return decodeURIComponent(escape(atob(s))); } catch (e) { return null; } };
    function run() {
      const parts = inp.value.trim().split('.');
      const h = w.querySelector('#jwt-h'), p = w.querySelector('#jwt-p'), s = w.querySelector('#jwt-s'), notes = w.querySelector('#jwt-notes');
      if (parts.length !== 3) { h.textContent = 'A JWS compact token has exactly three dot-separated parts: header.payload.signature'; p.textContent = ''; s.textContent = ''; notes.innerHTML = ''; return; }
      const hd = b64(parts[0]), pl = b64(parts[1]);
      let hj = null, pj = null; try { hj = JSON.parse(hd); } catch (e) {} try { pj = JSON.parse(pl); } catch (e) {}
      h.textContent = 'HEADER\n' + (hj ? JSON.stringify(hj, null, 2) : hd || '(not valid base64url)');
      p.textContent = 'PAYLOAD (claims)\n' + (pj ? JSON.stringify(pj, null, 2) : pl || '(not valid base64url)');
      s.textContent = 'SIGNATURE (base64url, ' + Math.floor(parts[2].length * 6 / 8) + ' bytes)\n' + parts[2];
      const n = [];
      if (hj?.alg === 'none') n.push('alg=none: an unsigned token. A server that honours this accepts forged tokens. Always pin the allowed algorithms server-side.');
      if (hj?.alg?.startsWith('HS')) n.push(`${hj.alg}: symmetric HMAC. Every service that verifies also holds the key that can mint tokens. Fine for a single issuer/verifier, risky when many services verify.`);
      if (hj?.alg?.startsWith('RS') || hj?.alg?.startsWith('ES') || hj?.alg?.startsWith('PS')) n.push(`${hj.alg}: asymmetric. Verifiers only need the public key (usually fetched from a JWKS URL). Preferred when multiple services verify tokens.`);
      if (pj?.exp) { const d = new Date(pj.exp * 1000); n.push(`exp = ${d.toISOString()} → ${d < new Date() ? 'EXPIRED' : 'valid for ' + Math.round((d - new Date()) / 60000) + ' more minutes'} (a verifier must reject expired tokens).`); } else if (pj) n.push('No exp claim: this token would never expire. Always set a short expiry.');
      if (pj && !pj.aud) n.push('No aud claim: a token minted for one API could be replayed against another. Set and check audience.');
      if (pj?.role || pj?.admin || pj?.is_admin) n.push('Authorization claims inside the token: safe only if the signature is verified and the token is short-lived, because revocation is hard.');
      notes.innerHTML = n.map((x) => `<div style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)">• ${esc(x)}</div>`).join('');
    }
    inp.addEventListener('input', run); run();
  }

  /* Hashing demo with SHA-256 (WebCrypto) */
  function hash(container, opts) {
    const w = shell(container, 'Hashing and salting demonstration', 'security');
    w.innerHTML = `<div class="row"><label>Input <input type="text" id="hs-in" value="${esc(opts.value || 'correct horse battery staple')}"></label><label>Salt (random per user) <input type="text" id="hs-salt" value="${esc(opts.salt || '')}" placeholder="(none)"></label><button class="sm" id="hs-rand">Random salt</button></div><div class="out" id="hs-out"></div><div style="font-size:12.5px;color:var(--fg-muted)">Change one character and watch the whole digest change (avalanche effect). The same input with the same salt always hashes identically, which is what makes <em>unsalted</em> password hashes vulnerable to precomputed tables. Real password storage uses a slow, memory-hard function such as Argon2id or bcrypt, not a single SHA-256 round.</div>`;
    const inp = w.querySelector('#hs-in'), salt = w.querySelector('#hs-salt'), out = w.querySelector('#hs-out');
    async function sha(s) { const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
    async function run() {
      if (!crypto?.subtle) { out.textContent = 'WebCrypto unavailable (needs https:// or http://localhost).'; return; }
      const plain = await sha(inp.value), salted = await sha(salt.value + inp.value);
      out.innerHTML = `<div class="kv"><span>SHA-256(input)</span><span>${plain}</span><span>SHA-256(salt‖input)</span><span>${salt.value ? salted : '<span style="color:var(--fg-faint)">add a salt to compare</span>'}</span><span>Stored record</span><span>${salt.value ? `${esc(salt.value)}$${salted.slice(0, 32)}…` : 'argon2id$v=19$m=65536,t=3,p=4$&lt;salt&gt;$&lt;hash&gt;  ← what a real store looks like'}</span></div>`;
    }
    w.querySelector('#hs-rand').addEventListener('click', () => { const a = new Uint8Array(12); crypto.getRandomValues(a); salt.value = [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); run(); });
    inp.addEventListener('input', run); salt.addEventListener('input', run); run();
  }

  /* Capacity estimation */
  function capacity(container, opts) {
    const w = shell(container, 'Back-of-the-envelope capacity estimator', 'system design');
    w.innerHTML = `<div class="row"><label>Daily active users <input type="number" id="cp-dau" value="${opts.dau || 100000}"></label><label>Requests per user per day <input type="number" id="cp-rpu" value="${opts.rpu || 50}"></label><label>Peak multiplier <input type="number" id="cp-peak" value="${opts.peak || 3}" step="0.5"></label></div><div class="row"><label>Avg response bytes <input type="number" id="cp-bytes" value="${opts.bytes || 2048}"></label><label>Write ratio (%) <input type="number" id="cp-write" value="${opts.write || 10}"></label><label>Avg stored row bytes <input type="number" id="cp-row" value="${opts.row || 512}"></label></div><div class="out" id="cp-out"></div><div style="font-size:12.5px;color:var(--fg-muted)">Estimates are order-of-magnitude. The point is to know whether you need one small server, a modest fleet, or a fundamentally different design, before you pick technologies.</div>`;
    const out = w.querySelector('#cp-out');
    const fmt = (n) => n >= 1e12 ? (n / 1e12).toFixed(1) + ' T' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' G' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' K' : n.toFixed(0) + ' ';
    function run() {
      const g = (id) => +w.querySelector(id).value || 0;
      const dau = g('#cp-dau'), rpu = g('#cp-rpu'), peak = g('#cp-peak'), bytes = g('#cp-bytes'), wr = g('#cp-write') / 100, row = g('#cp-row');
      const daily = dau * rpu, avgRps = daily / 86400, peakRps = avgRps * peak, writes = peakRps * wr, bw = peakRps * bytes * 8;
      const storeDay = daily * wr * row, storeYear = storeDay * 365;
      const tier = peakRps < 200 ? 'One modest app server (2 vCPU) behind a load balancer plus a managed database handles this comfortably. Over-engineering here wastes client money.' : peakRps < 3000 ? 'A small horizontally scaled fleet (2–6 instances) with connection pooling, caching for hot reads and a primary database with a read replica.' : peakRps < 30000 ? 'Serious scale: caching is mandatory, database sharding or a NoSQL store for hot paths, async processing for writes, CDN for static assets, and careful capacity planning.' : 'Very large scale: multi-region, partitioned data, dedicated platform team. Validate the assumptions before designing for this.';
      out.innerHTML = `<div class="kv"><span>Requests / day</span><span>${fmt(daily)}</span><span>Average RPS</span><span>${avgRps.toFixed(1)}</span><span>Peak RPS</span><span><b>${peakRps.toFixed(0)}</b></span><span>Peak write RPS</span><span>${writes.toFixed(1)}</span><span>Peak egress bandwidth</span><span>${fmt(bw)}bit/s</span><span>New storage / day</span><span>${fmt(storeDay)}B</span><span>New storage / year</span><span>${fmt(storeYear)}B</span><span>Rough sizing</span><span>${tier}</span></div>`;
    }
    w.querySelectorAll('input').forEach((i) => i.addEventListener('input', run)); run();
  }

  /* Latency budget visualizer */
  function latency(container, opts) {
    const w = shell(container, 'Latency budget builder', 'performance');
    const rows = opts.rows || [['DNS lookup (cached)', 1], ['TCP + TLS handshake (resumed)', 20], ['Load balancer', 1], ['App: auth middleware', 3], ['App: DB query (indexed)', 8], ['App: external API call', 120], ['App: serialize response', 2], ['Network back to client', 25]];
    w.innerHTML = `<div style="font-size:13px;color:var(--fg-muted)">Edit the milliseconds. Watch which step dominates the budget.</div><div id="lt-rows" style="display:grid;gap:6px"></div><div class="row"><label>Target p95 (ms) <input type="number" id="lt-target" value="${opts.target || 200}"></label><button class="sm" id="lt-add">Add step</button></div><div class="out" id="lt-out"></div>`;
    const rowsEl = w.querySelector('#lt-rows'), out = w.querySelector('#lt-out');
    let data = rows.map((r) => ({ name: r[0], ms: r[1] }));
    function draw() {
      const total = data.reduce((a, r) => a + (+r.ms || 0), 0), target = +w.querySelector('#lt-target').value || 1;
      rowsEl.innerHTML = data.map((r, i) => `<div style="display:grid;grid-template-columns:1fr 90px 1fr;gap:8px;align-items:center"><input type="text" data-i="${i}" data-k="name" value="${esc(r.name)}" style="min-width:0"><input type="number" data-i="${i}" data-k="ms" value="${r.ms}" style="min-width:0"><div style="height:14px;background:var(--bg-elev-2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.min(100, (r.ms / Math.max(total, target)) * 100)}%;background:${r.ms / total > 0.4 ? 'var(--danger)' : 'var(--accent)'}"></div></div></div>`).join('');
      const worst = data.reduce((a, b) => (+b.ms > +a.ms ? b : a), data[0]);
      out.innerHTML = `<div class="kv"><span>Total</span><span><b style="color:${total > target ? 'var(--danger)' : 'var(--ok)'}">${total} ms</b> of ${target} ms budget (${Math.round((total / target) * 100)}%)</span><span>Dominant step</span><span>${esc(worst.name)} (${Math.round((worst.ms / total) * 100)}%)</span><span>Advice</span><span>${total > target ? `Over budget. Attack “${esc(worst.name)}” first: cache it, run it asynchronously, parallelise it, or set a timeout and degrade gracefully.` : 'Within budget. Keep headroom: p99 is typically 2–5× p50 and tail latency compounds across sequential calls.'}</span></div>`;
    }
    rowsEl.addEventListener('input', (e) => { const i = +e.target.dataset.i, k = e.target.dataset.k; data[i][k] = k === 'ms' ? +e.target.value : e.target.value; if (k === 'ms') draw(); });
    w.querySelector('#lt-target').addEventListener('input', draw);
    w.querySelector('#lt-add').addEventListener('click', () => { data.push({ name: 'New step', ms: 10 }); draw(); });
    draw();
  }

  /* Availability / SLO math */
  function slo(container, opts) {
    const w = shell(container, 'Availability and error-budget calculator', 'reliability');
    w.innerHTML = `<div class="row"><label>SLO target (%) <input type="number" id="slo-t" value="${opts.value || 99.9}" step="0.01" min="90" max="99.9999"></label><label>Requests / month <input type="number" id="slo-r" value="${opts.req || 50000000}"></label></div><div class="out" id="slo-out"></div><div style="font-size:12.5px;color:var(--fg-muted)">Each extra “nine” roughly multiplies cost and complexity. A single-region, single-AZ deployment with manual recovery struggles to exceed ~99.5%. Serial dependencies multiply: two 99.9% services in sequence give at most 99.8%.</div>`;
    const out = w.querySelector('#slo-out');
    function run() {
      const t = +w.querySelector('#slo-t').value, r = +w.querySelector('#slo-r').value;
      const down = (1 - t / 100);
      const f = (min) => min >= 1440 ? (min / 1440).toFixed(2) + ' days' : min >= 60 ? (min / 60).toFixed(2) + ' hours' : min >= 1 ? min.toFixed(1) + ' minutes' : (min * 60).toFixed(1) + ' seconds';
      out.innerHTML = `<div class="kv"><span>Allowed downtime / month</span><span><b>${f(down * 30 * 1440)}</b></span><span>Allowed downtime / year</span><span>${f(down * 365 * 1440)}</span><span>Allowed downtime / week</span><span>${f(down * 7 * 1440)}</span><span>Error budget (failed requests / month)</span><span>${Math.round(r * down).toLocaleString()}</span><span>Two such services in series</span><span>${(100 * (t / 100) ** 2).toFixed(4)}% combined</span><span>Three in series</span><span>${(100 * (t / 100) ** 3).toFixed(4)}% combined</span></div>`;
    }
    w.querySelectorAll('input').forEach((i) => i.addEventListener('input', run)); run();
  }

  /* AWS monthly cost sketch (illustrative list prices; see chapter for verification) */
  function awscost(container, opts) {
    const w = shell(container, 'Small-production AWS cost sketch (us-east-1, illustrative)', 'cost');
    const items = [
      { k: 'alb', name: 'Application Load Balancer (hourly + minimal LCUs)', unit: 'month', price: 22, qty: 1 },
      { k: 'nat', name: 'NAT Gateway (hourly, excluding data)', unit: 'gateway', price: 32.4, qty: 1 },
      { k: 'natdata', name: 'NAT Gateway data processed', unit: 'GB', price: 0.045, qty: 100 },
      { k: 'fargate', name: 'Fargate task 0.5 vCPU / 1 GB, always on', unit: 'task', price: 21.6, qty: 2 },
      { k: 'ec2', name: 'EC2 t3.small on-demand (2 vCPU / 2 GB)', unit: 'instance', price: 15.2, qty: 0 },
      { k: 'rds', name: 'RDS PostgreSQL db.t4g.micro single-AZ', unit: 'instance', price: 11.7, qty: 1 },
      { k: 'rdsmaz', name: 'RDS Multi-AZ uplift (roughly doubles instance cost)', unit: 'instance', price: 11.7, qty: 0 },
      { k: 'ebs', name: 'gp3 storage', unit: 'GB', price: 0.08, qty: 40 },
      { k: 's3', name: 'S3 Standard storage', unit: 'GB', price: 0.023, qty: 50 },
      { k: 'egress', name: 'Internet data transfer out (after 100 GB free)', unit: 'GB', price: 0.09, qty: 200 },
      { k: 'cw', name: 'CloudWatch Logs ingested', unit: 'GB', price: 0.50, qty: 10 },
      { k: 'secrets', name: 'Secrets Manager secrets', unit: 'secret', price: 0.40, qty: 5 },
      { k: 'r53', name: 'Route 53 hosted zone', unit: 'zone', price: 0.50, qty: 1 },
    ];
    w.innerHTML = `<div style="font-size:13px;color:var(--fg-muted)">Edit quantities. Prices are approximate public on-demand rates for us-east-1 at the time of writing; always confirm with the AWS Pricing Calculator before quoting a client.</div><div id="ac-rows" style="display:grid;gap:4px;font-size:13px"></div><div class="out" id="ac-out"></div>`;
    const rowsEl = w.querySelector('#ac-rows'), out = w.querySelector('#ac-out');
    function draw() {
      rowsEl.innerHTML = items.map((it, i) => `<div style="display:grid;grid-template-columns:1fr 80px 110px;gap:8px;align-items:center"><span>${esc(it.name)} <span style="color:var(--fg-faint)">$${it.price}/${it.unit}</span></span><input type="number" data-i="${i}" value="${it.qty}" min="0" style="min-width:0"><span style="text-align:right;font-family:var(--font-mono)">$${(it.price * it.qty).toFixed(2)}</span></div>`).join('');
      const total = items.reduce((a, it) => a + it.price * it.qty, 0);
      const nat = items.filter((i) => i.k.startsWith('nat')).reduce((a, it) => a + it.price * it.qty, 0);
      out.innerHTML = `<div class="kv"><span>Estimated monthly total</span><span><b>$${total.toFixed(2)}</b></span><span>Of which NAT Gateway</span><span>$${nat.toFixed(2)} (${total ? Math.round((nat / total) * 100) : 0}%) — the classic surprise line item for small deployments</span><span>Yearly</span><span>$${(total * 12).toFixed(0)}</span></div>`;
    }
    rowsEl.addEventListener('input', (e) => { items[+e.target.dataset.i].qty = +e.target.value || 0; draw(); });
    draw();
  }

  return { cidr, chmod, jwt, hash, capacity, latency, slo, awscost };
})();
