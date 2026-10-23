import cv2, numpy as np, potrace
def trace(fn, blur=9):
    m=cv2.imread(fn,0)
    m=cv2.GaussianBlur(m,(0,0),blur); m=(m>127)
    bm=potrace.Bitmap(~m)
    pl=bm.trace(turdsize=200, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=0.7, opticurve=True, opttolerance=0.8)
    d=[]
    for curve in pl:
        sp=curve.start_point; d.append(f"M{sp.x:.1f} {sp.y:.1f}")
        for seg in curve.segments:
            if seg.is_corner: d.append(f"L{seg.c.x:.1f} {seg.c.y:.1f}L{seg.end_point.x:.1f} {seg.end_point.y:.1f}")
            else: d.append(f"C{seg.c1.x:.1f} {seg.c1.y:.1f} {seg.c2.x:.1f} {seg.c2.y:.1f} {seg.end_point.x:.1f} {seg.end_point.y:.1f}")
        d.append("Z")
    return "".join(d), m.shape
ds,shape=trace("mask_silver.png"); dc,_=trace("mask_cyan.png")
H,W=shape
# limites reais
ys,xs=np.where((cv2.imread("mask_silver.png",0)>0)|(cv2.imread("mask_cyan.png",0)>0))
print("bbox",xs.min(),ys.min(),xs.max(),ys.max(),"size",W,H)
open("silver.d","w").write(ds); open("cyan.d","w").write(dc)
