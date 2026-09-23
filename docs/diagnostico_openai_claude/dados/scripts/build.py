import markdown, base64, re, sys, os
D=sys.argv[1]
CSS="""
:root{--bg:#fcfcfb;--fg:#0b0b0b;--fg2:#52514e;--line:#e4e3df;--card:#f3f2ef;--acc:#2a78d6;--code:#f0efeb}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1a1a19;--fg:#fff;--fg2:#c3c2b7;--line:#3a3a37;--card:#232322;--acc:#3987e5;--code:#262624}}
:root[data-theme="dark"]{--bg:#1a1a19;--fg:#fff;--fg2:#c3c2b7;--line:#3a3a37;--card:#232322;--acc:#3987e5;--code:#262624}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;line-height:1.25;margin:0 0 12px}
h2{font-size:21px;margin:40px 0 12px;padding-top:12px;border-top:1px solid var(--line)}
h3{font-size:17px;margin:28px 0 8px}
a{color:var(--acc)}
p,li{color:var(--fg)}
blockquote{margin:16px 0;padding:10px 16px;border-left:3px solid var(--acc);background:var(--card);color:var(--fg2)}
.tw{overflow-x:auto;margin:14px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid var(--line);padding:7px 9px;text-align:left;vertical-align:top}
th{color:var(--fg2);font-weight:600;background:var(--card)}
code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:.9em}
pre{background:var(--code);padding:12px;border-radius:8px;overflow-x:auto}
pre code{background:none;padding:0}
img{max-width:100%;height:auto;border-radius:8px;border:1px solid var(--line);display:block;margin:16px 0;background:#fcfcfb}
hr{border:0;border-top:1px solid var(--line);margin:28px 0}
@media print{body{background:#fff;color:#000;font-size:11.5px}main{max-width:none;padding:0}h2{break-before:auto}img,pre,tr{break-inside:avoid}.tw{overflow:visible}a{color:#000}}
@page{size:A4;margin:14mm 12mm}
"""
for base in ("DIAGNOSTICO-consumo-openai-2026-09-23","PROGNOSTICO-consumo-openai-2026-09-23"):
    md=open(f"{D}/{base}.md",encoding="utf-8").read()
    L=md.splitlines(); o=[]
    for i,l in enumerate(L):
        m=re.match(r'^( +)([-*]|\d+\.) ',l)
        if m: l=' '*(len(m.group(1))*2)+l.lstrip(' ')
        if re.match(r'^([-*]|\d+\.) ',l) and o and o[-1].strip() and not re.match(r'^\s*([-*]|\d+\.) ',o[-1]) and not o[-1].startswith('|'):
            o.append('')
        if l.startswith('**') and o and o[-1].startswith('**') and not o[-1].endswith('  '): o[-1]+='  '
        o.append(l)
    md='\n'.join(o)
    title=md.splitlines()[0].lstrip("# ").strip()
    html=markdown.markdown(md,extensions=["tables","fenced_code","sane_lists"])
    def emb(m):
        src=m.group(1)
        if src.startswith("http"): return m.group(0)
        b=base64.b64encode(open(f"{D}/{src}","rb").read()).decode()
        return m.group(0).replace(src,"data:image/png;base64,"+b)
    html=re.sub(r'<img[^>]*src="([^"]+)"',emb,html)
    html=html.replace(".md\"",".html\"").replace("<table>","<div class=\"tw\"><table>").replace("</table>","</table></div>")
    out=f"<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{'Diagnóstico Consumo OpenAI' if base.startswith('DIAG') else 'Prognóstico Consumo OpenAI'}</title><style>{CSS}</style></head><body><main>{html}</main></body></html>"
    open(f"{D}/{base}.html","w",encoding="utf-8").write(out)
    print(base, len(out)//1024,"KB")
