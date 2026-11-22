// Chẩn đoán vòng 2: xem cấu trúc dữ liệu giá trên các trang tổng hợp công khai.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const get = async u => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': UA, 'Accept-Language': 'vi-VN,vi;q=0.9' } }); return [r.status, await r.text()]; } catch (e) { return ['ERR', String(e.cause?.code || e.message)]; } };
const show = (label, s) => console.log(`\n### ${label}\n${s}`);

for (const slug of ['sjc', 'bao-tin-minh-chau', 'doji', 'mi-hong']) {
  const url = `https://simplize.vn/gia-vang/${slug}`;
  const [st, html] = await get(url);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  show(`${st} ${url} nextdata=${m ? m[1].length : 0}`, '');
  if (!m) { show('raw', html.slice(0, 400)); continue; }
  const data = JSON.parse(m[1]);
  const pp = data.props?.pageProps || {};
  show('pageProps keys', Object.keys(pp).join(', '));
  // In các object có khoá giống giá
  const hits = [];
  (function walk(o, path) {
    if (hits.length > 6 || !o || typeof o !== 'object') return;
    if (!Array.isArray(o)) {
      const ks = Object.keys(o);
      if (ks.some(k => /buy|sell|mua|ban/i.test(k)) && ks.some(k => /price|buy/i.test(k))) { hits.push(path + ' => ' + JSON.stringify(o).slice(0, 500)); return; }
    }
    for (const k of Object.keys(o)) walk(o[k], path + '.' + k);
  })(pp, 'pp');
  show('hits', hits.join('\n'));
}
for (const url of ['https://cafef.vn/du-lieu/gia-vang-hom-nay/trong-nuoc.chn', 'https://webgia.com/gia-vang/mi-hong/']) {
  const [st, html] = await get(url);
  const i = html.search(/Mi Hồng|MIHONG|DOJI|Bảo Tín Minh Châu/i);
  show(`${st} ${url}`, html.slice(i, i + 1200).replace(/\s+/g, ' '));
  const t = html.search(/<table/i);
  show('table', html.slice(t, t + 1500).replace(/\s+/g, ' '));
}
const [st, x] = await get('https://xaus.com/api/v1/history');
show(`${st} xaus tail`, x.slice(-400));
