from math import comb
def pmf(n,p): return [comb(n,k)*p**k*(1-p)**(n-k) for k in range(n+1)]
def cp_lower(x,n,a=0.025):
    if x==0 or n==0: return 0.0
    lo,hi=0.0,1.0
    for _ in range(60):
        m=(lo+hi)/2
        if sum(pmf(n,m)[x:])<a: lo=m
        else: hi=m
    return lo
def thr(d,a=0.05):
    t=d+1; tail=0; nd=pmf(d,.5)
    for s in range(d,-1,-1):
        tail+=nd[s]
        if tail<=a: t=s
    return t
N=168
def power(dr,w):
    cond=[sum(pmf(d,w)[thr(d):]) for d in range(N+1)]
    return sum(p*c for p,c in zip(pmf(N,dr),cond))
passes=[]
for D in range(1,25):
    for W in range(D+1):
        wl=cp_lower(W,D)
        if wl<=0.5: continue
        if power(cp_lower(D,24),wl)>=0.8: passes.append((D,W))
for D in range(1,25):
    ws=[W for d,W in passes if d==D]
    print(D, "min wins to pass:", min(ws) if ws else "none")
# what does the realistic scenario look like: true discordance 30%, win share 70%
import itertools
def prob_pass(dr,w):
    tot=0
    for D in range(25):
        pD=comb(24,D)*dr**D*(1-dr)**(24-D)
        for W in range(D+1):
            if (D,W) in passes: tot+=pD*comb(D,W)*w**W*(1-w)**(D-W)
    return tot
for dr in (0.2,0.3,0.4,0.5):
    print("disc",dr,[ (w,round(prob_pass(dr,w),3)) for w in (0.65,0.75,0.85,0.95)])
print("true power at 168 for disc .3 win .75:", round(power(.3,.75),3))
