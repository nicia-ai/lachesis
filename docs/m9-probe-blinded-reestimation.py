from math import comb
def pmf(n,p): return [comb(n,k)*p**k*(1-p)**(n-k) for k in range(n+1)]
def thr(d,a=0.05):
    t=d+1; tail=0; nd=pmf(d,.5)
    for s in range(d,-1,-1):
        tail+=nd[s]
        if tail<=a: t=s
    return t
CT={}
def cond(d,w):
    if (d,w) not in CT: CT[(d,w)]=sum(pmf(d,w)[thr(d):])
    return CT[(d,w)]
def power(N,dr,w): return sum(p*cond(d,w) for d,p in enumerate(pmf(N,dr)))
W=16/22
print("power@168 strong:", round(power(168,.22,W),3))
def needN(dr):
    for N in range(24,24*60,24):
        if power(N,dr,W)>=0.8: return N
for dr in (0.10,0.125,0.15,0.1667,0.20,0.22,0.25,0.30,0.40):
    N=needN(dr); print(f"disc {dr:.3f} needN {N} primary$ {N*402.55488/168:.0f}")
# blinded rule: dhat=D/24 ; N=clamp(needN(dhat),168? ,Nmax)
print("D->dhat->N")
for D in range(0,13):
    dh=D/24
    print(D, round(dh,3), needN(dh) if D>0 else "inf")
