"""Atiende un pedido de «Revisar período»: baja los mensajes METAR/SYNOP de SACLIM de cada día, los revisa con las reglas de
sensorial.py (más coherencia METAR–SYNOP y horas faltantes) y sube el resultado al KV (qc/periodo/{id})."""
import argparse, json, sys
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
sys.path.insert(0, str(Path(__file__).parent))
import periodo as P, extraccion as X, sensorial as SEN
from correr import leer_archivo, subir_kv
import os, requests


def kv_bytes(clave):
    acc, tok, ns = os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"], os.environ["KV_ID"]
    r = requests.get(f"https://api.cloudflare.com/client/v4/accounts/{acc}/storage/kv/namespaces/{ns}/values/{clave}",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=120)
    r.raise_for_status()
    return r.content


def minutario(datos, desde, hasta, cod):
    fin = hasta + pd.Timedelta(hours=24)
    if fin <= INICIO_ARCHIVO:
        return None
    horas = int((fin - max(desde - pd.Timedelta(hours=14), INICIO_ARCHIVO)) / pd.Timedelta(hours=1)) + 1
    A = leer_archivo(datos, fin, horas=min(horas, 24 * 40))
    return A[A["codigo"] == cod] if len(A) else None


def revisar_archivos(p, datos):
    """Une las extracciones subidas (pueden ser varias, de elementos o períodos distintos) y revisa cada estación."""
    est = {}
    for i, k in enumerate(p["archivos"]):
        f = Path(f"subida_{i}.xlsx"); f.write_bytes(kv_bytes(k))
        for cod, e in X.leer(f).items():
            d = est.setdefault(cod, dict(nombre=e["nombre"], obs={}))
            for t, o in e["obs"].items():
                d["obs"].setdefault(t, {}).update(o)
    hall, resumen = [], []
    for cod, e in est.items():
        obs = dict(sorted(e["obs"].items()))
        if not obs:
            continue
        t0, t1 = min(obs), max(obs)
        A = minutario(datos, t0.normalize(), t1.normalize(), cod)
        A0 = A if A is not None else pd.DataFrame(columns=["codigo", "momento"])
        h = []
        ts = sorted(obs)
        # por meses, con 2 días previos de contexto (las reglas miran horas vecinas): así el tiempo crece en forma lineal
        for m0 in pd.date_range(t0.normalize().replace(day=1), t1, freq="MS"):
            m1 = m0 + pd.offsets.MonthBegin(1)
            sub = {t: obs[t] for t in ts if m0 - pd.Timedelta(days=2) <= t < m1 + pd.Timedelta(hours=12)}
            n_mes = sum(1 for t in sub if m0 <= t < m1)
            if n_mes:
                fin_mes = max(t for t in sub if t < m1)
                sub = {t: o for t, o in sub.items() if t <= fin_mes}
                h += SEN.revisar(cod, sub, A0, horas=n_mes)
        for x in h:
            x["nombre"] = e["nombre"]
        hall += h
        resumen.append(dict(codigo=cod, nombre=e["nombre"], desde=str(t0), hasta=str(t1), horas=len(obs), hallazgos=len(h),
                            con_ema=A is not None and len(A) > 0))
        print(cod, e["nombre"], len(obs), "horas,", len(h), "hallazgos")
    hall.sort(key=lambda h: (h["hora"], h["codigo"], -h["nivel"]))
    R = dict(codigo=",".join(r["codigo"] for r in resumen), nombre=" · ".join((r["nombre"] or r["codigo"]) for r in resumen),
             desde=min((r["desde"][:10] for r in resumen), default=""), hasta=max((r["hasta"][:10] for r in resumen), default=""),
             estaciones=resumen, origen="archivo", hallazgos=hall, metar=0, synop=0, fallas=[], mensajes={},
             dias=sum(1 for _ in {h[:10] for r in resumen for h in [r["desde"]]}),
             con_ema=any(r["con_ema"] for r in resumen))
    if resumen:
        R["dias"] = (pd.Timestamp(R["hasta"]) - pd.Timestamp(R["desde"])).days + 1
    return R

INICIO_ARCHIVO = pd.Timestamp("2026-11-08 18:00")        # desde aquí METOTEC guarda el minutario de las EMA


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pedido", required=True, help="JSON {id, cod, desde, hasta}")
    ap.add_argument("--datos", default="datos")
    a = ap.parse_args()
    p = json.loads(a.pedido)
    clave = f"qc/periodo/{p['id']}"
    subir_kv(clave, json.dumps({**p, "estado": "revisando"}))
    try:
        if p.get("tipo") == "archivo":
            R = revisar_archivos(p, a.datos)
            R.update(id=p["id"], pedido=p.get("pedido"), estado="listo", generado=datetime.now(timezone.utc).isoformat(timespec="seconds"))
            txt = json.dumps(R, ensure_ascii=False, default=str)
            print("kv:", subir_kv(clave, txt), len(txt) // 1024, "kB")
            return
        desde, hasta = pd.Timestamp(p["desde"]), pd.Timestamp(p["hasta"])
        A = None
        fin = hasta + pd.Timedelta(hours=24)
        if fin > INICIO_ARCHIVO:
            horas = int((fin - max(desde - pd.Timedelta(hours=14), INICIO_ARCHIVO)) / pd.Timedelta(hours=1)) + 1
            A = leer_archivo(a.datos, fin, horas=horas)
            A = A[A["codigo"] == p["cod"]] if len(A) else None
        R = P.revisar(p["cod"], desde, hasta, A)
        try:
            E = {e["codigo"]: e for e in json.loads((Path(a.datos) / "estaciones.json").read_text())}
            R["nombre"] = E.get(p["cod"], {}).get("nombre")
        except Exception:
            pass
        R.update(id=p["id"], pedido=p.get("pedido"), estado="listo", generado=datetime.now(timezone.utc).isoformat(timespec="seconds"))
        txt = json.dumps(R, ensure_ascii=False, default=str)
        print(p["id"], R["metar"], "METAR,", R["synop"], "SYNOP,", len(R["hallazgos"]), "hallazgos,", len(txt) // 1024, "kB")
        print("kv:", subir_kv(clave, txt))
    except Exception as e:
        print("error:", e)
        subir_kv(clave, json.dumps({**p, "estado": "error", "error": str(e)}))
        raise


if __name__ == "__main__":
    main()
