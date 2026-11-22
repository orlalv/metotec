"""Paso 3: normal y desviación estándar por estación, mes y hora (UTC), con las series limpias.

Fuente por estación: SACLIM horaria si tiene (49 estaciones); si no, EMA cada 15 min (dato del minuto :00).
Limpieza: se descartan los valores con hallazgo nivel 2 (erróneo), PEGADO, SALTO o PICO de series_h.revisar_estacion
y la HR = 0 (sensor caído). No toca las series originales.
Salida: {raiz}/normal/{cod}.json  → {codigo, fuente, desde, hasta, n_limpios, vars: {Ts: {"mes": {"1": {"0": [media, sd, n, p1, p99], ...}}}}}
y {raiz}/normal/resumen.csv.   Uso: python qc/series_normal.py RAIZ_DATOS [--desde 2011] [--cods …]"""
import argparse, json, sys, time
from pathlib import Path
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import series_h, series_paso2

VARS = ["Ts", "Td", "QFE", "QFF", "ff"]
MIN_N = 30
MALOS = {"PEGADO", "SALTO", "PICO"}


def limpiar(S, hall):
    S = S.copy()
    if "HR" in S:
        S.loc[S["HR"] == 0, "HR"] = np.nan
    malo = set()
    for h in hall:
        if h["nivel"] == 2 or h["regla"] in MALOS:
            malo.add((pd.Timestamp(h["fecha"]).floor("h"), h["var"]))
    n = 0
    for t, v in malo:
        if v in S.columns and t in S.index and pd.notna(S.at[t, v]):
            S.at[t, v] = np.nan; n += 1
    return S, n


def tabla(x):
    out = {}
    g = x.dropna().groupby([x.dropna().index.month, x.dropna().index.hour])
    for (m, h), s in g:
        if len(s) < MIN_N:
            continue
        out.setdefault(str(m), {})[str(h)] = [round(float(s.mean()), 2), round(float(s.std(ddof=1)), 2), int(len(s)),
                                               round(float(s.quantile(0.01)), 2), round(float(s.quantile(0.99)), 2)]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raiz")
    ap.add_argument("--desde", type=int, default=2011)
    ap.add_argument("--cods", nargs="*")
    a = ap.parse_args()
    raiz = Path(a.raiz)
    sal = raiz / "normal"
    sal.mkdir(exist_ok=True)
    sac = {p.name for p in (raiz / "saclim").iterdir() if p.is_dir() and p.name[0].isdigit() and any(p.glob("*/Temperatura.csv.gz"))}
    ema = {p.name for p in (raiz / "ema15").iterdir() if p.is_dir() and p.name[0].isdigit()}
    cods = a.cods or sorted(sac | ema)
    filas = []
    for c in cods:
        t0 = time.time()
        fuente = "saclim" if c in sac else "ema15"
        S, E = series_h.serie(raiz, c) if fuente == "saclim" else series_paso2.serie_ema15(raiz, c)
        if S.empty:
            continue
        S = S[S.index.year >= a.desde]
        if S.empty:
            continue
        hall, _ = series_h.revisar_estacion(c, S, E[E.index.year >= a.desde] if len(E) else E)
        L, quitados = limpiar(S, hall)
        R = dict(codigo=c, fuente=fuente, desde=str(L.index.min())[:10], hasta=str(L.index.max())[:10], descartados=quitados, vars={})
        fila = dict(codigo=c, fuente=fuente, desde=R["desde"][:4], hasta=R["hasta"][:4], descartados=quitados)
        for v in VARS:
            if v in L:
                R["vars"][v] = {"mes": tabla(L[v])}
                fila[f"n_{v}"] = int(L[v].notna().sum())
                fila[f"celdas_{v}"] = sum(len(h) for h in R["vars"][v]["mes"].values())
        (sal / f"{c}.json").write_text(json.dumps(R, separators=(",", ":")))
        filas.append(fila)
        print(f"{c} {fuente}: {fila.get('n_Ts', 0)} Ts limpios, {quitados} descartados, celdas Ts {fila.get('celdas_Ts', 0)}/288 ({time.time() - t0:.0f}s)", flush=True)
    pd.DataFrame(filas).fillna(0).to_csv(sal / "resumen.csv", index=False)
    print("listo", len(filas))


if __name__ == "__main__":
    main()
