import zipfile, xml.etree.ElementTree as ET, time, sys, json
import pulp

XLSX="/Users/shubhamkr/Downloads/COG_CaseStudy_v2/COG Model Data for In Class Example  3 DC 3 WH.xlsx"
M='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'; NS={'m':M,'r':R}
z=zipfile.ZipFile(XLSX)
wb=ET.fromstring(z.read('xl/workbook.xml'))
rels={r.get('Id'):r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
sh={s.get('name'):rels[s.get('{%s}id'%R)] for s in wb.find('m:sheets',NS)}
sst=[''.join(t.text or '' for t in si.iter('{%s}t'%M)) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
def cv(c):
    t=c.get('t'); v=c.find('m:v',NS)
    return sst[int(v.text)] if t=='s' else (v.text if v is not None else None)
def rows(n):
    tgt=sh[n]; path=tgt if tgt.startswith('xl/') else 'xl/'+tgt.lstrip('/')
    return [[cv(c) for c in r.findall('m:c',NS)] for r in ET.fromstring(z.read(path)).iter('{%s}row'%M)]

Cs=rows('Customers'); Ps=rows('Plants'); Ds=rows('Demand'); Xs=rows('Distance Matrix')
ch,ph,dh=Cs[0],Ps[0],Ds[0]
cust=[r[ch.index('ID')] for r in Cs[1:]]
cname={r[ch.index('ID')]: r[ch.index('Name')] for r in Cs[1:]}
plant=[r[ph.index('ID')] for r in Ps[1:]]
pname={r[ph.index('ID')]: r[ph.index('Name')] for r in Ps[1:]}
dem={r[dh.index('Customer ID')]: float(r[dh.index('Demand')]) for r in Ds[1:]}
xh=Xs[0]
dist={(r[xh.index('Plant ID')], r[xh.index('Customer ID')]): float(r[xh.index('Distance')]) for r in Xs[1:]}
TOTAL=sum(dem[c] for c in cust)

def run(label, P, adjust, thr=800.0, cpm=1.0, cpmo=10.0, binary_assign=True, gap=0.0, tl=600):
    cost={k: v for k,v in dist.items()}          # cost seeded == distance
    if adjust:
        ec={k: v*(cpm if dist[k] <= thr else cpmo) for k,v in cost.items()}
    else:
        ec=dict(cost)
    t0=time.time()
    prob=pulp.LpProblem("delivery", pulp.LpMinimize)
    cat = 'Binary' if binary_assign else 'Continuous'
    y=pulp.LpVariable.dicts("A",[(w,c) for w in plant for c in cust],0,1,cat=cat)
    o=pulp.LpVariable.dicts("O",plant,0,1,cat='Binary')
    prob += pulp.lpSum(ec[(w,c)]*dem[c]*y[(w,c)] for w in plant for c in cust)
    for c in cust:
        prob += pulp.lpSum(y[(w,c)] for w in plant) == 1
    prob += pulp.lpSum(o[w] for w in plant) <= P
    for w in plant:
        for c in cust:
            prob += y[(w,c)] <= o[w]
    build=time.time()-t0
    t1=time.time()
    prob.solve(pulp.PULP_CBC_CMD(msg=0, gapRel=gap, timeLimit=tl))
    solve_t=time.time()-t1
    obj=pulp.value(prob.objective)
    opened=sorted([w for w in plant if o[w].varValue and o[w].varValue>0.5], key=lambda w:int(w))
    dw=0.0; band={b:0.0 for b in (400,800,1200,1600)}
    for w in plant:
        for c in cust:
            v=y[(w,c)].varValue
            if v and v>0.5:
                d=dist[(w,c)]; dw += d*dem[c]
                for b in band:
                    if d<=b: band[b]+=dem[c]
    print(f"\n=== {label}  P={P} adjust={adjust} assign={cat}")
    print(f"  status            : {pulp.LpStatus[prob.status]}")
    print(f"  objective         : {obj:,.4f}")
    print(f"  open DCs          : {[(w,pname[w]) for w in opened]}")
    print(f"  weightedAvgDist   : {dw/TOTAL:,.4f} mi")
    print(f"  bandCoverage %    : " + ", ".join(f"{b}:{band[b]*100/TOTAL:.2f}" for b in sorted(band)))
    print(f"  build {build:.1f}s  solve {solve_t:.1f}s  total {build+solve_t:.1f}s")
    return dict(label=label,obj=obj,opened=opened,wad=dw/TOTAL,
                bands={b:band[b]*100/TOTAL for b in band},build=build,solve=solve_t)

print(f"plants={len(plant)} customers={len(cust)} lanes={len(dist)} totalDemand={TOTAL:,.0f}")
res=[]
res.append(run("Scenario 1 (base, $1/mi)", 3, False))
res.append(run("Scenario 2 (adjusted 1/10 @800)", 3, True))
json.dump(res, open("/tmp/ch5x/goldens.json","w"), indent=1)
