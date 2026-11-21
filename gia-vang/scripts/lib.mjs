// Các hàm thuần (không gọi mạng) để dễ kiểm thử.

export const OZ_PER_LUONG = 37.5 / 31.1034768; // 1 lượng = 37,5 g; 1 troy oz = 31,1035 g

/** "148.000.000", "148,000", "14 800" -> số. Trả về NaN nếu không đọc được. */
export function parseNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  const s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  return Number(s.replace(/[.,]/g, ''));
}

/**
 * Các nguồn trả giá theo nhiều đơn vị (nghìn đồng/chỉ, đồng/chỉ, đồng/lượng...).
 * Chọn hệ số nhân đưa giá về gần giá thế giới quy đổi (đồng/lượng) nhất.
 * Trả về null nếu không hệ số nào hợp lý (lệch quá 0,6–1,6 lần).
 */
export function toVndPerLuong(value, refVndPerLuong) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const scales = [1, 10, 100, 1000, 10000, 100000];
  if (!refVndPerLuong) {
    // Không có giá tham chiếu: giả định giá vàng trong khoảng 50–500 triệu/lượng
    for (const s of scales) { const x = value * s; if (x >= 5e7 && x <= 5e8) return x; }
    return null;
  }
  let best = null, bestErr = Infinity;
  for (const s of scales) {
    const err = Math.abs(Math.log((value * s) / refVndPerLuong));
    if (err < bestErr) { bestErr = err; best = value * s; }
  }
  const ratio = best / refVndPerLuong;
  return ratio > 0.6 && ratio < 1.6 ? best : null;
}

/** Ngày theo giờ Việt Nam, dạng YYYY-MM-DD */
export function vnDate(d = new Date()) {
  return new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
}
export function vnHour(d = new Date()) {
  return new Date(d.getTime() + 7 * 3600e3).getUTCHours();
}

function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Tách bảng HTML thành mảng dòng, mỗi dòng là mảng ô (chữ thuần). */
export function htmlTableRows(html) {
  const rows = [];
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  for (const tr of body.split(/<\/tr>/i)) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

/** Bộ đọc chung: tìm các dòng có tên khớp regex và lấy 2 số đầu tiên (mua, bán). */
export function genericItems(html, matchRe, ref) {
  const items = [];
  for (const cells of htmlTableRows(html)) {
    const name = cells[0];
    if (!matchRe.test(cells.join(' '))) continue;
    const nums = cells.slice(1).map(parseNum).filter(n => Number.isFinite(n) && n >= 1000);
    if (nums.length < 2) continue;
    const buy = toVndPerLuong(nums[0], ref), sell = toVndPerLuong(nums[1], ref);
    if (buy && sell) items.push({ name, buy, sell });
  }
  return items;
}

/** SJC: JSON từ PriceService.ashx (method=GetCurrentGoldPrices) */
export function parseSjc(json, ref) {
  const list = json?.data || json?.Data || [];
  const items = [];
  for (const r of list) {
    const branch = r.BranchName || '';
    if (branch && !/Hồ Chí Minh|HCM/i.test(branch)) continue;
    const buy = toVndPerLuong(parseNum(r.BuyValue ?? r.Buy), ref);
    const sell = toVndPerLuong(parseNum(r.SellValue ?? r.Sell), ref);
    if (buy && sell) items.push({ name: r.TypeName, buy, sell });
  }
  return items;
}

/** Bảo Tín Minh Châu: JSON {DataList:{Data:[{"@n_1":..,"@pb_1":..,"@ps_1":..,"@h_1":..}]}} */
export function parseBtmc(json, ref) {
  const list = json?.DataList?.Data || json?.Data || [];
  const items = [];
  for (const r of list) {
    const get = p => { const k = Object.keys(r).find(k => k.startsWith(p)); return k ? r[k] : undefined; };
    const name = [get('@n_'), get('@h_')].filter(Boolean).join(' ').trim();
    const buy = toVndPerLuong(parseNum(get('@pb_')), ref);
    const sell = toVndPerLuong(parseNum(get('@ps_')), ref);
    if (name && buy && sell) items.push({ name, buy, sell });
  }
  return items;
}

/** DOJI: XML <Row Name=".." Sell=".." Buy=".."/> */
export function parseDoji(xml, ref) {
  const items = [];
  const seen = new Set();
  for (const m of xml.matchAll(/<Row\b([^>]*)\/?>/gi)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1].toLowerCase(), decodeEntities(a[2])]));
    const name = attrs.name;
    if (!name || seen.has(name)) continue;
    const buy = toVndPerLuong(parseNum(attrs.buy), ref);
    const sell = toVndPerLuong(parseNum(attrs.sell), ref);
    if (buy && sell) { items.push({ name, buy, sell }); seen.add(name); }
  }
  return items;
}

/** Vietcombank tỷ giá XML -> giá bán USD */
export function parseVcbUsd(xml) {
  const m = xml.match(/<Exrate[^>]*CurrencyCode="USD"[^>]*>/i);
  if (!m) return null;
  const sell = m[0].match(/Sell="([^"]+)"/i);
  const v = sell ? parseFloat(sell[1].replace(/,/g, '')) : NaN;
  return v > 10000 && v < 60000 ? v : null;
}

/** Chọn mặt hàng đại diện của thương hiệu (ưu tiên vàng 999.9 / SJC miếng). */
export function pickMain(items, prefer = []) {
  for (const re of prefer) { const it = items.find(i => re.test(i.name)); if (it) return it; }
  return items[0] || null;
}

/** RSS (Google News) -> [{title, link, source, date}] */
export function parseRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    const tag = t => { const x = it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i')); return x ? decodeEntities(x[1].replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : ''; };
    let title = tag('title');
    const source = tag('source');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    out.push({ title, link: tag('link'), source, date: tag('pubDate') });
  }
  return out;
}

export const TRUSTED_SOURCES = [
  'Reuters', 'Bloomberg', 'CNBC', 'Kitco', 'The Wall Street Journal', 'WSJ', 'Financial Times', 'MarketWatch',
  'Associated Press', 'AP News', 'World Gold Council', 'Barron', 'Investing.com', 'Yahoo Finance', 'Nikkei', 'The Economist',
  'VnExpress', 'Tuổi Trẻ', 'Thanh Niên', 'CafeF', 'VnEconomy', 'Vietnam+', 'VietnamPlus', 'Báo Đầu tư', 'Người Lao Động',
  'Dân trí', 'Znews', 'Lao Động', 'Tiền Phong', 'Nhân Dân', 'VTV', 'Thời báo Ngân hàng', 'Vietstock', 'Báo Chính phủ', 'VietNamNet',
];
export function isTrusted(source) {
  const s = (source || '').toLowerCase();
  return TRUSTED_SOURCES.some(t => s.includes(t.toLowerCase()));
}

/** Ghi giá trị cuối ngày vào chuỗi theo ngày [[date, ...values]], giữ tối đa maxDays. */
export function upsertDaily(series, date, values, maxDays = 400) {
  const s = series ? [...series] : [];
  const last = s[s.length - 1];
  if (last && last[0] === date) s[s.length - 1] = [date, ...values];
  else if (!last || last[0] < date) s.push([date, ...values]);
  else {
    const i = s.findIndex(r => r[0] === date);
    if (i >= 0) s[i] = [date, ...values]; else { s.push([date, ...values]); s.sort((a, b) => a[0] < b[0] ? -1 : 1); }
  }
  return s.slice(-maxDays);
}

/** Chuỗi trong ngày [[ts, ...values]] giữ 48 giờ gần nhất. */
export function pushIntraday(series, ts, values, keepMs = 48 * 3600e3) {
  const s = (series || []).filter(r => r[0] >= ts - keepMs && r[0] !== ts);
  s.push([ts, ...values]);
  return s;
}

export function pct(a, b) { return Number.isFinite(a) && Number.isFinite(b) && b ? ((a - b) / b) * 100 : null; }

/** Giá trị gần nhất trước ngày date trong chuỗi theo ngày */
export function prevDaily(series, date) {
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) if (series[i][0] < date) return series[i];
  return null;
}

const fmtPct = x => (x > 0 ? '+' : '') + x.toFixed(2) + '%';
const fmtTr = v => (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' triệu';

/**
 * Phân tích theo quy tắc (dùng khi không có khoá Claude API, hoặc làm khung dữ kiện cho Claude).
 * Mỗi ý ghi rõ loại: 'su_that' (số liệu đo được) hoặc 'nhan_dinh' (cách thị trường thường diễn giải).
 */
export function ruleAnalysis(ctx) {
  const { worldPct, drivers = {}, sjcChange, premium, premiumPrev, usdvndPct } = ctx;
  const reasons = [];
  const dir = worldPct == null ? 'flat' : worldPct > 0.15 ? 'up' : worldPct < -0.15 ? 'down' : 'flat';

  if (worldPct != null) reasons.push({
    kind: 'su_that', title: `Vàng thế giới ${fmtPct(worldPct)} so với phiên trước`,
    detail: 'Giá vàng trong nước thường đi theo hướng của giá thế giới, có độ trễ vài giờ và biên độ nhỏ hơn.',
  });
  const d = drivers;
  if (d.dxy?.pct != null && Math.abs(d.dxy.pct) >= 0.15) reasons.push({
    kind: 'nhan_dinh', title: `Đồng USD (DXY) ${fmtPct(d.dxy.pct)}`,
    detail: d.dxy.pct > 0
      ? 'USD mạnh lên làm vàng đắt hơn với người mua dùng tiền tệ khác, thường gây áp lực giảm lên giá vàng.'
      : 'USD yếu đi khiến vàng rẻ hơn với người mua ngoài Mỹ, thường hỗ trợ giá vàng tăng.',
  });
  if (d.us10y?.chg != null && Math.abs(d.us10y.chg) >= 0.03) reasons.push({
    kind: 'nhan_dinh', title: `Lợi suất trái phiếu Mỹ 10 năm ${d.us10y.chg > 0 ? 'tăng' : 'giảm'} ${Math.abs(d.us10y.chg).toFixed(2)} điểm % (còn ${d.us10y.value.toFixed(2)}%)`,
    detail: d.us10y.chg > 0
      ? 'Vàng không trả lãi. Lợi suất tăng làm chi phí cơ hội của việc giữ vàng cao hơn, dòng tiền dễ chuyển sang trái phiếu.'
      : 'Lợi suất giảm làm giảm chi phí cơ hội giữ vàng, thường hỗ trợ giá vàng.',
  });
  if (d.oil?.pct != null && Math.abs(d.oil.pct) >= 1.5) reasons.push({
    kind: 'nhan_dinh', title: `Giá dầu WTI ${fmtPct(d.oil.pct)}`,
    detail: 'Dầu biến động mạnh làm thay đổi kỳ vọng lạm phát. Kỳ vọng lạm phát cao hơn thường có lợi cho vàng.',
  });
  if (d.spx?.pct != null && Math.abs(d.spx.pct) >= 1) reasons.push({
    kind: 'nhan_dinh', title: `Chứng khoán Mỹ (S&P 500) ${fmtPct(d.spx.pct)}`,
    detail: d.spx.pct < 0
      ? 'Chứng khoán giảm mạnh thường kéo theo nhu cầu tài sản trú ẩn như vàng (nhưng đôi khi nhà đầu tư cũng bán vàng để bù lỗ).'
      : 'Chứng khoán tăng mạnh cho thấy khẩu vị rủi ro cao, nhu cầu trú ẩn vào vàng có thể giảm.',
  });
  if (usdvndPct != null && Math.abs(usdvndPct) >= 0.1) reasons.push({
    kind: 'su_that', title: `Tỷ giá USD/VND (Vietcombank) ${fmtPct(usdvndPct)}`,
    detail: 'Tỷ giá tăng làm giá vàng thế giới quy ra tiền đồng cao hơn, đẩy giá trong nước lên dù giá USD không đổi.',
  });
  if (premium != null) reasons.push({
    kind: 'su_that', title: `SJC đang cao hơn giá thế giới quy đổi ${fmtTr(premium)}/lượng`,
    detail: (premiumPrev != null && Math.abs(premium - premiumPrev) >= 3e5
      ? `Chênh lệch ${premium > premiumPrev ? 'nới rộng' : 'thu hẹp'} ${fmtTr(Math.abs(premium - premiumPrev))} so với hôm trước. `
      : '') + 'Chênh lệch này phản ánh cung cầu trong nước và chính sách quản lý vàng miếng, không phụ thuộc hoàn toàn vào thế giới.',
  });
  if (sjcChange != null && worldPct != null && Math.sign(sjcChange) !== Math.sign(worldPct) && Math.abs(sjcChange) >= 3e5) reasons.push({
    kind: 'nhan_dinh', title: 'Giá trong nước đi ngược thế giới',
    detail: 'Khi giá SJC đi ngược thế giới, nguyên nhân thường nằm ở cung cầu nội địa, điều chỉnh của doanh nghiệp hoặc thông tin chính sách từ Ngân hàng Nhà nước.',
  });
  return { direction: dir, reasons };
}

/** Quyết định có gửi thông báo không. */
export function shouldNotify({ state, now, worldPrice, sjcSell, cfg }) {
  const out = [];
  const last = state.lastNotify || {};
  if (Number.isFinite(worldPrice) && last.world) {
    const p = pct(worldPrice, last.world);
    if (Math.abs(p) >= cfg.worldPct) out.push('world');
  }
  if (Number.isFinite(sjcSell) && last.sjc && Math.abs(sjcSell - last.sjc) >= cfg.vndPerLuong) out.push('sjc');
  const today = vnDate(now);
  if (state.lastDailySummary !== today && vnHour(now) >= cfg.dailySummaryHourVN) out.push('daily');
  return out;
}
