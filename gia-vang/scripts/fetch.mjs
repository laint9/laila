// Lấy giá vàng, cập nhật lịch sử, phân tích lý do và gửi thông báo.
// Chạy: node scripts/fetch.mjs  (GitHub Actions chạy mỗi 30 phút)
// Biến môi trường (đều tuỳ chọn):
//   ANTHROPIC_API_KEY  – bật phần giải thích bằng Claude (không có thì dùng phân tích theo quy tắc)
//   NTFY_TOPIC         – tên kênh ntfy để đẩy thông báo về iPhone
//   APP_URL            – địa chỉ app, gắn vào thông báo để bấm mở
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OZ_PER_LUONG, parseNum, toVndPerLuong, vnDate, genericItems, parseSjc, parseBtmc, parseDoji, parseVcbUsd,
  pickMain, parseRss, isTrusted, upsertDaily, pushIntraday, pct, prevDaily, ruleAnalysis, shouldNotify,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '..', 'web', 'data');
const cfg = JSON.parse(await fs.readFile(path.join(here, 'sources.json'), 'utf8'));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const now = new Date();
const today = vnDate(now);
const log = (...a) => console.log('[gia-vang]', ...a);

async function http(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 20000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'vi,en;q=0.8', ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally { clearTimeout(t); }
}
const json = async (url, opts) => JSON.parse(await http(url, opts));
async function readJson(name, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(DATA, name), 'utf8')); } catch { return fallback; }
}
async function writeJson(name, obj) {
  await fs.writeFile(path.join(DATA, name), JSON.stringify(obj, null, name === 'history.json' ? 0 : 2));
}

// ---------- Thế giới ----------
async function worldSpot() {
  try {
    const j = await json('https://api.gold-api.com/price/XAU');
    if (j.price > 500) return { price: j.price, source: 'gold-api.com', at: j.updatedAt };
  } catch (e) { log('gold-api lỗi:', e.message); }
  const y = await yahoo('GC=F', '5d', '1d');
  return { price: y.last, source: 'Yahoo Finance (hợp đồng tương lai GC=F)', at: new Date().toISOString() };
}

async function yahoo(symbol, range = '1mo', interval = '1d') {
  const j = await json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`);
  const r = j.chart.result[0];
  const closes = r.indicators.quote[0].close;
  const rows = r.timestamp.map((t, i) => [vnDate(new Date(t * 1000)), closes[i]]).filter(x => Number.isFinite(x[1]));
  const meta = r.meta;
  return { rows, last: meta.regularMarketPrice ?? rows.at(-1)?.[1], prevClose: meta.chartPreviousClose ?? meta.previousClose };
}

async function worldHistory() {
  // Ưu tiên giá giao ngay XAU/USD từ Stooq, dự phòng bằng hợp đồng tương lai trên Yahoo
  try {
    const csv = await http('https://stooq.com/q/d/l/?s=xauusd&i=d');
    const rows = csv.trim().split('\n').slice(1).map(l => l.split(',')).map(c => [c[0], +c[4]]).filter(r => /^\d{4}-/.test(r[0]) && r[1] > 0);
    if (rows.length > 30) return { rows: rows.slice(-400), source: 'Stooq XAU/USD' };
  } catch (e) { log('stooq lỗi:', e.message); }
  const y = await yahoo('GC=F', '2y', '1d');
  return { rows: y.rows.slice(-400), source: 'Yahoo GC=F' };
}

async function drivers() {
  const out = {};
  const sym = { dxy: 'DX-Y.NYB', us10y: '^TNX', oil: 'CL=F', spx: '^GSPC' };
  await Promise.all(Object.entries(sym).map(async ([k, s]) => {
    try {
      const y = await yahoo(s, '5d', '1d');
      const value = y.last, prev = y.prevClose ?? y.rows.at(-2)?.[1];
      out[k] = { value, prev, pct: pct(value, prev), chg: value - prev };
    } catch (e) { log(`yahoo ${s} lỗi:`, e.message); }
  }));
  return out;
}

async function usdVnd() {
  try {
    const v = parseVcbUsd(await http('https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx'));
    if (v) return { rate: v, source: 'Vietcombank (giá bán)' };
  } catch (e) { log('VCB lỗi:', e.message); }
  const j = await json('https://open.er-api.com/v6/latest/USD');
  return { rate: j.rates.VND, source: 'open.er-api.com' };
}

// ---------- Trong nước ----------
const PREFER = {
  sjc: [/SJC.*1L/i, /miếng/i],
  btmc: [/VRTL|Rồng Thăng Long.*miếng/i, /999\.9/],
  doji: [/SJC/i, /9999|99\.99|999\.9/],
  mihong: [/999/, /SJC/i],
};
const NHAN = /nhẫn|nhan|ring/i;

/** Tìm trong JSON bất kỳ các object có tên + giá mua + giá bán */
function walkJsonItems(obj, ref, acc = []) {
  if (Array.isArray(obj)) { obj.forEach(o => walkJsonItems(o, ref, acc)); return acc; }
  if (obj && typeof obj === 'object') {
    const keys = Object.keys(obj);
    const k = re => keys.find(x => re.test(x));
    const nk = k(/^(name|code|title|type|typename|goldtype|product)/i);
    const bk = k(/^(buy|buying|mua|purchase)/i), sk = k(/^(sell|selling|ban|sale)/i);
    if (nk && bk && sk) {
      const buy = toVndPerLuong(parseNum(obj[bk]), ref), sell = toVndPerLuong(parseNum(obj[sk]), ref);
      if (buy && sell) acc.push({ name: String(obj[nk]), buy, sell });
    }
    keys.forEach(x => typeof obj[x] === 'object' && walkJsonItems(obj[x], ref, acc));
  }
  return acc;
}

const FETCHERS = {
  async sjc(ref) {
    const body = 'method=GetCurrentGoldPrices';
    const j = await json('https://sjc.com.vn/GoldPrice/Services/PriceService.ashx', {
      method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://sjc.com.vn/' },
    });
    return { items: parseSjc(j, ref), url: 'https://sjc.com.vn' };
  },
  async btmc(ref) {
    // Khoá công khai do BTMC cung cấp cho widget giá
    const j = await json('http://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1llcg9t45hnoh8hmn7t5kc2v');
    return { items: parseBtmc(j, ref), url: 'https://btmc.vn' };
  },
  async doji(ref) {
    const x = await http('http://giavang.doji.vn/api/giavang/?api_key=258fbd2a72ce8481089d88c678e9fe4f');
    return { items: parseDoji(x, ref), url: 'https://giavang.doji.vn' };
  },
  async mihong(ref) {
    const tries = [
      ['json', 'https://www.mihong.vn/api/v1/gold/prices/current'],
      ['html', 'https://www.mihong.vn/vi/gia-vang-trong-nuoc'],
      ['html', 'https://www.mihong.vn/'],
    ];
    let lastErr;
    for (const [kind, url] of tries) {
      try {
        const t = await http(url);
        const items = kind === 'json' ? walkJsonItems(JSON.parse(t), ref) : genericItems(t, /999|SJC|98[05]|vàng/i, ref);
        if (items.length) return { items, url: 'https://www.mihong.vn' };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Không đọc được bảng giá Mi Hồng');
  },
};

async function fetchBrand(b, ref) {
  if (b.mode === 'manual') return { id: b.id, name: b.name, status: 'manual', items: [] };
  try {
    let r;
    if (b.mode === 'html' && b.url) r = { items: genericItems(await http(b.url), new RegExp(b.match || '999', 'i'), ref), url: b.url };
    else r = await FETCHERS[b.id](ref);
    if (!r.items.length) throw new Error('Không tìm thấy dòng giá hợp lệ');
    const main = pickMain(r.items, PREFER[b.id] || [/999/]);
    const ring = r.items.find(i => NHAN.test(i.name) && /99/.test(i.name)) || null;
    return { id: b.id, name: b.name, status: 'ok', url: r.url, main, ring, items: r.items.slice(0, 12) };
  } catch (e) {
    log(`${b.name} lỗi:`, e.message);
    return { id: b.id, name: b.name, status: 'error', error: e.message, items: [] };
  }
}

async function sjcBackfill(history, ref) {
  if ((history.brands.sjc || []).length >= 60) return;
  try {
    const d = n => { const x = new Date(now.getTime() - n * 864e5); return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`; };
    const body = `method=GetGoldPriceHistory&goldPriceId=1&fromDate=${d(190)}&toDate=${d(0)}`;
    const j = await json('https://sjc.com.vn/GoldPrice/Services/PriceService.ashx', {
      method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://sjc.com.vn/' },
    });
    let s = history.brands.sjc || [];
    for (const r of j.data || []) {
      const ms = +String(r.GroupDate || r.CreateDate || '').match(/\d{10,}/)?.[0];
      const buy = toVndPerLuong(parseNum(r.BuyValue), ref), sell = toVndPerLuong(parseNum(r.SellValue), ref);
      if (ms && buy && sell) s = upsertDaily(s, vnDate(new Date(ms)), [buy, sell]);
    }
    history.brands.sjc = s;
    log('Đã nạp lịch sử SJC:', s.length, 'ngày');
  } catch (e) { log('Nạp lịch sử SJC lỗi:', e.message); }
}

// ---------- Tin tức ----------
async function news() {
  const feeds = [
    'https://news.google.com/rss/search?q=gold+price+when:2d&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=gi%C3%A1+v%C3%A0ng+when:2d&hl=vi&gl=VN&ceid=VN:vi',
    'https://news.google.com/rss/search?q=Fed+OR+%22US+dollar%22+OR+inflation+when:1d&hl=en-US&gl=US&ceid=US:en',
  ];
  const all = [];
  for (const f of feeds) { try { all.push(...parseRss(await http(f))); } catch (e) { log('RSS lỗi:', e.message); } }
  const seen = new Set();
  return all.filter(n => n.title && isTrusted(n.source) && !seen.has(n.title) && seen.add(n.title))
    .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 25);
}

// ---------- Claude ----------
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['headline', 'direction', 'summary', 'reasons', 'domestic_note', 'watch_next'],
  properties: {
    headline: { type: 'string', description: 'Một câu, dưới 90 ký tự' },
    direction: { type: 'string', enum: ['up', 'down', 'flat'] },
    summary: { type: 'string', description: '2-3 câu dễ hiểu cho người không chuyên' },
    reasons: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['title', 'detail', 'kind', 'sources'],
        properties: {
          title: { type: 'string' }, detail: { type: 'string' },
          kind: { type: 'string', enum: ['su_that', 'nhan_dinh'] },
          sources: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
    domestic_note: { type: 'string', description: 'Vì sao giá trong nước khác/đi theo thế giới' },
    watch_next: { type: 'array', items: { type: 'string' } },
  },
};

async function claudeAnalysis(facts, newsList) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const prompt = `Bạn là chuyên viên phân tích thị trường vàng, viết cho người Việt bận rộn, không chuyên tài chính.
Dựa trên SỐ LIỆU và DANH SÁCH TIN dưới đây, giải thích vì sao giá vàng hôm nay (${today}) tăng/giảm.

Quy tắc:
- Chỉ dùng thông tin có trong số liệu và tin. Không bịa sự kiện, con số hay nguồn.
- Mỗi lý do ghi kind="su_that" nếu là dữ kiện đã xảy ra (có số liệu hoặc tin xác nhận), kind="nhan_dinh" nếu là cách giới phân tích diễn giải.
- "sources" là chỉ số [n] của tin liên quan trong danh sách; để rỗng nếu lý do chỉ dựa trên số liệu.
- 3-5 lý do, xếp theo mức ảnh hưởng. Mỗi "detail" 1-3 câu, văn phong đời thường, tiếng Việt có dấu.
- Nếu không đủ căn cứ để biết lý do, nói thẳng là chưa rõ.

SỐ LIỆU:
${JSON.stringify(facts, null, 1)}

TIN (nguồn uy tín, 48 giờ qua):
${newsList.map((n, i) => `[${i}] ${n.source} – ${n.title} (${n.date})`).join('\n')}`;
  try {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') { log('Claude từ chối:', res.stop_details?.category); return null; }
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const out = JSON.parse(text);
    out.reasons = out.reasons.map(r => ({ ...r, sources: r.sources.filter(i => newsList[i]).map(i => newsList[i]) }));
    out.engine = 'claude';
    return out;
  } catch (e) {
    log('Claude lỗi:', e.message);
    return null;
  }
}

// ---------- Thông báo ----------
async function ntfy({ title, message, tags = [], priority = 3 }) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  try {
    await http(process.env.NTFY_SERVER || 'https://ntfy.sh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, title, message, tags, priority, click: process.env.APP_URL || undefined }),
    });
    log('Đã gửi thông báo:', title);
  } catch (e) { log('ntfy lỗi:', e.message); }
}

const tr = v => (v / 1e6).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + 'tr';
const sgn = x => (x > 0 ? '+' : x < 0 ? '−' : '±');

// ---------- Chạy ----------
await fs.mkdir(DATA, { recursive: true });
const history = await readJson('history.json', { world: [], usdvnd: [], brands: {}, intraday: { world: [], brands: {} } });
history.brands ||= {}; history.intraday ||= { world: [], brands: {} }; history.intraday.brands ||= {};
const analyses = await readJson('analysis.json', { items: [] });
const state = await readJson('state.json', {});
const prevLatest = await readJson('latest.json', null);

const [spotR, histR, fxR, drvR, newsR] = await Promise.allSettled([worldSpot(), worldHistory(), usdVnd(), drivers(), news()]);
const spot = spotR.status === 'fulfilled' ? spotR.value : null;
const fx = fxR.status === 'fulfilled' ? fxR.value : (prevLatest?.usdvnd || null);
const drv = drvR.status === 'fulfilled' ? drvR.value : {};
const newsList = newsR.status === 'fulfilled' ? newsR.value : [];
if (histR.status === 'fulfilled') {
  for (const [d, v] of histR.value.rows) if (d < today) history.world = upsertDaily(history.world, d, [v]);
}
if (!spot) log('Không lấy được giá thế giới:', spotR.reason?.message);

const worldVnd = spot && fx ? spot.price * OZ_PER_LUONG * fx.rate : null;
const brands = (await Promise.all(cfg.brands.map(b => fetchBrand(b, worldVnd || prevLatest?.world?.vndPerLuong)))).map(b => {
  // Lỗi tạm thời: giữ giá lần trước (đánh dấu stale) thay vì để trống
  const old = prevLatest?.brands?.find(x => x.id === b.id);
  if (b.status === 'error' && old?.main) return { ...old, stale: true, staleSince: old.staleSince || prevLatest.updatedAt, error: b.error };
  return b;
});
await sjcBackfill(history, worldVnd);

const ts = now.getTime();
if (spot) {
  history.world = upsertDaily(history.world, today, [spot.price]);
  history.intraday.world = pushIntraday(history.intraday.world, ts, [spot.price]);
}
if (fx) history.usdvnd = upsertDaily(history.usdvnd, today, [fx.rate]);
for (const b of brands) {
  if (b.status !== 'ok' || b.stale) continue;
  history.brands[b.id] = upsertDaily(history.brands[b.id], today, [b.main.buy, b.main.sell]);
  history.intraday.brands[b.id] = pushIntraday(history.intraday.brands[b.id], ts, [b.main.buy, b.main.sell]);
}

const prevWorld = prevDaily(history.world, today)?.[1];
const worldPct = spot ? pct(spot.price, prevWorld) : null;
const sjc = brands.find(b => b.id === 'sjc' && b.status === 'ok');
const sjcPrev = prevDaily(history.brands.sjc, today);
const sjcChange = sjc && sjcPrev ? sjc.main.sell - sjcPrev[2] : null;
const premium = sjc && worldVnd ? sjc.main.sell - worldVnd : null;
const prevFx = prevDaily(history.usdvnd, today)?.[1];
const prevWorldVnd = prevWorld && prevFx ? prevWorld * OZ_PER_LUONG * prevFx : null;
const premiumPrev = sjcPrev && prevWorldVnd ? sjcPrev[2] - prevWorldVnd : null;
const usdvndPct = fx ? pct(fx.rate, prevFx) : null;

for (const b of brands) {
  if (b.status !== 'ok') continue;
  const p = prevDaily(history.brands[b.id], today);
  b.change = p ? { buy: b.main.buy - p[1], sell: b.main.sell - p[2] } : null;
}

const latest = {
  updatedAt: now.toISOString(),
  world: spot ? { usdPerOz: spot.price, changePct: worldPct, prevClose: prevWorld, vndPerLuong: worldVnd, source: spot.source } : prevLatest?.world || null,
  usdvnd: fx, premiumSjc: premium, drivers: drv, brands,
};

// Phân tích: tối đa mỗi 3 giờ, hoặc sớm hơn nếu giá thế giới đã chạy ≥0,5% kể từ lần phân tích trước
const lastA = analyses.items[0];
const needAnalysis = !lastA || lastA.date !== today || Date.now() - new Date(lastA.at).getTime() > 3 * 3600e3
  || (spot && lastA.worldPrice && Math.abs(pct(spot.price, lastA.worldPrice)) >= 0.5);
if (needAnalysis && spot) {
  const facts = {
    gia_the_gioi_usd_oz: spot.price, thay_doi_so_voi_phien_truoc_pct: worldPct,
    gia_the_gioi_quy_doi_vnd_luong: Math.round(worldVnd || 0),
    ty_gia_usdvnd: fx?.rate, thay_doi_ty_gia_pct: usdvndPct,
    sjc_ban_ra: sjc?.main.sell, sjc_thay_doi_vnd: sjcChange, chenh_lech_sjc_vs_the_gioi: premium && Math.round(premium),
    chi_so_usd_dxy: drv.dxy, loi_suat_my_10_nam: drv.us10y, dau_wti: drv.oil, sp500: drv.spx,
    thuong_hieu: brands.filter(b => b.status === 'ok').map(b => ({ ten: b.name, mua: b.main.buy, ban: b.main.sell, thay_doi: b.change })),
  };
  const rule = ruleAnalysis({ worldPct, drivers: drv, sjcChange, premium, premiumPrev, usdvndPct });
  const ai = await claudeAnalysis(facts, newsList);
  const a = ai || {
    engine: 'rules', direction: rule.direction,
    headline: worldPct == null ? 'Chưa đủ dữ liệu so sánh' : `Vàng thế giới ${worldPct > 0 ? 'tăng' : worldPct < 0 ? 'giảm' : 'đi ngang'} ${Math.abs(worldPct).toFixed(2)}%`,
    summary: 'Tóm tắt tự động từ số liệu thị trường. Đọc thêm các tin bên dưới để biết bối cảnh.',
    reasons: rule.reasons.map(r => ({ ...r, sources: [] })),
    domestic_note: '', watch_next: ['Biên bản/phát biểu của Fed', 'Chỉ số lạm phát CPI Mỹ', 'Diễn biến tỷ giá USD/VND'],
  };
  a.date = today; a.at = now.toISOString(); a.worldPrice = spot.price; a.worldPct = worldPct;
  a.news = newsList.slice(0, 12);
  analyses.items = [a, ...analyses.items.filter(x => x.date !== today)].slice(0, 90);
}
latest.analysis = analyses.items[0] || null;

// Thông báo
const sjcSell = sjc?.main.sell;
state.lastNotify ||= {};
if (!state.lastNotify.world && spot) state.lastNotify.world = spot.price;
if (!state.lastNotify.sjc && sjcSell) state.lastNotify.sjc = sjcSell;
const triggers = shouldNotify({ state, now, worldPrice: spot?.price, sjcSell, cfg: cfg.notify });
if (triggers.length) {
  const a = latest.analysis;
  const lines = [];
  if (spot) lines.push(`Thế giới: ${spot.price.toLocaleString('en-US', { maximumFractionDigits: 1 })} USD/oz (${worldPct != null ? sgn(worldPct) + Math.abs(worldPct).toFixed(2) + '%' : '—'})`);
  for (const b of brands.filter(b => b.status === 'ok').slice(0, 4)) {
    lines.push(`${b.name}: ${tr(b.main.buy)} / ${tr(b.main.sell)}${b.change ? ` (${sgn(b.change.sell)}${tr(Math.abs(b.change.sell))})` : ''}`);
  }
  if (a?.reasons?.[0]) lines.push(`Lý do chính: ${a.reasons[0].title}`);
  const daily = triggers.includes('daily') && triggers.length === 1;
  await ntfy({
    title: daily ? `Giá vàng sáng ${today.split('-').reverse().slice(0, 2).join('/')}` : (a?.headline || 'Giá vàng biến động mạnh'),
    message: lines.join('\n'),
    tags: [worldPct > 0 ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend'],
    priority: daily ? 3 : 4,
  });
  if (spot) state.lastNotify.world = spot.price;
  if (sjcSell) state.lastNotify.sjc = sjcSell;
  if (triggers.includes('daily')) state.lastDailySummary = today;
}

await writeJson('latest.json', latest);
await writeJson('history.json', history);
await writeJson('analysis.json', analyses);
await writeJson('state.json', state);
await writeJson('config.json', { notify: cfg.notify });
log('Xong.', spot ? `XAU ${spot.price}` : 'không có giá TG', `| ${brands.filter(b => b.status === 'ok').length}/${brands.length} thương hiệu`);
