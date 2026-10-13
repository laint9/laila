"""Icon CC Motion Editor: con ma xanh chanh phát sáng, mặt cười, vạt dưới gấp lượn sóng, nền tối.
Chạy: python3 scripts/make-icon.py  ->  build/icon.png (1024x1024, khung chuẩn macOS)"""
import math
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

S = 3
N = 1024 * S
PAD, SIZE = 100 * S, 824 * S


def sq(v):
    return v * S


def squircle(x0, y0, w, h, n=5.0, steps=900):
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        pts.append((x0 + w / 2 + math.copysign(abs(c) ** (2 / n), c) * w / 2,
                    y0 + h / 2 + math.copysign(abs(s) ** (2 / n), s) * h / 2))
    return pts


def bez(p0, p1, p2, p3, steps=80):
    out = []
    for i in range(steps + 1):
        t = i / steps
        a = (1 - t) ** 3
        b = 3 * (1 - t) ** 2 * t
        c = 3 * (1 - t) * t * t
        d = t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def P(x, y):
    return (sq(x), sq(y))


# ---------- hình con ma (toạ độ trên khung 1024) ----------
L, R = 268, 756          # mép trái / phải
CX, TOPY = 512, 168      # đỉnh đầu
RAD = (R - L) / 2
CY = TOPY + RAD          # tâm bán nguyệt
CREST = (556, 772)       # điểm vạt áo vồng lên giữa chân

body = []
for i in range(181):     # nửa trên tròn
    a = math.pi + math.pi * i / 180
    body.append(P(CX + RAD * math.cos(a), CY + RAD * math.sin(a)))
body += [P(R, 700)]
body += bez(P(R, 700), P(R, 800), P(R - 30, 832), P(R - 100, 830))[1:]                # thuỳ phải rủ xuống
body += bez(P(R - 100, 830), P(624, 828), P(596, 790), P(*CREST))[1:]                 # vạt đi lên
body += bez(P(*CREST), P(520, 750), P(450, 818), P(372, 814))[1:]                     # xuống thuỳ trái
body += bez(P(372, 814), P(306, 810), P(L, 792), P(L, 752))[1:]                       # vòng lên mép trái
body += [P(L, CY)]

# vạt gấp: phần tối ở nửa trái dưới, mép trên là đường cong lồi
fold = bez(P(L, 742), P(296, 692), P(470, 676), P(*CREST))
fold += bez(P(*CREST), P(520, 750), P(450, 818), P(372, 814))[1:]
fold += bez(P(372, 814), P(306, 810), P(L, 792), P(L, 752))[1:]

# ---------- nền ----------
img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
bg_mask = Image.new('L', (N, N), 0)
ImageDraw.Draw(bg_mask).polygon(squircle(PAD, PAD, SIZE, SIZE), fill=255)
bg = Image.new('RGBA', (N, N), (6, 9, 6, 255))
img.paste(bg, (0, 0), bg_mask)

# ---------- quầng sáng ----------
mask = Image.new('L', (N, N), 0)
ImageDraw.Draw(mask).polygon(body, fill=255)
ImageDraw.Draw(mask).polygon(fold, fill=255)
glow = mask.filter(ImageFilter.GaussianBlur(sq(70)))
glow_col = Image.new('RGBA', (N, N), (150, 210, 40, 0))
glow_col.putalpha(glow.point(lambda v: int(v * 0.55)))
glow_col.putalpha(ImageChops.multiply(glow_col.getchannel('A'), bg_mask))
img.alpha_composite(glow_col)

# ---------- thân: gradient tâm vàng chanh -> rìa xanh lá ----------
small = Image.new('RGB', (256, 256))
px = small.load()
for y in range(256):
    for x in range(256):
        dx, dy = (x - 118) / 150, (y - 120) / 175
        t = min(1.0, math.hypot(dx, dy))
        c0, c1 = (226, 246, 72), (112, 196, 38)
        px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * t ** 1.4) for i in range(3))
grad = small.resize((N, N), Image.BICUBIC).convert('RGBA')

body_mask = Image.new('L', (N, N), 0)
ImageDraw.Draw(body_mask).polygon(body, fill=255)
img.paste(grad, (0, 0), body_mask)

# vạt gấp: xanh đậm hơn, tối dần về mép dưới
fold_mask = Image.new('L', (N, N), 0)
ImageDraw.Draw(fold_mask).polygon(fold, fill=255)
fs = Image.new('RGB', (64, 64))
for y in range(64):
    for x in range(64):
        # sáng ở mép trên-phải của vạt, tối dần về góc trái dưới
        k = min(1.0, max(0.0, (y / 63) * 0.7 + (1 - x / 63) * 0.5 - 0.15))
        fs.putpixel((x, y), (int(126 - 62 * k), int(176 - 74 * k), int(42 - 20 * k)))
fold_img = fs.resize((N, N), Image.BICUBIC).convert('RGBA')
img.paste(fold_img, (0, 0), fold_mask)

# hạt nhiễu nhẹ trên thân (texture như hình mẫu)
random.seed(7)
noise = Image.effect_noise((N // 2, N // 2), 40).resize((N, N)).convert('L')
grain = Image.new('RGBA', (N, N), (255, 255, 230, 0))
grain.putalpha(ImageChops.multiply(noise.point(lambda v: max(0, v - 110) // 3), mask))
img.alpha_composite(grain)

# ---------- mặt cười ----------
d = ImageDraw.Draw(img)
face = (14, 20, 10, 255)
for ex in (462, 562):
    d.ellipse([sq(ex - 18), sq(318 - 18), sq(ex + 18), sq(318 + 18)], fill=face)
d.arc([sq(480), sq(334), sq(544), sq(386)], 25, 155, fill=face, width=sq(11))

out = img.resize((1024, 1024), Image.LANCZOS)
out.save('build/icon.png')
print('build/icon.png')
