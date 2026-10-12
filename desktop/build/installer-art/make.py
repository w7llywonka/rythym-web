#!/usr/bin/env python3
"""Draws the Line Rush installer art. Re-run it after changing anything here:

    python3 desktop/build/installer-art/make.py

Writes into desktop/build/:
  installerSidebar.bmp    164x314  Windows installer: welcome and finish pages
  uninstallerSidebar.bmp  164x314  Windows uninstaller: welcome and finish pages
  installerHeader.bmp     150x57   Windows installer: the band at the top of the other pages
  dmg-background.png      540x380  macOS: the window you drag the app out of
  dmg-background@2x.png   1080x760 (the same for Retina screens)
  icons/16x16.png ... icons/512x512.png  Linux: the app icon at the sizes desktops look for (from icon.png)

Needs Pillow (pip install pillow). Uses the Inter / Inter Display fonts when they're installed and falls
back to DejaVu Sans or Pillow's own font when they aren't. The output is the same on every run.
"""
import random
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent
SS = 4  # everything is drawn this many times larger, then scaled down (smooth edges)

# the game's colors (src/config.ts, T)
BG = (8, 8, 10)
BG2 = (14, 14, 18)
LINE = (37, 37, 46)
TEXT = (244, 244, 246)
MUTED = (138, 138, 151)
CYAN = (43, 212, 255)
PINK = (255, 92, 168)
GOLD = (245, 196, 81)


# ---- fonts ----
FONT_FILES = {
    'display': ('Inter Display:black', ['InterDisplay-Black.otf', 'Inter-Black.otf', 'DejaVuSans-Bold.ttf']),
    'black': ('Inter:black', ['Inter-Black.otf', 'InterDisplay-Black.otf', 'DejaVuSans-Bold.ttf']),
    'bold': ('Inter:bold', ['Inter-Bold.otf', 'DejaVuSans-Bold.ttf']),
    'semibold': ('Inter:semibold', ['Inter-SemiBold.otf', 'Inter-Medium.otf', 'DejaVuSans.ttf']),
}
FONT_DIRS = ['/usr/share/fonts', '/usr/local/share/fonts', str(Path.home() / '.fonts'),
             str(Path.home() / '.local/share/fonts'), '/Library/Fonts', '/System/Library/Fonts',
             'C:/Windows/Fonts']
_font_paths = {}


def font_path(kind):
    if kind in _font_paths:
        return _font_paths[kind]
    pattern, names = FONT_FILES[kind]
    found = None
    if shutil.which('fc-match'):  # ask fontconfig, but only take the answer if it's the font we asked for
        try:
            p = subprocess.run(['fc-match', '-f', '%{file}', pattern], capture_output=True, text=True, timeout=10).stdout
            if Path(p).name in names[:2]:
                found = p
        except (OSError, subprocess.SubprocessError):
            pass
    for name in ([] if found else names):
        for d in FONT_DIRS:
            hits = sorted(Path(d).rglob(name)) if Path(d).is_dir() else []
            if hits:
                found = str(hits[0])
                break
        if found:
            break
    if not found:
        print(f'  ! no font for {kind}, using Pillow\'s own')
    _font_paths[kind] = found
    return found


def font(kind, px):
    p = font_path(kind)
    return ImageFont.truetype(p, round(px * SS)) if p else ImageFont.load_default(round(px * SS))


# ---- drawing helpers (coordinates are in final pixels; SS is applied here) ----
def s(v):
    return round(v * SS)


def canvas(w, h, color=BG):
    return Image.new('RGBA', (w * SS, h * SS), color + (255,))


def layer(img):
    return Image.new('RGBA', img.size, (0, 0, 0, 0))


def over(img, top):
    img.alpha_composite(top)


def add_glow(img, top, radius, strength=1.0):
    """Light: blur a layer and screen it onto the picture (black adds nothing)."""
    blurred = top.filter(ImageFilter.GaussianBlur(radius * SS))
    rgb = Image.new('RGB', img.size, (0, 0, 0))
    rgb.paste(blurred, mask=blurred.getchannel('A'))
    if strength != 1.0:
        rgb = rgb.point(lambda v: min(255, round(v * strength)))
    lit = ImageChops.screen(img.convert('RGB'), rgb)
    img.paste(lit)


def radial(img, cx, cy, r, color, alpha):
    """A soft round light."""
    top = layer(img)
    d = ImageDraw.Draw(top)
    d.ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=color + (alpha,))
    add_glow(img, top, r * 0.45)


def text_width(text, f, tracking=0.0):
    w = 0.0
    for i, ch in enumerate(text):
        w += f.getlength(ch) + (tracking * f.size if i < len(text) - 1 else 0)
    return w / SS


def draw_text(img, x, y, text, f, fill, tracking=0.0, anchor='ls'):
    """Text with letter spacing (tracking in em). x, y: left end of the baseline."""
    d = ImageDraw.Draw(img)
    cx = s(x)
    for ch in text:
        d.text((cx, s(y)), ch, font=f, fill=fill, anchor=anchor)
        cx += f.getlength(ch) + tracking * f.size


def gradient_text(img, x, y, text, f, c1, c2, tracking=0.0):
    """Text filled with a left-to-right gradient (the game's RUSH)."""
    mask = Image.new('L', img.size, 0)
    d = ImageDraw.Draw(mask)
    cx = s(x)
    for ch in text:
        d.text((cx, s(y)), ch, font=f, fill=255, anchor='ls')
        cx += f.getlength(ch) + tracking * f.size
    x0, x1 = s(x), cx
    grad = Image.new('RGBA', img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for px in range(max(0, x0), min(img.size[0], int(x1) + 1)):
        t = (px - x0) / max(1, x1 - x0)
        gd.line([(px, 0), (px, img.size[1])], fill=mix(c1, c2, t) + (255,))
    grad.putalpha(mask)
    over(img, grad)


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def wordmark(img, cx, y, size, stacked=False, glow=0.0, tracking=-0.02):
    """LINE in white, RUSH in the cyan-to-pink gradient. y is the baseline (of RUSH when stacked)."""
    f = font('display', size)
    wl, wr = text_width('LINE', f, tracking), text_width('RUSH', f, tracking)
    if stacked:
        cap = size * 0.73
        spots = [(cx - wl / 2, y - cap - size * 0.16), (cx - wr / 2, y)]
    else:
        gap = size * 0.24
        left = cx - (wl + gap + wr) / 2
        spots = [(left, y), (left + wl + gap, y)]
    if glow:
        top = layer(img)
        draw_text(top, *spots[0], 'LINE', f, TEXT + (110,), tracking)
        gradient_text(top, *spots[1], 'RUSH', f, CYAN, PINK, tracking)
        add_glow(img, top, size * 0.22, glow)
    draw_text(img, *spots[0], 'LINE', f, TEXT + (255,), tracking)
    gradient_text(img, *spots[1], 'RUSH', f, CYAN, PINK, tracking)
    return spots


def round_rect(d, box, r, **kw):
    d.rounded_rectangle([s(box[0]), s(box[1]), s(box[2]), s(box[3])], radius=s(r), **kw)


def fade_rows(top, y0, y1, reverse=False):
    """Fade a layer's alpha in from y0 (clear) to y1 (solid)."""
    a = top.getchannel('A')
    ramp = Image.new('L', top.size, 255)
    rd = ImageDraw.Draw(ramp)
    for py in range(top.size[1]):
        t = (py - s(y0)) / max(1, s(y1) - s(y0))
        t = min(1.0, max(0.0, t))
        if reverse:
            t = 1 - t
        rd.line([(0, py), (top.size[0], py)], fill=round(255 * t * t * (3 - 2 * t)))
    top.putalpha(ImageChops.multiply(a, ramp))


def note(img, x0, x1, y, color, h=4.0, trail=18.0, alpha=255, glow=1.0):
    """A falling line: a bright bar with a light trail above it (it's moving down) and a glow."""
    tr = layer(img)
    td = ImageDraw.Draw(tr)
    for i in range(s(trail)):  # the trail: fades out upwards
        t = 1 - i / s(trail)
        td.line([(s(x0 + 1), s(y) - i), (s(x1 - 1), s(y) - i)], fill=color + (round(alpha * 0.30 * t * t),))
    over(img, tr)
    bar = layer(img)
    bd = ImageDraw.Draw(bar)
    round_rect(bd, (x0, y - h / 2, x1, y + h / 2), h / 2, fill=color + (alpha,))
    if glow:
        add_glow(img, bar, 5, 0.9 * glow * alpha / 255)
    over(img, bar)
    core = layer(img)  # a whiter core makes it read as light
    round_rect(ImageDraw.Draw(core), (x0 + 3, y - h / 5, x1 - 3, y + h / 5), h / 5,
               fill=mix(color, (255, 255, 255), 0.55) + (round(alpha * 0.8),))
    over(img, core)


def dither_and_save(img, w, h, path, fmt):
    small = img.convert('RGB').resize((w, h), Image.LANCZOS)
    # a little noise so the dark gradients don't band (seeded: same file every run)
    rnd = random.Random(f'{path.name}')
    noise = Image.frombytes('L', (w, h), bytes(rnd.choice((0, 1, 1, 2)) for _ in range(w * h)))
    small = ImageChops.add(small, Image.merge('RGB', (noise, noise, noise)), offset=-1)
    if fmt == 'BMP':
        small.save(path, 'BMP')  # 24-bit, uncompressed: what NSIS reads
    else:
        small.save(path, 'PNG', optimize=True, dpi=(144, 144) if '@2x' in path.name else (72, 72))
    print(f'  {path.relative_to(OUT.parent)}  {w}x{h}')


# ---- the pictures ----
def lanes_scene(img, x0, lane_w, gap, top, hit_y, notes, keys=True, hit_flash=None):
    """The two-lane playfield: lanes fading in from the top, lines falling, the bright hit bar,
    and the two buttons (F and J) under it."""
    lanes = [(x0, x0 + lane_w), (x0 + lane_w + gap, x0 + 2 * lane_w + gap)]
    bottom = img.size[1] / SS + 4
    field = layer(img)
    fd = ImageDraw.Draw(field)
    for (a, b), color in zip(lanes, (CYAN, PINK)):
        round_rect(fd, (a, top, b, bottom), 7, fill=mix(BG2, color, 0.035) + (255,), outline=LINE + (255,), width=s(1))
    fade_rows(field, top, top + 70)
    over(img, field)
    for lane, y, color, alpha in notes:
        a, b = lanes[lane]
        note(img, a + 5, b - 5, y, color, alpha=alpha)
    # hit bar: a white line with each lane's color glowing round it
    hb = layer(img)
    hd = ImageDraw.Draw(hb)
    for (a, b), color in zip(lanes, (CYAN, PINK)):
        round_rect(hd, (a + 2, hit_y - 1.5, b - 2, hit_y + 1.5), 1.5, fill=color + (255,))
    add_glow(img, hb, 6, 1.0)
    over(img, hb)
    core = layer(img)
    cd = ImageDraw.Draw(core)
    for a, b in lanes:
        round_rect(cd, (a + 4, hit_y - 0.6, b - 4, hit_y + 0.6), 0.6, fill=(255, 255, 255, 235))
    over(img, core)
    if hit_flash is not None:  # a line just got hit in this lane
        a, b = lanes[hit_flash]
        color = (CYAN, PINK)[hit_flash]
        fl = layer(img)
        ImageDraw.Draw(fl).ellipse([s(a - 4), s(hit_y - 12), s(b + 4), s(hit_y + 12)], fill=color + (150,))
        add_glow(img, fl, 9, 0.8)
    if keys:
        pads = layer(img)
        pd = ImageDraw.Draw(pads)
        f = font('black', lane_w * 0.30)
        for (a, b), color, key in zip(lanes, (CYAN, PINK), 'FJ'):
            round_rect(pd, (a + 3, hit_y + 7, b - 3, hit_y + 7 + lane_w * 0.62), 6,
                       fill=mix(BG, color, 0.12) + (255,), outline=mix(BG, color, 0.38) + (255,), width=s(1))
            # centred on the capital's height, not the font's (J would sit low)
            cap = f.getbbox('F', anchor='ls')[1] / SS
            pd.text((s((a + b) / 2), s(hit_y + 7 + lane_w * 0.31 - cap / 2)), key, font=f, fill=color + (255,), anchor='ms')
        over(img, pads)
    return lanes


def sidebar(uninstall=False):
    W, H = 164, 314
    img = canvas(W, H)
    radial(img, 30, 210, 70, CYAN, 26 if not uninstall else 16)
    radial(img, 140, 250, 70, PINK, 26 if not uninstall else 16)
    radial(img, 82, 60, 80, (60, 60, 90), 20)
    # wordmark + tagline
    wordmark(img, W / 2, 84, 41, stacked=True, glow=0.55)
    tag = font('semibold', 10.5)
    line = 'Two buttons. Real beats.' if not uninstall else 'Thanks for playing.'
    draw_text(img, W / 2 - text_width(line, tag, 0.01) / 2, 106, line, tag, MUTED + (255,), 0.01)
    if not uninstall:
        notes = [(0, 150, CYAN, 120), (1, 176, PINK, 200), (0, 206, GOLD, 255), (1, 206, GOLD, 255), (0, 238, CYAN, 255)]
        lanes_scene(img, 29, 50, 6, 126, 262, notes, hit_flash=1)
    else:  # quieter: the lanes are clear, one last line resting on the hit bar
        notes = [(1, 190, PINK, 90), (0, 226, CYAN, 150)]
        lanes_scene(img, 29, 50, 6, 126, 262, notes)
    name = 'uninstallerSidebar.bmp' if uninstall else 'installerSidebar.bmp'
    dither_and_save(img, W, H, OUT / name, 'BMP')


def header():
    # sits at the right of a dark band (MUI_BGCOLOR 08080A in installer.nsh); its left edge must stay plain BG
    W, H = 150, 57
    img = canvas(W, H)
    radial(img, 118, 30, 30, CYAN, 18)
    radial(img, 132, 30, 26, PINK, 16)
    # the two-lane mark: two short lanes with a falling line each, like the sidebar
    x0, lw, gap, top, hit = 117, 12, 3, 7, 44
    fl = layer(img)
    fd = ImageDraw.Draw(fl)
    for i, color in enumerate((CYAN, PINK)):
        a = x0 + i * (lw + gap)
        round_rect(fd, (a, top, a + lw, H + 3), 3, fill=mix(BG2, color, 0.12) + (255,),
                   outline=mix(LINE, color, 0.3) + (255,), width=s(1))
    fade_rows(fl, top, top + 12)
    over(img, fl)
    for i, (y, color) in enumerate(((34, CYAN), (23, PINK))):
        a = x0 + i * (lw + gap)
        note(img, a + 2, a + lw - 2, y, color, h=2.6, trail=9)
    hb = layer(img)
    hd = ImageDraw.Draw(hb)
    for i, color in enumerate((CYAN, PINK)):
        a = x0 + i * (lw + gap)
        hd.rectangle([s(a + 1), s(hit - 0.9), s(a + lw - 1), s(hit + 0.9)], fill=color + (255,))
    add_glow(img, hb, 3, 0.9)
    over(img, hb)
    core = layer(img)
    for i in range(2):
        a = x0 + i * (lw + gap)
        ImageDraw.Draw(core).rectangle([s(a + 2), s(hit - 0.35), s(a + lw - 2), s(hit + 0.35)], fill=(255, 255, 255, 220))
    over(img, core)
    # the wordmark, left of the mark
    f = font('display', 15.5)
    wl, wr = text_width('LINE', f, -0.01), text_width('RUSH', f, -0.01)
    right = x0 - 8
    y = 34
    draw_text(img, right - wr - 3.6 - wl, y, 'LINE', f, TEXT + (255,), -0.01)
    gradient_text(img, right - wr, y, 'RUSH', f, CYAN, PINK, -0.01)
    small = font('semibold', 7)
    t = 'FOR WINDOWS'  # this header is on the uninstaller's pages too
    draw_text(img, right - text_width(t, small, 0.12), y + 11, t, small, MUTED + (255,), 0.12)
    # keep the left edge exactly the band's color
    clean = layer(img)
    ImageDraw.Draw(clean).rectangle([0, 0, s(6), img.size[1]], fill=BG + (255,))
    over(img, clean)
    dither_and_save(img, W, H, OUT / 'installerHeader.bmp', 'BMP')


def arrow(img, x0, x1, y):
    """The drag arrow: a cyan-to-pink stroke with a chevron head, glowing."""
    top = layer(img)
    d = ImageDraw.Draw(top)
    steps = s(x1 - x0)
    for i in range(steps):
        t = i / steps
        px = s(x0) + i
        d.ellipse([px - s(2.2), s(y) - s(2.2), px + s(2.2), s(y) + s(2.2)], fill=mix(CYAN, PINK, t) + (255,))
    head = 13
    for dy in (-1, 1):
        d.line([(s(x1 - head), s(y + dy * head)), (s(x1), s(y))], fill=PINK + (255,), width=s(4.4))
        d.ellipse([s(x1 - head) - s(2.2), s(y + dy * head) - s(2.2), s(x1 - head) + s(2.2), s(y + dy * head) + s(2.2)], fill=PINK + (255,))
    d.ellipse([s(x1) - s(2.2), s(y) - s(2.2), s(x1) + s(2.2), s(y) + s(2.2)], fill=PINK + (255,))
    add_glow(img, top, 7, 0.9)
    over(img, top)


def dmg(scale):
    global SS
    keep = SS
    SS = SS * scale
    W, H = 540, 380
    img = canvas(W, H)
    radial(img, 150, 200, 120, CYAN, 22)
    radial(img, 390, 200, 120, PINK, 22)
    radial(img, 270, 50, 160, (60, 60, 90), 16)
    wordmark(img, W / 2, 78, 40, glow=0.5)
    tag = font('semibold', 13)
    line = 'Two buttons. Real beats.'
    draw_text(img, W / 2 - text_width(line, tag, 0.01) / 2, 102, line, tag, MUTED + (255,), 0.01)
    # dmg.contents puts the app at (150, 200) and Applications at (390, 200), each on its own light;
    # Finder writes their names under them, so that area stays plain
    arrow(img, 226, 314, 200)
    cap = font('semibold', 14)
    line = 'Drag Line Rush into Applications'
    draw_text(img, W / 2 - text_width(line, cap) / 2, 306, line, cap, TEXT + (235,))
    small = font('semibold', 11)
    line = 'Then open it from Launchpad. Have fun!'
    draw_text(img, W / 2 - text_width(line, small) / 2, 326, line, small, MUTED + (255,))
    name = 'dmg-background@2x.png' if scale == 2 else 'dmg-background.png'
    dither_and_save(img, W * scale, H * scale, OUT / name, 'PNG')
    SS = keep


def linux_icons():
    """Linux desktops look the app icon up by size (hicolor theme: 16 to 512), not at 1024."""
    src = Image.open(OUT / 'icon.png').convert('RGBA')
    (OUT / 'icons').mkdir(exist_ok=True)
    for n in (16, 24, 32, 48, 64, 128, 256, 512):
        path = OUT / 'icons' / f'{n}x{n}.png'
        src.resize((n, n), Image.LANCZOS).save(path, 'PNG', optimize=True)
    print('  build/icons/  16 to 512 px')


if __name__ == '__main__':
    print('Line Rush installer art:')
    sidebar()
    sidebar(uninstall=True)
    header()
    dmg(1)
    dmg(2)
    linux_icons()
