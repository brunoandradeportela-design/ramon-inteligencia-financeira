"""Gera os ativos da nova identidade AURION a partir do símbolo vetorizado (silver.d / cyan.d)
e de textos convertidos em curvas (Montserrat 700 para AURION, Open Sans 500 para a assinatura).
Saída: apps/web/assets/brand/ (+ ícones do app e favicon)."""
import os, io, cairosvg
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "../../apps/web"))
OUT = f"{WEB}/assets/brand"; os.makedirs(OUT, exist_ok=True); os.makedirs(f"{OUT}/desktop", exist_ok=True)

NAVY, NAVY_2, CYAN, CYAN_D, SILVER = "#071B32", "#0B2440", "#20C7E8", "#0E9FC4", "#D9E1E8"
S_D = open(f"{HERE}/silver.d").read(); C_D = open(f"{HERE}/cyan.d").read()
SX0, SY0, SW, SH = 5 - 20, 50 - 20, 1704 + 40, 1512 + 40          # caixa do símbolo no espaço do traçado

def defs(p):
    return (f'<linearGradient id="{p}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#DCE6EA"/><stop offset="1" stop-color="#A9B7C2"/></linearGradient>'
            f'<linearGradient id="{p}c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4BE6F6"/><stop offset="1" stop-color="#1BA6CF"/></linearGradient>')

def symbol_g(x, y, h, silver, cyan):
    """grupo do símbolo com altura h, canto superior esquerdo em (x, y)."""
    k = h / SH
    return (f'<g transform="translate({x:.2f} {y:.2f}) scale({k:.6f}) translate({-SX0} {-SY0})">'
            f'<path fill="{silver}" fill-rule="evenodd" d="{S_D}"/><path fill="{cyan}" fill-rule="evenodd" d="{C_D}"/></g>')
SYM_RATIO = SW / SH

fonts = {}
def font(name):
    if name not in fonts:
        f = {"mont700": "fonts/montserrat-latin-700-normal.woff2", "open500": "fonts/open-sans-latin-500-normal.woff2"}[name]
        fonts[name] = TTFont(os.path.join(HERE, f))
    return fonts[name]

def text_path(txt, fname, size, x, y, tracking=0.0):
    """converte texto em <path>; (x, y) = início da linha de base. Retorna (d, largura)."""
    f = font(fname); upm = f["head"].unitsPerEm; cmap = f.getBestCmap(); gs = f.getGlyphSet(); hmtx = f["hmtx"]
    k = size / upm; pen = SVGPathPen(gs); cx = 0.0
    for ch in txt:
        g = cmap.get(ord(ch))
        if g is None: continue
        tp = TransformPen(pen, (k, 0, 0, -k, x + cx, y)); gs[g].draw(tp)
        cx += hmtx[g][0] * k + tracking * size
    return pen.getCommands(), cx - tracking * size

def svg(w, h, body, label="Aurion — Inteligência Financeira, Tributária e de Mercado", d=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}" role="img" aria-label="{label}">'
            f'<title>{label}</title><defs>{d}</defs>{body}</svg>')

def save(name, content):
    open(f"{OUT}/{name}", "w").write(content); return f"{OUT}/{name}"

# ---------- símbolo isolado
H = 512; W = H * SYM_RATIO
save("aurion-symbol.svg", svg(W, H, symbol_g(0, 0, H, "url(#as)", "url(#ac)"), "Aurion", defs("a")))
save("aurion-symbol-dark.svg", svg(W, H, symbol_g(0, 0, H, NAVY_2, CYAN_D), "Aurion"))      # para fundos claros
save("aurion-symbol-mono.svg", svg(W, H, symbol_g(0, 0, H, "currentColor", "currentColor"), "Aurion"))

# ---------- logo horizontal (símbolo + AURION)
def horizontal(silver, cyan, txt_fill, dd=""):
    sh = 120; sw = sh * SYM_RATIO; gap = 30; size = 96
    d, tw = text_path("AURION", "mont700", size, sw + gap, sh * 0.5 + size * 0.36, tracking=0.04)
    w = sw + gap + tw + 4
    return svg(w, sh, symbol_g(0, 0, sh, silver, cyan) + f'<path fill="{txt_fill}" d="{d}"/>', d=dd)
save("aurion-logo-light.svg", horizontal("url(#as)", "url(#ac)", "#F4F7FA", defs("a")))   # fundo escuro
save("aurion-logo-dark.svg", horizontal(NAVY_2, CYAN_D, NAVY_2))                           # fundo claro

# ---------- logo principal (empilhada, com ® e assinatura)
def stacked(silver, cyan, txt, sub, dd=""):
    W = 900; sh = 380; sw = sh * SYM_RATIO
    body = symbol_g((W - sw) / 2, 0, sh, silver, cyan)
    size = 150; d, tw = text_path("AURION", "mont700", size, 0, 0, tracking=0.02)
    x = (W - tw) / 2; y = sh + 70 + size * 0.72
    d, tw = text_path("AURION", "mont700", size, x, y, tracking=0.02)
    rd, _ = text_path("®", "open500", 34, x + tw + 10, y - size * 0.55)
    body += f'<path fill="{txt}" d="{d}"/><path fill="{txt}" d="{rd}"/>'
    for i, line in enumerate(["INTELIGÊNCIA FINANCEIRA,", "TRIBUTÁRIA E DE MERCADO"]):
        s = 46; _, lw = text_path(line, "open500", s, 0, 0, 0.01)
        ld, _ = text_path(line, "open500", s, (W - lw) / 2, y + 86 + i * 62, 0.01)
        body += f'<path fill="{sub}" d="{ld}"/>'
    return svg(W, y + 86 + 62 + 22, body, d=dd)
save("aurion-logo-primary.svg", stacked("url(#as)", "url(#ac)", "#F4F7FA", "#C9D6E2", defs("a")))
save("aurion-logo-primary-dark.svg", stacked(NAVY_2, CYAN_D, NAVY_2, "#3B5470"))

# ---------- ícone: símbolo sobre azul-marinho (cantos arredondados opcionais)
def icon_svg(size=1024, pad=0.17, radius=0.22, bg=True):
    sh = size * (1 - 2 * pad) / max(SYM_RATIO, 1) if SYM_RATIO > 1 else size * (1 - 2 * pad)
    sw = sh * SYM_RATIO; x = (size - sw) / 2; y = (size - sh) / 2 + size * 0.01
    back = (f'<radialGradient id="ibg" cx=".5" cy=".38" r=".75"><stop offset="0" stop-color="#0E3557"/><stop offset="1" stop-color="{NAVY}"/></radialGradient>')
    rect = f'<rect width="{size}" height="{size}" rx="{size*radius:.0f}" fill="url(#ibg)"/>' if bg else ""
    return svg(size, size, rect + symbol_g(x, y, sh, "url(#as)", "url(#ac)"), "Aurion", defs("a") + back)

def png(svg_text, px, out):
    cairosvg.svg2png(bytestring=svg_text.encode(), write_to=out, output_width=px, output_height=px)
    return out

save("favicon.svg", icon_svg(64, pad=0.10, radius=0.22))
open(f"{WEB}/assets/img/favicon.svg", "w").write(icon_svg(64, pad=0.10, radius=0.22))      # mesmo caminho já referenciado nas páginas
full = icon_svg(1024, pad=0.15, radius=0.0)          # quadrado cheio (o sistema arredonda)
rounded = icon_svg(1024, pad=0.15, radius=0.22)
mask = icon_svg(1024, pad=0.25, radius=0.0)          # zona segura do ícone adaptável
icons = f"{WEB}/app/icons"
png(full, 192, f"{icons}/icon-192.png"); png(full, 512, f"{icons}/icon-512.png"); png(mask, 512, f"{icons}/maskable-512.png")
png(full, 180, f"{icons}/apple-touch-180.png"); png(full, 512, f"{OUT}/aurion-icon-512.png"); png(full, 180, f"{OUT}/apple-touch-icon.png")
# favicon.ico (16, 32, 48) — símbolo com menos margem para ficar legível
small = icon_svg(256, pad=0.08, radius=0.18)
base = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=small.encode(), output_width=256, output_height=256)))
base.save(f"{WEB}/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]); base.save(f"{OUT}/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

# ---------- desktop: .ico (Windows), .icns (macOS), PNGs (Linux)
big = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=rounded.encode(), output_width=1024, output_height=1024)))
big.save(f"{OUT}/desktop/aurion.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
try: big.save(f"{OUT}/desktop/aurion.icns")
except Exception as e: print("icns:", e)
for s in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
    png(rounded, s, f"{OUT}/desktop/aurion-{s}.png")

# ---------- imagem de compartilhamento (og:image 1200x630)
def og():
    W, H = 1200, 630
    st = stacked("url(#as)", "url(#ac)", "#F4F7FA", "#C9D6E2", "")
    inner = st[st.index("<title>"):st.rindex("</svg>")]; inner = inner[inner.index("</defs>") + 7:]
    k = 520 / 900 * 0.92; ih = (380 + 70 + 150 * 0.72 + 86 + 62 + 22) * k
    body = (f'<rect width="{W}" height="{H}" fill="url(#ogbg)"/>'
            f'<g stroke="#20C7E8" stroke-opacity=".10" fill="none">' + "".join(f'<path d="M0 {y}H{W}"/>' for y in range(30, H, 40)) + "".join(f'<path d="M{x} 0V{H}"/>' for x in range(30, W, 40)) + '</g>'
            f'<g transform="translate({(W - 900 * k) / 2:.1f} {(H - ih) / 2:.1f}) scale({k:.4f})">{inner}</g>')
    return svg(W, H, body, d=defs("a") + f'<radialGradient id="ogbg" cx=".5" cy=".45" r=".8"><stop offset="0" stop-color="#0E3557"/><stop offset="1" stop-color="{NAVY}"/></radialGradient>')
ogs = og(); save("og-aurion.svg", ogs)
cairosvg.svg2png(bytestring=ogs.encode(), write_to=f"{OUT}/og-aurion.png", output_width=1200, output_height=630)
print("ok", sorted(os.listdir(OUT)))
