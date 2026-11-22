// Chẩn đoán vòng 3: chốt cấu trúc giá trên CafeF, Webgia, Simplize.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const get = async u => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': UA, 'Accept-Language': 'vi-VN,vi;q=0.9' } }); return [r.status, await r.text()]; } catch (e) { return ['ERR', String(e.cause?.code || e.message)]; } };
const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// CafeF: mỗi dòng có logo thương hiệu + tên + giá mua + giá bán
{
  const [st, html] = await get('https://cafef.vn/du-lieu/gia-vang-hom-nay/trong-nuoc.chn');
  console.log('### cafef', st);
  const seen = {};
  for (const tr of html.split(/<\/tr>/i)) {
    const logo = tr.match(/Images\/Gold\/([\w-]+)\.svg/)?.[1];
    const name = tr.match(/content_item_name_loai_vang[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const buy = tr.match(/item_gia_mua"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const sell = tr.match(/item_gia_ban"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    if (!logo || !name) continue;
    seen[logo] = (seen[logo] || 0) + 1;
    if (seen[logo] <= 4) console.log(`${logo} | ${strip(name)} | ${strip(buy || '')} | ${strip(sell || '')}`);
  }
  const ids = [...html.matchAll(/id="(content_luong_vang_\w+)"/g)].map(m => m[1]);
  console.log('tables:', ids.join(','));
  const tabs = [...html.matchAll(/class="[^"]*tab[^"]*"[^>]*>([^<]{2,40})</g)].map(m => m[1].trim()).slice(0, 30);
  console.log('tabs:', tabs.join(' | '));
}
// Webgia: 3 dòng đầu mỗi bảng
for (const s of ['sjc', 'doji', 'bao-tin-minh-chau', 'mi-hong']) {
  const [st, html] = await get(`https://webgia.com/gia-vang/${s}/`);
  const rows = [...html.matchAll(/<tr>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].slice(0, 5)
    .map(m => `${strip(m[1])} | ${strip(m[2])} | ${strip(m[3])}`);
  const upd = html.match(/Cập nhật[^<]{0,80}/)?.[0];
  console.log(`\n### webgia ${s} ${st} ${upd || ''}\n${rows.join('\n')}`);
}
// Simplize: một mục đầy đủ
{
  const [st, html] = await get('https://simplize.vn/gia-vang/sjc');
  const d = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const L = d.props.pageProps.listData;
  console.log(`\n### simplize sjc ${st} items=${L.length}\n${JSON.stringify(L[0])}`);
  console.log(L.map(x => x.name).join(' | '));
}
