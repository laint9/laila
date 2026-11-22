import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNum, toVndPerLuong, parseSjc, parseBtmc, parseDoji, parseVcbUsd, genericItems, parseRss,
  upsertDaily, pushIntraday, ruleAnalysis, shouldNotify, isTrusted, OZ_PER_LUONG,
} from './lib.mjs';

const REF = 150_000_000; // giá tham chiếu đồng/lượng

test('parseNum đọc định dạng số Việt Nam', () => {
  assert.equal(parseNum('148.000.000'), 148000000);
  assert.equal(parseNum('14,800'), 14800);
  assert.equal(parseNum(' 15 200 '), 15200);
  assert.ok(Number.isNaN(parseNum('—')));
});

test('toVndPerLuong tự nhận đơn vị', () => {
  assert.equal(toVndPerLuong(14800, REF), 148_000_000);       // nghìn đồng/chỉ
  assert.equal(toVndPerLuong(14_800_000, REF), 148_000_000);  // đồng/chỉ
  assert.equal(toVndPerLuong(148_000, REF), 148_000_000);     // nghìn đồng/lượng
  assert.equal(toVndPerLuong(148_000_000, REF), 148_000_000); // đồng/lượng
  assert.equal(toVndPerLuong(5, REF), null);
  assert.equal(toVndPerLuong(14800), 148_000_000); // không có tham chiếu
});

test('OZ_PER_LUONG đúng', () => assert.ok(Math.abs(OZ_PER_LUONG - 1.20565) < 1e-4));

test('parseSjc chỉ lấy chi nhánh HCM', () => {
  const j = { success: true, data: [
    { TypeName: 'Vàng SJC 1L, 10L, 1KG', BranchName: 'Hồ Chí Minh', BuyValue: 148000000, SellValue: 150000000 },
    { TypeName: 'Vàng SJC 1L, 10L, 1KG', BranchName: 'Hà Nội', BuyValue: 148000000, SellValue: 150020000 },
    { TypeName: 'Vàng nhẫn SJC 99,99%', BranchName: 'Hồ Chí Minh', BuyValue: 146000000, SellValue: 148500000 },
  ] };
  const items = parseSjc(j, REF);
  assert.equal(items.length, 2);
  assert.equal(items[0].sell, 150000000);
});

test('parseBtmc', () => {
  const j = { DataList: { Data: [
    { '@row': '1', '@n_1': 'VÀNG MIẾNG VRTL', '@h_1': '999.9', '@pb_1': '14700000', '@ps_1': '15000000' },
    { '@row': '2', '@n_2': 'NHẪN TRÒN TRƠN', '@h_2': '999.9', '@pb_2': '14650000', '@ps_2': '14950000' },
  ] } };
  const items = parseBtmc(j, REF);
  assert.equal(items.length, 2);
  assert.equal(items[0].buy, 147_000_000);
  assert.match(items[1].name, /NHẪN/);
});

test('parseDoji', () => {
  const x = `<GoldList><DGPlist><Row Name="SJC - Bán Lẻ" Key="a" Sell="15,000" Buy="14,800" /><Row Name="Nhẫn Tròn 9999" Key="b" Sell="14,950" Buy="14,700"/></DGPlist></GoldList>`;
  const items = parseDoji(x, REF);
  assert.deepEqual(items.map(i => i.sell), [150_000_000, 149_500_000]);
});

test('parseVcbUsd', () => {
  assert.equal(parseVcbUsd('<ExrateList><Exrate CurrencyCode="USD" CurrencyName="US DOLLAR" Buy="26,050.00" Transfer="26,080.00" Sell="26,420.00" /></ExrateList>'), 26420);
});

test('genericItems đọc bảng HTML', () => {
  const html = `<table><tr><th>Loại</th><th>Mua</th><th>Bán</th></tr>
  <tr><td>Vàng 999</td><td>14.700.000</td><td>14.950.000</td></tr>
  <tr><td>Vàng 610</td><td>8.000.000</td><td>8.500.000</td></tr></table>`;
  const items = genericItems(html, /999/, REF);
  assert.equal(items.length, 1);
  assert.equal(items[0].sell, 149_500_000);
});

test('parseRss bỏ tên nguồn khỏi tiêu đề', () => {
  const x = `<rss><channel><item><title>Gold hits record - Reuters</title><link>https://x</link><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item></channel></rss>`;
  const [n] = parseRss(x);
  assert.equal(n.title, 'Gold hits record');
  assert.equal(n.source, 'Reuters');
  assert.ok(isTrusted(n.source));
  assert.ok(!isTrusted('Blog vàng ABC'));
});

test('upsertDaily ghi đè cùng ngày, thêm ngày mới', () => {
  let s = upsertDaily([], '2026-11-20', [1]);
  s = upsertDaily(s, '2026-11-20', [2]);
  s = upsertDaily(s, '2026-11-21', [3]);
  s = upsertDaily(s, '2026-11-19', [0]);
  assert.deepEqual(s, [['2026-11-19', 0], ['2026-11-20', 2], ['2026-11-21', 3]]);
});

test('pushIntraday giữ 48 giờ', () => {
  const t = Date.UTC(2026, 10, 21);
  const s = pushIntraday([[t - 50 * 3600e3, 1], [t - 1000, 2]], t, [3]);
  assert.deepEqual(s.map(r => r[1]), [2, 3]);
});

test('ruleAnalysis tạo lý do có nhãn sự thật / nhận định', () => {
  const a = ruleAnalysis({ worldPct: 1.2, drivers: { dxy: { pct: -0.5 }, us10y: { chg: -0.08, value: 4.1 } }, premium: 12e6, premiumPrev: 10e6 });
  assert.equal(a.direction, 'up');
  assert.ok(a.reasons.some(r => r.kind === 'su_that'));
  assert.ok(a.reasons.some(r => /USD/.test(r.title) && r.kind === 'nhan_dinh'));
  assert.ok(a.reasons.some(r => /nới rộng/.test(r.detail)));
});

test('shouldNotify', () => {
  const cfg = { worldPct: 0.8, vndPerLuong: 500000, dailySummaryHourVN: 8 };
  const now = new Date(Date.UTC(2026, 10, 21, 2)); // 9h sáng VN
  const state = { lastNotify: { world: 4000, sjc: 150e6 }, lastDailySummary: '2026-11-21' };
  assert.deepEqual(shouldNotify({ state, now, worldPrice: 4010, sjcSell: 150.2e6, cfg }), []);
  assert.deepEqual(shouldNotify({ state, now, worldPrice: 4040, sjcSell: 150.6e6, cfg }), ['world', 'sjc']);
  assert.deepEqual(shouldNotify({ state: { ...state, lastDailySummary: '2026-11-20' }, now, worldPrice: 4000, sjcSell: 150e6, cfg }), ['daily']);
});

test('genericItems bỏ qua cột khu vực và tên có chữ số (bảng kiểu Webgia)', () => {
  const html = `<table><tr><th>Khu vực</th><th>Loại vàng</th><th>Mua vào</th><th>Bán ra</th></tr>
  <tr><th rowspan="3">Hồ Chí Minh</th><td>Vàng SJC 1L, 10L, 1KG</td><td>12.850.000</td><td>13.350.000</td></tr>
  <tr><td>Bạc 999</td><td>1.492.000</td><td>1.557.000</td></tr></table>`;
  const items = genericItems(html, /vàng|SJC/i, REF);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Vàng SJC 1L, 10L, 1KG');
  assert.equal(items[0].buy, 128_500_000);
  assert.equal(items[0].sell, 133_500_000);
});
