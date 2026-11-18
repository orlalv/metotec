"""Diagnóstico: ¿a qué hora corresponde cada valor horario de INIA? Compara las estaciones DMC que INIA publica con nuestro archivo minutario."""
import gzip, io, json, re, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np, pandas as pd, requests
sys.path.insert(0, str(Path(__file__).parent))
from externas import H, BASE, CL
datos = Path(sys.argv[1] if len(sys.argv) > 1 else "datos")
tmp = re.search(r"tmp\s*=\s*(tmp_\d+)", requests.get(BASE + "PP", headers=H, timeout=60).text).group(1)
def items(v): return requests.get(f"{BASE}json/{tmp}/items-{v}.json", headers=H, timeout=180).json()
E = pd.DataFrame(json.loads((datos / "estaciones.json").read_text()))
E = E.dropna(subset=["lat", "lon"])
fin = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
fr = []
for k in range(0, 60):
    t = fin - timedelta(hours=k); f = datos / "ema" / f"{t:%Y}/{t:%m}/{t:%d}/{t:%H}.csv.gz"
    if f.exists(): fr.append(pd.read_csv(f, usecols=["codigo", "momento", "T", "rr1m"], dtype={"codigo": str}))
A = pd.concat(fr); A["momento"] = pd.to_datetime(A["momento"]).dt.tz_localize(None)
print("archivo propio:", len(A), "filas,", A["momento"].min(), "→", A["momento"].max())
def cod_de(e):
    d = (E["lat"] - float(e["latitud"])).abs() + (E["lon"] - float(e["longitud"])).abs()
    return str(E.loc[d.idxmin(), "codigo"]) if d.min() < 0.03 else None
P = [e for e in items("pp") if e.get("institucion_sigla") == "DMC"]
M = {}
for e in P:
    c = cod_de(e)
    if c: M[c] = e
print("DMC en INIA:", len(P), "emparejadas con nuestro catálogo:", len(M))
def inia_utc(e):
    out = {}
    for k, v in (e.get("STACK-HOUR") or {}).items():
        try: out[datetime.strptime(k, "%Y-%m-%d %H:%M").replace(tzinfo=CL).astimezone(timezone.utc).replace(tzinfo=None)] = float(v["PP-SUM"])
        except Exception: pass
    return pd.Series(out)
res = {}
for conv, desfase in (("hora que TERMINA en la etiqueta", 0), ("hora que EMPIEZA en la etiqueta", 1)):
    for sh in (-2, -1, 0, 1, 2):
        err, tot, n = 0.0, 0.0, 0
        for c, e in M.items():
            s = inia_utc(e)
            g = A[A["codigo"] == c]
            if g.empty or s.empty: continue
            g = g.assign(h=g["momento"].dt.ceil("h"))
            ours = g.groupby("h")["rr1m"].sum()
            for t, v in s.items():
                t2 = t + pd.Timedelta(hours=desfase + sh)          # etiqueta INIA → hora (UTC) en que termina el acumulado
                if t2 in ours.index and g[g["h"] == t2].shape[0] >= 50:
                    err += abs(ours[t2] - v); tot += max(ours[t2], v); n += 1
        res[(conv, sh)] = (round(err, 1), round(tot, 1), n)
        print(f"{conv} | desfase extra {sh:+d} h: error {err:.1f} mm de {tot:.1f} mm  ({n} horas)")
b = min(res, key=lambda k: res[k][0] / max(res[k][1], 0.1) if res[k][1] > 5 else 9)
print("MEJOR:", b, res[b])
