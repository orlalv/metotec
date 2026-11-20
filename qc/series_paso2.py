"""Paso 2 de las series históricas: errores groseros y vacíos, calculados con código.

Por estación (series SACLIM guardadas en la rama datos: saclim/{cod}/{año}/{Variable}.csv.gz):
  - VACÍOS: horas sin dato por variable (Ts, Td, QFE, QFF, ff), rachas sin dato (≤ 10 h = rellenables por completar.py; > 10 h = no),
    y las rachas más largas.
  - ERRORES GROSEROS: las reglas de series_h.revisar_estacion (RANGO, DIG, PICO, SALTO, PEGADO, TDTS, HRTD, CLIMA, EXTH, PERIODO).
No modifica ninguna serie. Escribe en {raiz}/saclim/informe_paso2/: {cod}.json, resumen.csv, informe.md.
Uso: python qc/series_paso2.py RAIZ_DATOS [--desde 2011] [--cods 330020 ...]"""
import argparse, json, sys, time
from pathlib import Path
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import series_h

VARS = ["Ts", "Td", "QFE", "QFF", "ff"]
MAX_RELLENABLE = 10


def rachas_vacias(x):
    """Rachas de horas sin dato en una serie horaria ya reindexada. Devuelve lista de (inicio, horas)."""
    na = x.isna()
    if not na.any():
        return []
    b = (na != na.shift()).cumsum()
    out = []
    for _, g in x[na].groupby(b[na]):
        out.append((g.index[0], len(g)))
    return out


def vacios(S, hasta):
    ini, fin = S.index.min().floor("D"), min(S.index.max(), hasta)
    malla = pd.date_range(ini, fin, freq="h")
    res = {}
    for v in VARS:
        if v not in S:
            res[v] = dict(esperadas=len(malla), con_dato=0, pct=0.0, rachas_total=0, rachas_rellenables=0, rachas_largas=0, horas_en_largas=0, peores=[])
            continue
        x = S[v].reindex(malla)
        R = rachas_vacias(x)
        largas = [r for r in R if r[1] > MAX_RELLENABLE]
        res[v] = dict(esperadas=len(malla), con_dato=int(x.notna().sum()), pct=round(100 * x.notna().mean(), 2),
                      rachas_total=len(R), rachas_rellenables=len(R) - len(largas), rachas_largas=len(largas),
                      horas_en_largas=int(sum(h for _, h in largas)),
                      peores=[dict(inicio=str(t)[:16], horas=int(h)) for t, h in sorted(R, key=lambda r: -r[1])[:5]])
    # años completos sin ningún dato de Ts
    sin = [int(a) for a in range(ini.year, fin.year + 1) if "Ts" not in S or S["Ts"][S.index.year == a].notna().sum() == 0]
    return res, sin


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raiz")
    ap.add_argument("--desde", type=int, default=2011)
    ap.add_argument("--cods", nargs="*")
    a = ap.parse_args()
    raiz = Path(a.raiz)
    sal = raiz / "saclim" / "informe_paso2"
    sal.mkdir(parents=True, exist_ok=True)
    cods = a.cods or sorted(p.name for p in (raiz / "saclim").iterdir() if p.is_dir() and p.name[0].isdigit())
    ahora = pd.Timestamp.utcnow().tz_localize(None).floor("h")
    filas = []
    for c in cods:
        t0 = time.time()
        S, E = series_h.serie(raiz, c)
        if S.empty:
            filas.append(dict(codigo=c, sin_datos=True)); print(c, "sin datos"); continue
        S = S[S.index.year >= a.desde]
        E = E[E.index.year >= a.desde] if len(E) else E
        if S.empty:
            filas.append(dict(codigo=c, sin_datos=True)); print(c, "sin datos desde", a.desde); continue
        V, sin_anios = vacios(S, ahora)
        hall, _ = series_h.revisar_estacion(c, S, E)
        reglas = {}
        for h in hall:
            reglas.setdefault(h["regla"], {}).setdefault(h["var"], 0)
            reglas[h["regla"]][h["var"]] += 1
        # solo lo grosero: nivel 2, y pegados / saltos (nivel 1) que el paso pide explícitamente
        graves = [h for h in hall if h["nivel"] == 2 or h["regla"] in ("PEGADO", "SALTO")]
        R = dict(codigo=c, desde=str(S.index.min())[:10], hasta=str(S.index.max())[:10], anios_sin_Ts=sin_anios,
                 vacios=V, reglas=reglas, total_hallazgos=len(hall), graves=len(graves), hallazgos=graves[:3000],
                 generado=str(ahora))
        (sal / f"{c}.json").write_text(json.dumps(R, ensure_ascii=False, separators=(",", ":"), default=str))
        fila = dict(codigo=c, desde=R["desde"][:4], hasta=R["hasta"][:4], anios_sin_Ts=len(sin_anios),
                    **{f"pct_{v}": V[v]["pct"] for v in VARS},
                    **{f"largas_{v}": V[v]["rachas_largas"] for v in ("Ts", "QFE", "ff")},
                    max_vacio_Ts_h=(V["Ts"]["peores"][0]["horas"] if V["Ts"]["peores"] else 0),
                    **{f"R_{k}": sum(d.values()) for k, d in reglas.items()}, graves=len(graves))
        filas.append(fila)
        print(f"{c}: {len(S)} h, Ts {V['Ts']['pct']}%, graves {len(graves)} ({time.time() - t0:.0f}s)", flush=True)
    D = pd.DataFrame(filas).fillna(0)
    for c_ in D.columns:
        if c_.startswith(("R_", "largas_", "graves", "max_vacio")):
            D[c_] = D[c_].astype(int)
    D.to_csv(sal / "resumen.csv", index=False)
    print("listo", len(D), "estaciones")


if __name__ == "__main__":
    main()
