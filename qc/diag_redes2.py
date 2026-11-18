"""Diagnóstico 2 (solo lectura): endpoints de datos de INIA (Agromet) y formularios de DGA (dgasat)."""
import re, requests
from urllib.parse import urljoin
H = {"User-Agent": "Mozilla/5.0 metotec-diag"}
def get(u, **k):
    k.setdefault("timeout", 40); k.setdefault("headers", H)
    try:
        r = requests.get(u, **k); print(f"{r.status_code} {len(r.content)} B {r.headers.get('content-type','')[:30]} {u[:120]}"); return r
    except Exception as e:
        print("ERROR", type(e).__name__, str(e)[:100], u[:100])

print("=== INIA ===")
r = get("https://agrometeorologia.cl/")
if r is not None and r.ok:
    h = r.text
    srcs = [urljoin("https://agrometeorologia.cl/", s) for s in re.findall(r'<script[^>]+src="([^"]+)"', h)]
    print("scripts:", [s[-70:] for s in srcs if "agrometeorologia.cl" in s][:15])
    cand = set()
    textos = [h] + [(get(s).text if get(s) is not None else "") for s in srcs if "agrometeorologia.cl" in s][:8]
    for t in textos:
        for m in re.findall(r"""["'`]((?:https?://agrometeorologia\.cl)?/[\w./{}$-]*(?:api|estacion|station|datos|data|json|ajax|get)[\w./?=&{}$%-]*)["'`]""", t, flags=re.I):
            if not m.endswith((".css", ".png", ".jpg", ".svg", ".woff2")): cand.add(m)
    print("endpoints candidatos:", sorted(cand)[:40])
    i = h.find("estaciones"); print("contexto «estaciones»:", re.sub(r"\s+", " ", h[max(0, i - 150):i + 350]))
print("\n=== DGA dgasat ===")
for u in ("https://snia.mop.gob.cl/dgasat/pages/dgasat_param/dgasat_param.jsp", "https://snia.mop.gob.cl/dgasat/pages/dgasat_rep1/dgasat_rep1_param.jsp"):
    r = get(u)
    if r is not None and r.ok:
        t = r.content.decode("windows-1252", "replace")
        print(" forms:", re.findall(r"<form[^>]*>", t, flags=re.I)[:3])
        print(" inputs/selects:", re.findall(r"<(?:input|select)[^>]*name=\"?([\w]+)", t, flags=re.I)[:25])
        op = re.findall(r"<option[^>]*value=\"?([^\">]*)\"?[^>]*>([^<]{3,60})", t, flags=re.I)
        print(" opciones:", len(op), op[:12])
