"""Sondeo temporal: cómo pide agrometeorologia.cl los datos históricos (rutas JSON en sus scripts) y productos mensuales de la DMC."""
import pathlib, re, sys, time, requests
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
H = {"User-Agent": "Mozilla/5.0 (metotec; contacto.metotec@gmail.com)"}
B = "https://agrometeorologia.cl/"
def g(u, nom):
    try:
        r = requests.get(u, headers=H, timeout=60); (out / nom).write_bytes(r.content); print(nom, r.status_code, len(r.content), u); return r.text
    except Exception as e:
        print(nom, "ERR", e); return ""
home = g(B, "home.html")
for p in ("PP", "TA", "evapotranspiracion", "descargas", "descarga", "historico", "datos", "consulta"):
    g(B + p, f"pag_{p}.html"); time.sleep(1)
js = set(re.findall(r'src="([^"]+\.js[^"]*)"', home))
for i, s in enumerate(sorted(js)):
    u = s if s.startswith("http") else B + s.lstrip("/")
    t = g(u, f"js_{i}.js"); time.sleep(1)
    for m in sorted(set(re.findall(r'["\'`]([^"\'`]*(?:json|api|ajax|php|descarg|hist|fecha|desde)[^"\'`]*)["\'`]', t)))[:80]:
        print("   ", m[:160])
for u, n in [("https://climatologia.meteochile.gob.cl/application/mensual/temperaturaMensual/320093/2025/11", "dmc_tmes_320093.html"),
             ("https://climatologia.meteochile.gob.cl/application/mensual/aguaCaidaMensual/320093/2025/11", "dmc_ppmes_320093.html"),
             ("https://climatologia.meteochile.gob.cl/application/informacion/estacionesEnGrupo/Agroclima", "dmc_grupo_agroclima.html")]:
    g(u, n); time.sleep(1)
