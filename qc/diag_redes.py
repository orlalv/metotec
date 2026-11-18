"""Diagnóstico (solo lectura): ¿se pueden leer estaciones de INIA y DGA? ¿vienen ya por la DMC? Deja el resultado en el registro del flujo."""
import os, re, sys, json
import requests
sys.path.insert(0, os.path.dirname(__file__))
H = {"User-Agent": "Mozilla/5.0 metotec-diag"}

def get(u, **k):
    k.setdefault("timeout", 40); k.setdefault("headers", H)
    try:
        r = requests.get(u, **k); print(f"{r.status_code} {len(r.content)} B {r.headers.get('content-type','')[:40]}  {u[:110]}"); return r
    except Exception as e:
        print(f"ERROR {type(e).__name__}: {str(e)[:120]}  {u[:100]}")

def links(r, pat):
    if r is not None and r.ok:
        t = r.text
        print("  enlaces/rutas:", sorted(set(re.findall(r"""["'(]((?:https?:)?/?[\w./%-]*(?:%s)[\w./?=&%%-]*)""" % pat, t)))[:25])
        print("  inicio:", re.sub(r"\s+", " ", t[:300]))

print("=== INIA (Agromet) ===")
for u in ("https://agrometeorologia.cl/", "https://agrometeorologia.cl/api/stations", "https://agrometeorologia.cl/api/estaciones", "https://www.inia.cl/"):
    links(get(u), "api|json|estacion|station|data")
print("\n=== DGA ===")
for u in ("https://snia.mop.gob.cl/dgasat/", "https://snia.mop.gob.cl/dgasat/pages/dgasat_param/dgasat_param.jsp", "https://dga.mop.gob.cl/", "https://snia.mop.gob.cl/BNAConsultas/reportes"):
    links(get(u), "json|csv|api|dgasat|estacion")
print("\n=== DMC: ¿vienen estaciones INIA/DGA? ===")
usr, tok = os.environ.get("DMC_USUARIO"), os.environ.get("DMC_TOKEN")
print("credenciales DMC:", "sí" if usr and tok else "no")
if usr and tok:
    for sv in ("getCatastroEstaciones", "getDatosRecientesRedEma"):
        r = get("https://climatologia.meteochile.gob.cl/application/servicios/" + sv, params={"usuario": usr, "token": tok}, timeout=120)
        if r is not None and r.ok:
            try:
                js = r.json()
            except Exception:
                print("  no es JSON:", r.text[:200]); continue
            txt = json.dumps(js, ensure_ascii=False)
            print("  claves de primer nivel:", list(js)[:8] if isinstance(js, dict) else type(js).__name__)
            for w in ("INIA", "DGA", "Agromet", "Dirección General de Aguas", "propietario", "institucion", "red"):
                print(f"  «{w}»:", len(re.findall(w, txt, flags=re.I)), "veces")
            lista = js.get("datos") if isinstance(js, dict) else js
            e = (lista[0] if isinstance(lista, list) and lista else None)
            if e: print("  ejemplo:", json.dumps(e, ensure_ascii=False)[:600])
