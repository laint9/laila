// Chẩn đoán: thử các nguồn giá công khai từ máy chạy GitHub để chọn nguồn dùng được.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
async function probe(url, opts = {}) {
  const t = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000), headers: { 'User-Agent': UA, 'Accept-Language': 'vi-VN,vi;q=0.9', ...(opts.headers || {}) } });
    const txt = await r.text();
    const i = Math.max(0, txt.search(/999|SJC|price|close/i));
    console.log(`\n### ${r.status} ${txt.length}B ${Date.now() - t}ms ${url}\n${txt.slice(0, 300).replace(/\s+/g, ' ')}\n... ${txt.slice(i, i + 500).replace(/\s+/g, ' ')}`);
  } catch (e) { console.log(`\n### ERR ${url} ${e.cause?.code || e.message}`); }
}
const urls = [
  'https://xaus.com/api/v1/history',
  'https://query2.finance.yahoo.com/v8/finance/chart/GC=F?range=1mo&interval=1d',
  'https://stooq.com/q/d/l/?s=xauusd&i=d',
  'https://sjc.com.vn/xml/tygiavang.xml',
  'https://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1llcg9t45hnoh8hmn7t5kc2v',
  'http://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1llcg9t45hnoh8hmn7t5kc2v',
  'https://giavang.doji.vn/api/giavang/?api_key=258fbd2a72ce8481089d88c678e9fe4f',
  'https://www.mihong.vn/vi/gia-vang-trong-nuoc',
  'https://simplize.vn/gia-vang/mi-hong',
  'https://webgia.com/gia-vang/mi-hong/',
  'https://cafef.vn/du-lieu/gia-vang-hom-nay/trong-nuoc.chn',
];
for (const u of urls) await probe(u);
await probe('https://sjc.com.vn/GoldPrice/Services/PriceService.ashx', { method: 'POST', body: 'method=GetCurrentGoldPrices', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://sjc.com.vn/', Origin: 'https://sjc.com.vn' } });
