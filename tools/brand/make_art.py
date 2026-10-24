"""Ativos fiéis à arte oficial: recorte do símbolo, nome e assinatura com transparência,
ícones (app, Apple, adaptável, computador) e imagem de compartilhamento a partir desses recortes."""
import os, numpy as np
from PIL import Image, ImageFilter, ImageDraw
WEB=__import__("os").path.abspath(__import__("os").path.join(__import__("os").path.dirname(__file__),"../../apps/web")); OUT=f"{WEB}/assets/brand"
sym=Image.open("art_symbol.png").convert("RGBA"); word=Image.open("art_wordmark.png").convert("RGBA")
tag=Image.open("art_tagline.png").convert("RGBA"); lock=Image.open("art_lockup.png").convert("RGBA")
for im,n in [(sym,"aurion-symbol-art.png"),(word,"aurion-wordmark-art.png"),(tag,"aurion-tagline-art.png"),(lock,"aurion-logo-art.png")]:
    im.save(f"{OUT}/{n}",optimize=True)
NAVY=(7,27,50); NAVY3=(14,53,87)
def bg(size, rounded=0.0, grid=False):
    y,x=np.mgrid[0:size,0:size]/size
    r=np.sqrt((x-.5)**2+((y-.40)*1.05)**2)/0.75
    t=np.clip(r,0,1)[...,None]
    col=(np.array(NAVY3)*(1-t)+np.array(NAVY)*t)
    # brilho ciano suave atrás do símbolo
    g=np.exp(-((x-.5)**2+(y-.47)**2)/0.045)[...,None]*np.array([12,40,60])*0.55
    im=Image.fromarray(np.clip(col+g,0,255).astype(np.uint8)).convert("RGBA")
    # linhas finas de grade (como a arte)
    if grid:
        ov=Image.new("RGBA",(size,size),(0,0,0,0)); d=ImageDraw.Draw(ov); step=max(size//16,4)
        for i in range(0,size,step): d.line([(i,0),(i,size)],fill=(32,199,232,18)); d.line([(0,i),(size,i)],fill=(32,199,232,18))
        im.alpha_composite(ov)
    if rounded:
        m=Image.new("L",(size,size),0); ImageDraw.Draw(m).rounded_rectangle([0,0,size-1,size-1],radius=int(size*rounded),fill=255)
        im.putalpha(m)
    return im
def icon(size, pad=0.15, rounded=0.0):
    im=bg(size,rounded); avail=int(size*(1-2*pad))
    k=min(avail/sym.width, avail/sym.height); s=sym.resize((round(sym.width*k),round(sym.height*k)),Image.LANCZOS)
    if k>1: s=s.filter(ImageFilter.UnsharpMask(radius=1.2,percent=60,threshold=2))
    im.alpha_composite(s,((size-s.width)//2,(size-s.height)//2+int(size*0.01)))
    return im
I=f"{WEB}/app/icons"
icon(192).save(f"{I}/icon-192.png",optimize=True); icon(512).save(f"{I}/icon-512.png",optimize=True)
icon(512,pad=0.25).save(f"{I}/maskable-512.png",optimize=True); icon(180).convert("RGB").save(f"{I}/apple-touch-180.png",optimize=True)
icon(512).save(f"{OUT}/aurion-icon-512.png",optimize=True); icon(180).convert("RGB").save(f"{OUT}/apple-touch-icon.png",optimize=True)
D=f"{OUT}/desktop"
for s in (64,128,256,512,1024): icon(s,pad=0.12,rounded=0.22).save(f"{D}/aurion-{s}.png",optimize=True)
big=icon(1024,pad=0.12,rounded=0.22)
big.save(f"{D}/aurion.ico",sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
big.save(f"{D}/aurion.icns")
# imagem de compartilhamento 1200x630 com a logo oficial completa
W,H=1200,630; og=Image.new("RGBA",(W,H)); base=bg(1200,grid=True).crop((0,285,1200,915)); og.alpha_composite(base)
k=470/lock.height; L=lock.resize((round(lock.width*k),470),Image.LANCZOS); og.alpha_composite(L,((W-L.width)//2,(H-L.height)//2))
og.convert("RGB").save(f"{OUT}/og-aurion.png",optimize=True)
print("ok")
