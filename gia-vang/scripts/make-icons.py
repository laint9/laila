# Tạo icon app: nền tối, thỏi vàng, chữ 999.9
from PIL import Image, ImageDraw, ImageFont
import os, sys
out = sys.argv[1] if len(sys.argv) > 1 else 'web/icons'
os.makedirs(out, exist_ok=True)
S = 1024
img = Image.new('RGB', (S, S), (18, 17, 15))
d = ImageDraw.Draw(img)
for i in range(S):  # nền chuyển sắc nhẹ
    c = int(18 + 22 * i / S)
    d.line([(0, i), (S, i)], fill=(c + 6, c + 2, c - 4))
top, bot = 430, 690
d.polygon([(300, top), (724, top), (840, bot), (184, bot)], fill=(214, 164, 52))
d.polygon([(300, top), (724, top), (690, top + 50), (334, top + 50)], fill=(244, 206, 112))
d.polygon([(724, top), (840, bot), (790, bot), (690, top + 50)], fill=(170, 124, 30))
font = None
for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']:
    if os.path.exists(f): font = ImageFont.truetype(f, 120); break
font = font or ImageFont.load_default()
t = '999.9'
w = d.textlength(t, font=font)
d.text(((S - w) / 2, 520), t, fill=(92, 62, 8), font=font)
small = ImageFont.truetype(font.path, 92) if hasattr(font, 'path') else font
t2 = 'GIÁ VÀNG'
w2 = d.textlength(t2, font=small)
d.text(((S - w2) / 2, 240), t2, fill=(236, 200, 110), font=small)
for size in (180, 192, 512):
    img.resize((size, size), Image.LANCZOS).save(f'{out}/icon-{size}.png')
print('ok')
