import cv2, numpy as np
src=cv2.imread('aurion-logo-oficial.jpg').astype(np.float32)
H,W=src.shape[:2]
hsv=cv2.cvtColor(src.astype(np.uint8),cv2.COLOR_BGR2HSV).astype(int)
h,s,v=hsv[...,0],hsv[...,1],hsv[...,2]
# região da marca (símbolo + nome + assinatura)
X0,Y0,X1,Y1=420,130,990,640
fg=(((s<120)&(v>110))|((h>=80)&(h<=104)&(s>80)&(v>110))).astype(np.uint8)*255
roi=np.zeros_like(fg); roi[130:415,530:860]=1; roi[425:640,430:985]=1; fg*=roi
n,lab,st,_=cv2.connectedComponentsWithStats(fg); keep=np.zeros_like(fg)
for i in range(1,n):
    x,y,w,hh,a=st[i]
    if a>25: keep[lab==i]=255           # mantém letras pequenas (assinatura)
region=cv2.dilate(keep,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)))
# fundo estimado: inpaint da região
bg=cv2.inpaint(src.astype(np.uint8),region,15,cv2.INPAINT_TELEA).astype(np.float32)
bg=cv2.GaussianBlur(bg,(0,0),6)
# alfa: distância de cor ao fundo, normalizada pela distância típica do primeiro plano
d=np.linalg.norm(src-bg,axis=2)
alpha=np.clip(d/150.0,0,1)
soft=cv2.GaussianBlur(region.astype(np.float32)/255,(0,0),3)
alpha=alpha*soft
a3=np.maximum(alpha[...,None],1e-3)
col=np.clip((src-(1-a3)*bg)/a3,0,255)
rgba=np.dstack([col,alpha*255]).astype(np.uint8)
crop=rgba[Y0:Y1,X0:X1]
ys,xs=np.where(crop[...,3]>8); crop=crop[max(ys.min()-6,0):ys.max()+6, max(xs.min()-6,0):xs.max()+6]
cv2.imwrite('art_lockup.png',crop)
# só o símbolo
sym=rgba[130:415,530:860]; ys,xs=np.where(sym[...,3]>8); sym=sym[max(ys.min()-6,0):ys.max()+6, max(xs.min()-6,0):xs.max()+6]
cv2.imwrite('art_symbol.png',sym)
print(crop.shape, sym.shape)
# nome AURION® (sem assinatura) e assinatura separada
def tight(a,pad=6):
    ys,xs=np.where(a[...,3]>8); return a[max(ys.min()-pad,0):ys.max()+pad, max(xs.min()-pad,0):xs.max()+pad]
cv2.imwrite('art_wordmark.png',tight(rgba[430:545,430:985]))
cv2.imwrite('art_tagline.png',tight(rgba[548:640,430:985]))
