import sys, json
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
OUT=sys.argv[1]
B1,B2,B3,GR="#2a78d6","#eb6834","#1baf7a","#8a8986"; INK,INK2,GRID,SURF="#0b0b0b","#52514e","#e4e3df","#fcfcfb"
plt.rcParams.update({"font.family":"DejaVu Sans","font.size":10,"axes.edgecolor":GRID,"axes.labelcolor":INK2,"xtick.color":INK2,"ytick.color":INK2,"axes.spines.top":False,"axes.spines.right":False,"axes.grid":True,"grid.color":GRID,"axes.axisbelow":True,"figure.facecolor":SURF,"axes.facecolor":SURF,"savefig.facecolor":SURF,"axes.titleweight":"bold","axes.titlesize":12,"axes.titlecolor":INK,"legend.frameon":False})
def custo(tin,cached,out=170,pi=2.5,pc=1.25,po=10): return ((tin-cached)*pi+cached*pc+out*po)/1e6
HOJE={"N":custo(9100,800),"P":custo(21000,800),"A":custo(5000,800)}
# otimizado: reordenar p/ cache (4k estático, 70% acerto) + serviços por busca (-3k) + sem cabeçalho repetido (-2,4k na programação) + botão sem IA
cach=0.7*4000+0.3*800
OTIM={"N":custo(6100,cach),"P":custo(15600,cach),"A":0.0}
MINI={k:custo(t,800,pi=0.15,pc=0.075,po=0.6) for k,t in (("N",9100),("P",21000),("A",5000))}
print("custo por turno hoje",HOJE,"otim",OTIM,"mini",MINI)
FIXO_DIA=0.25  # currículos/banco de talentos + gpt-4o-mini + embeddings (média observada fora dos picos)
cen=[("Calmo\n(ritmo de 12–15/09)",20,0.10,0,0),("Orgânico atual\n(ritmo de 21–23/09)",170,0.16,0,0),("Outubro alto\n(publicação + divulgação)",300,0.20,1,1)]
res=[]
for nome,t,fp,disp_sim,disp_prog in cen:
    def mes(C):
        base=30*(t*((1-fp)*C["N"]+fp*C["P"])+FIXO_DIA)
        ev=disp_sim*(162*C["N"]+26*C["P"]+183*C["A"]) + disp_prog*(300*(0.7*C["N"]+0.3*C["P"]))
        return base+ev
    res.append((nome,mes(HOJE),mes(OTIM),mes(MINI)))
for r in res: print(r)
f,ax=plt.subplots(figsize=(10,4.4)); w=0.26; xs=range(len(res))
for j,(lbl,col) in enumerate((("Hoje (gpt-4o, prompt atual)",B1),("Com otimizações 1–4 (gpt-4o)",B3),("Se trocar p/ gpt-4o-mini (sem otimizações)",B2))):
    vals=[r[1+j] for r in res]; xx=[i+(j-1)*w for i in xs]
    ax.bar(xx,vals,width=w-0.02,color=col,label=lbl,edgecolor=SURF)
    for a,v in zip(xx,vals): ax.text(a,v+2,f"US$ {v:.0f}",ha="center",fontsize=8,color=INK)
ax.set_xticks(list(xs)); ax.set_xticklabels([r[0] for r in res]); ax.set_ylabel("US$ / mês (30 dias)")
ax.set_title("Prognóstico — custo mensal OpenAI por cenário"); ax.legend(loc="upper left",fontsize=8)
plt.tight_layout(); plt.savefig(f"{OUT}/graficos/09_prognostico_cenarios_mensais.png",dpi=150); plt.close()
json.dump({"hoje":HOJE,"otim":OTIM,"mini":MINI,"cenarios":[(n.replace("\n"," "),a,b,c) for n,a,b,c in res]},open(f"{OUT}/dados/prognostico_cenarios.json","w"),indent=1)
