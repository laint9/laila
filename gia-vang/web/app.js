// Giá Vàng 999 – PWA cho iPhone. Không dùng thư viện ngoài.
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); Object.assign(e, attrs); if (html) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtTr = (v, d = 2) => Number.isFinite(v) ? (v / 1e6).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const fmtUsd = v => Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
const fmtPct = v => Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%' : '—';
const fmtDelta = v => !Number.isFinite(v) ? '' : v === 0 ? '0' : (v > 0 ? '+' : '−') + (Math.abs(v) >= 1e6 ? fmtTr(Math.abs(v)) + 'tr' : Math.round(Math.abs(v) / 1e3).toLocaleString('vi-VN') + 'k');
const cls = v => !Number.isFinite(v) || Math.abs(v) < 1e-9 ? 'flat' : v > 0 ? 'up' : 'down';
const arrow = v => cls(v) === 'up' ? '▲' : cls(v) === 'down' ? '▼' : '•';
const vnDate = (d = new Date()) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const dmy = s => s.split('-').reverse().slice(0, 2).join('/');
const store = {
  get(k, f) { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const S = { latest: null, history: null, analysis: null, config: {}, series: store.get('series', 'world'), range: store.get('range', '1d'), whyIdx: 0 };
const MANUAL_BRANDS = () => (S.latest?.brands || []).filter(b => b.status === 'manual');

async function getJson(path) {
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function load() {
  $('#refresh').classList.add('spin');
  try {
    const [latest, history, analysis, config] = await Promise.all([
      getJson('data/latest.json'), getJson('data/history.json'), getJson('data/analysis.json').catch(() => ({ items: [] })), getJson('data/config.json').catch(() => ({})),
    ]);
    Object.assign(S, { latest, history, analysis, config });
    store.set('cache', { latest, history, analysis });
  } catch (e) {
    const c = store.get('cache', null);
    if (c) Object.assign(S, c);
    else { $('#updated').textContent = 'Chưa có dữ liệu. Hệ thống sẽ cập nhật trong lần chạy đầu tiên.'; }
  }
  $('#refresh').classList.remove('spin');
  render();
}

function render() {
  if (!S.latest) return;
  const t = new Date(S.latest.updatedAt);
  const mins = Math.round((Date.now() - t) / 60000);
  $('#updated').textContent = `Cập nhật ${mins < 1 ? 'vừa xong' : mins < 60 ? mins + ' phút trước' : t.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`;
  renderWorld(); renderWhyMini(); renderBrands(); renderChips(); renderChart(); renderWhy(); renderSettings();
}

// ---------- Tổng quan ----------
function renderWorld() {
  const w = S.latest.world;
  if (!w) { $('#world').innerHTML = '<p class="muted">Chưa lấy được giá thế giới.</p>'; return; }
  const prem = S.latest.premiumSjc;
  $('#world').innerHTML = `
    <div class="label">Vàng thế giới · XAU/USD</div>
    <div class="big num">${fmtUsd(w.usdPerOz)}<small>USD/oz</small></div>
    <span class="pill ${cls(w.changePct)} num">${arrow(w.changePct)} ${fmtPct(w.changePct)}</span>
    <span class="sub"> so với phiên trước</span>
    <div class="grid">
      <div class="cell"><b class="num">${fmtTr(w.vndPerLuong)}</b><span>Quy đổi, triệu đ/lượng</span></div>
      <div class="cell"><b class="num">${prem != null ? fmtTr(prem) : '—'}</b><span>SJC đắt hơn thế giới</span></div>
    </div>`;
}

function renderWhyMini() {
  const a = S.latest.analysis;
  const box = $('#whyMini');
  if (!a) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div class="kicker">Vì sao hôm nay ${a.direction === 'up' ? 'tăng' : a.direction === 'down' ? 'giảm' : 'đi ngang'}</div>
    <div class="h">${esc(a.headline)}</div><p>${esc(a.summary)}</p><span class="more">Xem đủ lý do và nguồn tin ›</span>`;
  box.onclick = () => { S.whyIdx = 0; go('why'); };
}

function manualFor(id) { return store.get('manual', {})[id] || []; }

function renderBrands() {
  const list = $('#brands');
  list.innerHTML = '';
  const worldVnd = S.latest.world?.vndPerLuong;
  for (const b of S.latest.brands) {
    let main = b.main, change = b.change, badge = '';
    if (b.status === 'manual') {
      const m = manualFor(b.id);
      const last = m.at(-1), prev = m.at(-2);
      if (last) { main = { buy: last[1], sell: last[2], name: `Nhập tay ${dmy(last[0])}` }; change = prev ? { sell: last[2] - prev[2] } : null; }
      badge = '<span class="badge">nhập tay</span>';
    }
    if (b.stale) badge = '<span class="badge">giá cũ</span>';
    const row = el('div', { className: 'brand' + (main ? '' : ' off') });
    if (main) {
      const prem = worldVnd ? main.sell - worldVnd : null;
      row.innerHTML = `
        <div><div class="name">${esc(b.name)}${badge}</div><div class="item">${esc(main.name || '')}${prem != null ? ` · +${fmtTr(prem, 1)}tr so với TG` : ''}</div></div>
        <div class="col"><div class="l">Mua</div><div class="v num">${fmtTr(main.buy)}</div></div>
        <div class="col"><div class="l">Bán</div><div class="v num">${fmtTr(main.sell)}</div><div class="d num ${cls(change?.sell)}">${change ? fmtDelta(change.sell) : ''}</div></div>`;
      row.onclick = () => { S.series = b.id; store.set('series', b.id); go('chart'); };
    } else {
      const msg = b.status === 'manual' ? 'Chưa có giá · bấm để nhập' : 'Tạm thời không lấy được';
      row.innerHTML = `<div><div class="name">${esc(b.name)}${badge}</div><div class="item">${msg}</div></div><div class="col"></div><div class="col"><div class="v">—</div></div>`;
      if (b.status === 'manual') row.onclick = () => { go('settings'); $('#manualBrand').value = b.id; };
    }
    list.append(row);
  }
}

// ---------- Biểu đồ ----------
function seriesList() {
  const out = [{ id: 'world', name: 'Thế giới' }];
  for (const b of S.latest.brands) out.push({ id: b.id, name: b.name });
  return out;
}

function renderChips() {
  const box = $('#seriesChips');
  box.innerHTML = '';
  for (const s of seriesList()) {
    const c = el('button', { className: 'chip', textContent: s.name });
    c.setAttribute('aria-pressed', String(S.series === s.id));
    c.onclick = () => { S.series = s.id; store.set('series', s.id); renderChips(); renderChart(); };
    box.append(c);
  }
  for (const b of $('#rangeSeg').children) b.setAttribute('aria-selected', String(b.dataset.r === S.range));
}

function chartData() {
  const h = S.history || {};
  const isWorld = S.series === 'world';
  const isManual = MANUAL_BRANDS().some(b => b.id === S.series);
  const days = { '1m': 31, '3m': 92, '6m': 183 }[S.range];
  let rows, intraday = S.range === '1d';
  if (intraday) {
    const src = isWorld ? h.intraday?.world : h.intraday?.brands?.[S.series];
    const from = Date.now() - 24 * 3600e3;
    rows = (src || []).filter(r => r[0] >= from).map(r => [new Date(r[0]), ...r.slice(1)]);
    if (isManual) { rows = manualFor(S.series).slice(-7).map(r => [new Date(r[0]), r[1], r[2]]); intraday = false; }
  } else {
    const src = isWorld ? h.world : isManual ? manualFor(S.series) : h.brands?.[S.series];
    const cutoff = vnDate(new Date(Date.now() - days * 864e5));
    rows = (src || []).filter(r => r[0] >= cutoff).map(r => [new Date(r[0] + 'T00:00:00+07:00'), ...r.slice(1)]);
  }
  const lines = isWorld
    ? [{ name: 'XAU/USD', color: 'var(--s1)', vals: rows.map(r => r[1]) }]
    : [{ name: 'Bán ra', color: 'var(--s1)', vals: rows.map(r => r[2]) }, { name: 'Mua vào', color: 'var(--s2)', vals: rows.map(r => r[1]) }];
  return { dates: rows.map(r => r[0]), lines, isWorld, intraday };
}

function niceTicks(min, max, n = 4) {
  const span = max - min || Math.abs(max) * 0.01 || 1;
  const step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(v);
  return t;
}

function renderChart() {
  if (!S.latest) return;
  const box = $('#chart');
  const d = chartData();
  const name = seriesList().find(s => s.id === S.series)?.name || '';
  const fmtV = v => d.isWorld ? fmtUsd(v) : fmtTr(v);
  const unit = d.isWorld ? 'USD/oz' : 'triệu đ/lượng';
  $('#legend').innerHTML = d.lines.map(l => `<span><i style="background:${l.color}"></i>${l.name}</span>`).join('');
  const notes = { '1d': '24 giờ qua, mỗi điểm cách nhau khoảng 30 phút.', '1m': 'Giá chốt mỗi ngày.', '3m': 'Giá chốt mỗi ngày.', '6m': 'Giá chốt mỗi ngày.' };
  $('#chartNote').textContent = notes[S.range] + (d.isWorld ? '' : ' Lịch sử của các thương hiệu (trừ SJC) được tích luỹ từ ngày app bắt đầu chạy.');

  const main = d.lines[0].vals;
  const n = d.dates.length;
  const setHead = i => {
    const v = main[i];
    $('#chartVal').innerHTML = `<span class="num">${fmtV(v)}</span> <span class="sub">${unit}</span>`;
    const dt = d.dates[i];
    const when = d.intraday ? dt.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : dt.toLocaleDateString('vi-VN');
    const extra = d.lines[1] ? ` · Mua ${fmtV(d.lines[1].vals[i])}` : '';
    $('#chartSub').textContent = `${name} · ${when}${extra}`;
  };
  if (n < 2) {
    box.innerHTML = `<div class="empty">Chưa đủ dữ liệu cho khoảng thời gian này.<br>${S.range === '1d' ? 'Biểu đồ trong ngày cần ít nhất 2 lần cập nhật.' : 'Dữ liệu sẽ đầy dần theo từng ngày.'}</div>`;
    $('#chartStats').innerHTML = '';
    if (n === 1) setHead(0); else { $('#chartVal').textContent = '—'; $('#chartSub').textContent = name; }
    return;
  }
  setHead(n - 1);

  const W = box.clientWidth || 340, H = box.clientHeight || 240, padL = 6, padR = 48, padT = 26, padB = 22;
  const all = d.lines.flatMap(l => l.vals).filter(Number.isFinite);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const yMin = ticks[0], yMax = ticks.at(-1);
  const t0 = d.dates[0].getTime(), t1 = d.dates[n - 1].getTime();
  const x = i => padL + ((d.dates[i].getTime() - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = v => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  const path = vals => vals.map((v, i) => Number.isFinite(v) ? `${i && Number.isFinite(vals[i - 1]) ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}` : '').join('');
  const area = `${path(main)}L${x(n - 1)},${H - padB}L${x(0)},${H - padB}Z`;
  const xl = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  const xLabel = i => d.intraday ? d.dates[i].toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : `${String(d.dates[i].getDate()).padStart(2, '0')}/${String(d.dates[i].getMonth() + 1).padStart(2, '0')}`;
  const tickLabel = v => d.isWorld ? Math.round(v).toLocaleString('en-US') : (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 });

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ giá ${esc(name)}">
    <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--s1)" stop-opacity=".22"/><stop offset="1" stop-color="var(--s1)" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${ticks.map(t => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>
    <g class="axis">${ticks.map(t => `<text x="${W - padR + 6}" y="${y(t) + 4}">${tickLabel(t)}</text>`).join('')}
      ${xl.map(i => `<text x="${x(i)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${xLabel(i)}</text>`).join('')}</g>
    <path d="${area}" fill="url(#ga)"/>
    ${d.lines.slice().reverse().map(l => `<path d="${path(l.vals)}" fill="none" stroke="${l.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    <g id="cursor" style="display:none"><line id="cl" y1="${padT - 6}" y2="${H - padB}" stroke="var(--muted)" stroke-dasharray="3 3"/>${d.lines.map((l, k) => `<circle id="cd${k}" r="4.5" fill="${l.color}" stroke="var(--card)" stroke-width="2"/>`).join('')}</g>
  </svg><div class="tip" id="tip" style="display:none"></div>`;

  const svg = box.querySelector('svg'), cur = box.querySelector('#cursor'), tip = box.querySelector('#tip');
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const dd = Math.abs(x(i) - px); if (dd < bd) { bd = dd; best = i; } }
    cur.style.display = '';
    cur.querySelector('#cl').setAttribute('x1', x(best)); cur.querySelector('#cl').setAttribute('x2', x(best));
    d.lines.forEach((l, k) => { const c = cur.querySelector('#cd' + k); c.setAttribute('cx', x(best)); c.setAttribute('cy', y(l.vals[best])); });
    tip.style.display = ''; tip.style.left = Math.min(Math.max((x(best) / W) * r.width, 50), r.width - 50) + 'px';
    tip.textContent = `${xLabel(best)} · ${fmtV(main[best])}`;
    setHead(best);
  };
  const leave = () => { cur.style.display = 'none'; tip.style.display = 'none'; setHead(n - 1); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
  svg.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') leave(); });

  const valid = main.filter(Number.isFinite);
  const first = valid[0], last = valid.at(-1), hi = Math.max(...valid), lo = Math.min(...valid);
  const ch = last - first, chp = (ch / first) * 100;
  $('#chartStats').innerHTML = `
    <div><span>Thay đổi</span><b class="num ${cls(ch)}">${d.isWorld ? (ch > 0 ? '+' : '') + fmtUsd(ch) : fmtDelta(ch)}</b><span class="num ${cls(ch)}">${fmtPct(chp)}</span></div>
    <div><span>Cao nhất</span><b class="num">${fmtV(hi)}</b></div>
    <div><span>Thấp nhất</span><b class="num">${fmtV(lo)}</b></div>`;
}

// ---------- Lý do ----------
function renderWhy() {
  const items = S.analysis?.items || (S.latest.analysis ? [S.latest.analysis] : []);
  const box = $('#why');
  if (!items.length) { box.innerHTML = '<article class="card"><p class="muted">Chưa có phân tích. Phân tích được tạo sau lần cập nhật đầu tiên.</p></article>'; return; }
  const a = items[Math.min(S.whyIdx, items.length - 1)];
  const dayPick = items.slice(0, 14).map((x, i) => `<button class="chip" data-i="${i}" aria-pressed="${i === S.whyIdx}">${i === 0 && x.date === vnDate() ? 'Hôm nay' : dmy(x.date)} <span class="${cls(x.worldPct)}">${arrow(x.worldPct)}</span></button>`).join('');
  const reasons = (a.reasons || []).map(r => `
    <div class="reason">
      <span class="tag ${r.kind === 'su_that' ? 'fact' : 'opin'}">${r.kind === 'su_that' ? 'Sự thật' : 'Nhận định'}</span>
      <div class="t">${esc(r.title)}</div>
      <p class="d">${esc(r.detail)}</p>
      ${r.sources?.length ? `<div class="srcs">${r.sources.map(s => `<a class="src" href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.source)}: ${esc(s.title)}</a>`).join('')}</div>` : ''}
    </div>`).join('');
  const news = (a.news || []).map(n => `<a href="${esc(n.link)}" target="_blank" rel="noopener"><div class="s">${esc(n.source)} · ${n.date ? new Date(n.date).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''}</div><div class="h">${esc(n.title)}</div></a>`).join('');
  box.innerHTML = `
    <div class="day-pick">${dayPick}</div>
    <article class="card why-head">
      <div class="kicker">${dmy(a.date)} · Thế giới <span class="${cls(a.worldPct)}">${fmtPct(a.worldPct)}</span></div>
      <h3>${esc(a.headline)}</h3>
      <p class="muted">${esc(a.summary)}</p>
    </article>
    <h2 class="section">Lý do chính</h2>
    <div class="legendbox"><span><span class="tag fact">Sự thật</span> số liệu, sự kiện đã xảy ra</span><span><span class="tag opin">Nhận định</span> cách giới phân tích thường diễn giải</span></div>
    <article class="card">${reasons || '<p class="muted">Chưa xác định được lý do rõ ràng.</p>'}</article>
    ${a.domestic_note ? `<h2 class="section">Giá trong nước</h2><article class="card prose"><p>${esc(a.domestic_note)}</p></article>` : ''}
    ${a.watch_next?.length ? `<h2 class="section">Cần theo dõi tiếp</h2><article class="card prose"><ul class="watch">${a.watch_next.map(w => `<li>${esc(w)}</li>`).join('')}</ul></article>` : ''}
    ${news ? `<h2 class="section">Tin từ nguồn uy tín</h2><article class="card news">${news}</article>` : ''}
    <p class="foot">${a.engine === 'claude' ? 'Phần giải thích do AI (Claude) tổng hợp từ số liệu và các tin trên; hãy bấm vào nguồn để kiểm chứng.' : 'Phần giải thích tạo tự động từ số liệu thị trường theo quy tắc cố định.'} Không phải lời khuyên đầu tư.</p>`;
  box.querySelectorAll('.day-pick .chip').forEach(c => c.onclick = () => { S.whyIdx = +c.dataset.i; renderWhy(); });
}

// ---------- Cài đặt ----------
function renderSettings() {
  const n = S.config.notify || {};
  if (n.worldPct) $('#thrWorld').textContent = n.worldPct.toLocaleString('vi-VN') + '%';
  if (n.vndPerLuong) $('#thrVnd').textContent = (n.vndPerLuong / 1e3).toLocaleString('vi-VN') + ' nghìn';
  $('#topicName').textContent = S.config.topicHint || 'tên kênh anh đặt trong GitHub Secret NTFY_TOPIC';
  const sel = $('#manualBrand'), cur = sel.value;
  sel.innerHTML = MANUAL_BRANDS().map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  if (cur) sel.value = cur;
  const w = S.latest.world, fx = S.latest.usdvnd;
  $('#sources').innerHTML = `<p>Thế giới: ${esc(w?.source || '—')}. Tỷ giá: ${esc(fx?.source || '—')}${fx ? ` (${Math.round(fx.rate).toLocaleString('vi-VN')} đ/USD)` : ''}.</p>
    <p>${S.latest.brands.map(b => `${esc(b.name)}: ${b.status === 'ok' ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.via || b.url.replace(/^https?:\/\//, ''))}</a>${b.main?.at ? ` · niêm yết ${esc(b.main.at)}` : ''}${b.stale ? ' · giá cũ' : ''}` : b.status === 'manual' ? 'nhập tay' : 'lỗi lần cập nhật gần nhất'}`).join('<br>')}</p>
    <p>Giá trong nước lấy qua trang tổng hợp Simplize, dự phòng Webgia, vì trang gốc của các thương hiệu chặn máy chủ nước ngoài. Giá thế giới: gold-api.com, lịch sử: xaus.com.</p>
    <p>Tin tức: Google News, chỉ giữ các báo uy tín (Reuters, Bloomberg, CNBC, Kitco, VnExpress, CafeF, Tuổi Trẻ…).</p>`;
}

$('#manualForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const num = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  let buy = num(f.get('buy')), sell = num(f.get('sell'));
  // Cho phép nhập "148,5" (triệu) hoặc "148500000" (đồng)
  if (buy < 1e4) buy *= 1e6; if (sell < 1e4) sell *= 1e6;
  if (!(buy > 0 && sell >= buy)) { $('#manualMsg').textContent = 'Giá chưa hợp lệ (giá bán phải ≥ giá mua).'; return; }
  const all = store.get('manual', {});
  const id = f.get('brand'), today = vnDate();
  all[id] = (all[id] || []).filter(r => r[0] !== today).concat([[today, buy, sell]]).slice(-400);
  store.set('manual', all);
  $('#manualMsg').textContent = `Đã lưu ${fmtTr(buy)} / ${fmtTr(sell)} triệu cho hôm nay.`;
  e.target.reset(); $('#manualBrand').value = id;
  renderBrands();
});

// ---------- Điều hướng ----------
function go(tab) {
  document.querySelectorAll('.tab').forEach(t => t.toggleAttribute('data-active', t.id === 'tab-' + tab));
  document.querySelectorAll('#tabbar button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  $('#title').textContent = { home: 'Giá vàng', chart: 'Biểu đồ', why: 'Vì sao tăng giảm', settings: 'Cài đặt' }[tab];
  store.set('tab', tab);
  if (tab === 'chart') { renderChips(); renderChart(); }
  if (tab === 'why') renderWhy();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('#tabbar button').forEach(b => b.onclick = () => go(b.dataset.tab));
document.querySelectorAll('#rangeSeg button').forEach(b => b.onclick = () => { S.range = b.dataset.r; store.set('range', S.range); renderChips(); renderChart(); });
$('#refresh').onclick = load;
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderChart, 150); });
setInterval(load, 5 * 60e3);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
go(store.get('tab', 'home'));
load();
