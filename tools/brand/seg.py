import cv2, numpy as np
src=cv2.imread('aurion-logo-oficial.jpg')
crop=src[140:405,550:845]              # símbolo
S=6
big=cv2.resize(crop,None,fx=S,fy=S,interpolation=cv2.INTER_CUBIC)
big=cv2.bilateralFilter(big,9,40,9)
hsv=cv2.cvtColor(big,cv2.COLOR_BGR2HSV)
h,s,v=[hsv[...,i].astype(int) for i in range(3)]
cyan=((h>=82)&(h<=104)&(s>90)&(v>120)).astype(np.uint8)*255
silver=((s<70)&(v>150)).astype(np.uint8)*255
silver[cyan>0]=0
k=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9))
for name,m in [("cyan",cyan),("silver",silver)]:
    m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,k); m=cv2.morphologyEx(m,cv2.MORPH_OPEN,k)
    # remove pequenos componentes (linhas do fundo)
    n,lab,st,_=cv2.connectedComponentsWithStats(m)
    keep=np.zeros_like(m)
    for i in range(1,n):
        if st[i,cv2.CC_STAT_AREA]>4000*S: keep[lab==i]=255
    cv2.imwrite(f"mask_{name}.png",keep)
print(big.shape)
cv2.imwrite("big.png",big)
