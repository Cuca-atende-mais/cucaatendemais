import csv, json, sys
from collections import defaultdict
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from dados_banco import *
OUT=sys.argv[1]
B1,B2,B3,GR="#2a78d6","#eb6834","#1baf7a","#8a8986"
INK,INK2,GRID,SURF="#0b0b0b","#52514e","#e4e3df","#fcfcfb"
plt.rcParams.update({"font.family":"DejaVu Sans","font.size":10,"axes.edgecolor":GRID,"axes.labelcolor":INK2,"xtick.color":INK2,"ytick.color":INK2,
 "axes.spines.top":False,"axes.spines.right":False,"axes.grid":True,"grid.color":GRID,"grid.linewidth":0.6,"axes.axisbelow":True,
 "figure.facecolor":SURF,"axes.facecolor":SURF,"savefig.facecolor":SURF,"axes.titleweight":"bold","axes.titlesize":12,"axes.titlecolor":INK,"legend.frameon":False})
P={'4o':(2.5,1.25,10),'mini':(0.15,0.075,0.6)}
u=defaultdict(lambda: defaultdict(float))
for r in csv.DictReader(open('completions_usage_2026-09-01_2026-09-23.csv')):
    m=r['model']; d=r['start_time_iso'][:10]
    k='4o' if m.startswith('gpt-4o-2') else ('mini' if m.startswith('gpt-4o-mini') else 'outro')
    i,o,c,n=int(r['input_tokens']),int(r['output_tokens']),int(r['input_cached_tokens']),int(r['num_model_requests'])
    u[d][k+'_req']+=n;u[d][k+'_in']+=i;u[d][k+'_out']+=o;u[d][k+'_cached']+=c
    if k in P: pi,pc,po=P[k]; u[d][k+'_usd']+=((i-c)*pi+c*pc+o*po)/1e6
emb={}
for r in csv.DictReader(open('embeddings_usage_2026-09-01_2026-09-23.csv')):
    emb[r['start_time_iso'][:10]]=(float(r['num_model_requests'] or 0),float(r['input_tokens'] or 0))
cost={r['start_time_iso'][:10]:float(r['amount_value'] or 0) for r in csv.DictReader(open('cost_2026-09-01_2026-09-23.csv'))}
lab=[d[-2:] for d in DIAS]; x=list(range(len(DIAS)))
def fin(ax,fn,yl=None):
    if yl: ax.set_ylabel(yl)
    ax.set_xticks(x); ax.set_xticklabels(lab); ax.set_xlabel("dia de setembro/2026 (UTC)")
    plt.tight_layout(); plt.savefig(f"{OUT}/graficos/{fn}",dpi=150); plt.close()
# 1 custo diário
f,ax=plt.subplots(figsize=(10,4.2))
a=[u[d]['4o_usd'] for d in DIAS]; b=[u[d]['mini_usd'] for d in DIAS]
ax.bar(x,a,color=B1,label="gpt-4o",width=0.72,edgecolor=SURF,linewidth=1)
ax.bar(x,b,bottom=a,color=B2,label="gpt-4o-mini",width=0.72,edgecolor=SURF,linewidth=1)
for i,d in enumerate(DIAS):
    if cost[d]>2.4: ax.text(i,cost[d]+0.12,f"US$ {cost[d]:.2f}",ha="center",fontsize=8,color=INK)
ax.set_title("Custo diário OpenAI por modelo (US$)"); ax.legend(loc="upper left"); fin(ax,"01_custo_diario_por_modelo.png","US$")
# 2 tokens entrada gpt-4o
f,ax=plt.subplots(figsize=(10,4.2))
ax.bar(x,[u[d]['4o_in']/1e6 for d in DIAS],color=B1,width=0.72)
ax.set_title("gpt-4o — tokens de entrada por dia (milhões)"); fin(ax,"02_gpt4o_tokens_entrada.png","milhões de tokens")
# 3 média por chamada
f,ax=plt.subplots(figsize=(10,4.2))
av=[u[d]['4o_in']/u[d]['4o_req']/1000 if u[d]['4o_req'] else 0 for d in DIAS]
ax.plot(x,av,color=B1,lw=2,marker="o",ms=5)
ax.axhline(11,color=INK2,lw=1,ls="--"); ax.text(0,11.25,"teto observado ~11 mil: dias dominados pelo Institucional (09, 10, 21, 22)",fontsize=8,color=INK2); ax.text(0,0.3,"dias abaixo: mistura com leitura de currículo (~1 mil tokens/chamada) e respostas sem contexto",fontsize=8,color=INK2)
ax.set_ylim(0,max(av)+1.5); ax.set_title("gpt-4o — tokens de entrada por chamada (mil) — média do dia, sem tendência de alta"); fin(ax,"03_gpt4o_tokens_por_chamada.png","mil tokens / chamada")
# 4 mensagens por agente
f,ax=plt.subplots(figsize=(10,4.2))
ax.plot(x,[MSG_INST[l][0] for l in lab],color=B1,lw=2,marker="o",ms=4,label="Institucional (gpt-4o)")
ax.plot(x,[MSG_EMP[l][0] for l in lab],color=B2,lw=2,marker="o",ms=4,label="Empregabilidade (gpt-4o-mini)")
ax.annotate("disparo do Simulado\nAcademia Enem",xy=(16,829),xytext=(11.5,760),fontsize=8,color=INK2,arrowprops=dict(arrowstyle="-",color=GR))
ax.set_title("Respostas do agente por dia, por canal"); ax.legend(loc="upper left"); fin(ax,"04_respostas_por_canal.png","mensagens do agente")
# 5 turnos institucional por camada 12-23
D2=DIAS[11:]; x2=list(range(len(D2)))
GPTO=['vetorial','sem_match_rag','deterministica_metadata','deterministica_texto','ambiguidade_unidade','nao_aplicavel']
SEM=['resposta_canned','encerramento','handover']
pc=[RAG[d].get('programacao_completa',0) for d in D2]; go=[sum(RAG[d].get(k,0) for k in GPTO) for d in D2]; sg=[sum(RAG[d].get(k,0) for k in SEM) for d in D2]
f,ax=plt.subplots(figsize=(10,4.2))
ax.bar(x2,go,color=B1,label="gpt-4o — contexto padrão (~8–9 mil tokens)",width=0.72,edgecolor=SURF,linewidth=1)
ax.bar(x2,pc,bottom=go,color=B2,label="gpt-4o — programação completa (~20–23 mil tokens)",width=0.72,edgecolor=SURF,linewidth=1)
ax.bar(x2,sg,bottom=[a+b for a,b in zip(go,pc)],color=GR,label="resposta pronta, sem IA",width=0.72,edgecolor=SURF,linewidth=1)
ax.set_xticks(x2); ax.set_xticklabels([d[-2:] for d in D2]); ax.set_xlabel("dia de setembro/2026 (UTC)"); ax.set_ylabel("turnos")
ax.set_title("Institucional — turnos por tipo de resposta (registro de RAG, desde 12/09)"); ax.legend(loc="upper right",fontsize=8)
plt.tight_layout(); plt.savefig(f"{OUT}/graficos/05_institucional_turnos_por_camada.png",dpi=150); plt.close()
# 6 composição do prompt
comp=[("Prompt do agente (sistema)",1700),("Regras técnicas (contexto)",950),("Guardrail de segurança (código)",1352),("Serviços da Rede (inteiro, todo turno)",3800),("Histórico (10 msgs) + data + instruções",700),("Trechos RAG (vetorial, 3–5)",600)]
comp2=comp[:-1]+[("Programação completa da unidade",12100),("Eventos/FAQ (3 trechos)",400)]
f,ax=plt.subplots(figsize=(10,3.6))
for row,(nome,cc) in enumerate([("Turno padrão",comp),("Turno com programação completa",comp2)]):
    left=0
    for j,(n,v) in enumerate(cc):
        col={0:B1,1:B1,2:B1,3:B2}.get(j,B3 if 'Programa' in n else GR)
        ax.barh(row,v,left=left,color=col,edgecolor=SURF,linewidth=2,height=0.55)
        if v>900: ax.text(left+v/2,row,f"{v/1000:.1f}k",ha="center",va="center",color="white",fontsize=8,fontweight="bold")
        left+=v
    ax.text(left+200,row,f"≈ {left/1000:.1f} mil tokens",va="center",fontsize=9,color=INK)
ax.set_yticks([0,1]); ax.set_yticklabels(["Turno padrão","Programação completa"]); ax.set_xlim(0,25500); ax.grid(axis="y",visible=False)
from matplotlib.patches import Patch
ax.legend(handles=[Patch(color=B1,label="prompt + regras + guardrail"),Patch(color=B2,label="Serviços da Rede"),Patch(color=B3,label="Programação da unidade"),Patch(color=GR,label="histórico / RAG")],loc="lower right",fontsize=8,ncol=2)
ax.set_title("Anatomia estimada de uma chamada ao gpt-4o no Institucional (tokens)"); ax.set_xlabel("tokens de entrada")
plt.tight_layout(); plt.savefig(f"{OUT}/graficos/06_anatomia_prompt_institucional.png",dpi=150); plt.close()
# 7 embeddings vs vetores
f,ax=plt.subplots(figsize=(10,4.2))
ax.bar(x,[emb.get(d,(0,0))[0] for d in DIAS],color=B1,width=0.72,label="requisições de embedding (planilha)")
ax.plot(x,[CHUNKS_NEW.get(l,0) for l in lab],color=B2,lw=2,marker="o",ms=4,label="chunks (vetores) gravados no banco")
ax.annotate("12/09: reindexação da\nprogramação de setembro\n(513 chunks = 76 mil tokens)",xy=(11,513),xytext=(1,380),fontsize=8,color=INK2,arrowprops=dict(arrowstyle="-",color=GR))
ax.set_title("Embeddings — requisições por dia × vetores gravados"); ax.legend(loc="upper right"); fin(ax,"07_embeddings_vs_vetores.png","quantidade")
# 8 cache
f,ax=plt.subplots(figsize=(10,4.2))
cr=[u[d]['4o_cached']/u[d]['4o_req'] if u[d]['4o_req'] else 0 for d in DIAS]
ax.bar(x,cr,color=B3,width=0.72,label="média diária de tokens em cache por chamada (real)")
ax.axhline(1700,color=INK2,lw=1,ls="--"); ax.text(0,1760,"fim estimado do prompt de sistema (~1,7 mil) — onde o prefixo estável termina",fontsize=8,color=INK2)
ax.axhline(7800,color=B2,lw=1.5,ls="--"); ax.text(0,7860,"prefixo que poderia ser cacheado reordenando o prompt (~7,8 mil)",fontsize=8,color=B2)
ax.set_ylim(0,9000); ax.set_title("gpt-4o — cache de prompt aproveitado por chamada"); ax.legend(loc="upper right"); fin(ax,"08_cache_por_chamada.png","tokens")
json.dump({"u":{d:dict(u[d]) for d in DIAS},"emb":emb,"cost":cost},open(f"{OUT}/dados/serie_diaria_openai.json","w"),indent=1)
# CSV consolidado
with open(f"{OUT}/dados/serie_diaria_consolidada.csv","w",newline="") as fh:
    w=csv.writer(fh); w.writerow(["dia_utc","custo_fatura_usd","custo_calc_gpt4o_usd","custo_calc_mini_usd","gpt4o_chamadas","gpt4o_tokens_entrada","gpt4o_tokens_cache","gpt4o_tokens_saida","mini_chamadas","mini_tokens_entrada","emb_requisicoes","emb_tokens","inst_respostas","emp_respostas","inst_turnos_prog_completa","inst_turnos_gpt_padrao","inst_turnos_sem_ia","cv_ocr","talent_bank_atualizados","chunks_gravados","atividades_criadas","envios_disparo"])
    for d in DIAS:
        l=d[-2:]; r=RAG.get(d)
        w.writerow([d,round(cost[d],4),round(u[d]['4o_usd'],4),round(u[d]['mini_usd'],4),int(u[d]['4o_req']),int(u[d]['4o_in']),int(u[d]['4o_cached']),int(u[d]['4o_out']),int(u[d]['mini_req']),int(u[d]['mini_in']),int(emb.get(d,(0,0))[0]),int(emb.get(d,(0,0))[1]),MSG_INST[l][0],MSG_EMP[l][0],
          r.get('programacao_completa',0) if r else "",sum(r.get(k,0) for k in GPTO) if r else "",sum(r.get(k,0) for k in SEM) if r else "",CAND_OCR[l],TB_UPD[l],CHUNKS_NEW.get(l,0),ATIV_NEW.get(l,0),LOGS_DISPARO.get(l,0)])
T4=sum(u[d]['4o_usd'] for d in DIAS);TM=sum(u[d]['mini_usd'] for d in DIAS)
print("tot4o",T4,"mini",TM,"fatura",sum(cost.values()),"emb tokens",sum(v[1] for v in emb.values()))
print("4o in",sum(u[d]['4o_in'] for d in DIAS),"cached",sum(u[d]['4o_cached'] for d in DIAS),"out",sum(u[d]['4o_out'] for d in DIAS),"req",sum(u[d]['4o_req'] for d in DIAS))
p1=sum(cost[d] for d in DIAS[:13]); p2=sum(cost[d] for d in DIAS[13:])
print("01-13",p1,p1/13,"14-23",p2,p2/10)
