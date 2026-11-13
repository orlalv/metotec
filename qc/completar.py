"""Punto 36 · completar huecos cortos de las series horarias de SACLIM (≤ 10 h seguidas, con dato antes y después).

  Ts, Td   interpolación de la anomalía respecto del ciclo diario de la estación (mes y hora) + el ciclo diario
           (si hay pocos años para ese mes y hora, interpolación lineal simple)
  QFE, QFF interpolación lineal entre la hora anterior y la siguiente
  HR       derivada de Ts y Td (Magnus), solo donde HR falta y existen Ts y Td (originales o completadas)
  ff, RRR6 NO se completan (viento y precipitación no se pueden inventar)

No toca los archivos originales: escribe saclim/completado/{cod}.csv.gz con fecha (UTC), var, valor, metodo, hueco_h
(estado «rellenado», gris en la ficha de estación). Las horas con datos dudosos (revisar_estacion) no sirven de ancla
si se pasa «excluir»."""
import json
from datetime import datetime, timezone
from pathlib import Path
import numpy as np, pandas as pd

MAX_H = 10
MIN_CLIMA = 30                      # años·días mínimos por (mes, hora) para usar el ciclo diario
RANGO = {"Ts": (-35, 46), "Td": (-50, 32), "QFE": (500, 1080), "QFF": (920, 1060)}


def _es(T):
    return 6.112 * np.exp(17.62 * T / (243.12 + T))


def huecos(x, max_h=MAX_H):
    """Lista de (i0, i1) con las posiciones [i0, i1) de cada hueco de largo ≤ max_h que tiene dato a ambos lados."""
    na = x.isna().to_numpy()
    out, i, n = [], 0, len(na)
    while i < n:
        if na[i]:
            j = i
            while j < n and na[j]:
                j += 1
            if i > 0 and j < n and (j - i) <= max_h:
                out.append((i, j))
            i = j
        else:
            i += 1
    return out


def _clima(x):
    """Mediana por (mes, hora) y número de datos."""
    g = x.groupby([x.index.month, x.index.hour])
    return g.transform("median"), g.transform("count")


def completar_var(x, v, max_h=MAX_H):
    """x: serie horaria (índice con paso de 1 h). Devuelve DataFrame (valor, metodo, hueco_h) de las horas completadas."""
    filas = []
    if v in ("Ts", "Td"):
        cl, nn = _clima(x)
    for i0, i1 in huecos(x, max_h):
        idx = x.index[i0:i1]
        a, b = x.iloc[i0 - 1], x.iloc[i1]
        L = i1 - i0
        w = np.arange(1, L + 1) / (L + 1)
        lin = a + (b - a) * w
        metodo = "lineal"
        if v in ("Ts", "Td"):
            ca, cb = cl.iloc[i0 - 1], cl.iloc[i1]
            cg, ng = cl.iloc[i0:i1].to_numpy(), nn.iloc[i0:i1].to_numpy()
            if pd.notna(ca) and pd.notna(cb) and not np.isnan(cg).any() and (ng >= MIN_CLIMA).all() and nn.iloc[i0 - 1] >= MIN_CLIMA and nn.iloc[i1] >= MIN_CLIMA:
                an = (a - ca) + ((b - cb) - (a - ca)) * w          # anomalía interpolada
                lin = cg + an
                metodo = "ciclo diario"
        lo, hi = RANGO[v] if v in RANGO else (-1e9, 1e9)
        for t, val in zip(idx, lin):
            filas.append((t, float(np.clip(val, lo, hi)), metodo, L))
    return pd.DataFrame(filas, columns=["fecha", "valor", "metodo", "hueco_h"]).set_index("fecha")


def completar(S, max_h=MAX_H, excluir=None):
    """S: DataFrame horario con Ts, Td, HR, QFE, QFF (columnas que existan). Devuelve DataFrame largo
    (fecha, var, valor, metodo, hueco_h). «excluir»: conjunto de (fecha, var) con dato dudoso, tratado como faltante."""
    if S.empty:
        return pd.DataFrame(columns=["fecha", "var", "valor", "metodo", "hueco_h"])
    S = S.copy()
    S = S[~S.index.duplicated()].sort_index()
    S = S.reindex(pd.date_range(S.index.min(), S.index.max(), freq="h"))
    if excluir:
        for t, v in excluir:
            if v in S and pd.Timestamp(t) in S.index:
                S.loc[pd.Timestamp(t), v] = np.nan
    res = []
    lleno = {}
    for v in ("Ts", "Td", "QFE", "QFF"):
        if v not in S:
            continue
        r = completar_var(S[v], v, max_h)
        lleno[v] = r
        for t, f in r.iterrows():
            res.append((t, v, round(f.valor, 1), f.metodo, int(f.hueco_h)))
    # Td nunca mayor que Ts
    if "Ts" in lleno and "Td" in lleno:
        for k, (t, v, val, m, L) in enumerate(res):
            if v == "Td":
                ts = S["Ts"].get(t)
                if pd.isna(ts) and t in lleno["Ts"].index:
                    ts = lleno["Ts"].at[t, "valor"]
                if pd.notna(ts) and val > ts:
                    res[k] = (t, v, round(float(ts), 1), m, L)
    # HR derivada donde falta (hueco ≤ max_h con ancla)
    if "HR" in S and "Ts" in S and "Td" in S:
        Ts, Td = S["Ts"].copy(), S["Td"].copy()
        for t, v, val, m, L in res:
            if v == "Ts": Ts[t] = val
            if v == "Td": Td[t] = val
        for i0, i1 in huecos(S["HR"], max_h):
            for t in S.index[i0:i1]:
                if pd.notna(Ts[t]) and pd.notna(Td[t]):
                    hr = float(np.clip(round(100 * _es(Td[t]) / _es(Ts[t])), 1, 100))
                    res.append((t, "HR", hr, "derivada de Ts y Td", i1 - i0))
    D = pd.DataFrame(res, columns=["fecha", "var", "valor", "metodo", "hueco_h"])
    return D.sort_values(["fecha", "var"]).reset_index(drop=True)


def escribir(raiz, cod, D, ahora=None):
    d = Path(raiz) / "saclim" / "completado"
    d.mkdir(parents=True, exist_ok=True)
    D.to_csv(d / f"{cod}.csv.gz", index=False, compression={"method": "gzip", "mtime": 0})
    return d / f"{cod}.csv.gz"


def completar_todo(raiz, cods, max_h=MAX_H, log=print):
    """Lee las series guardadas (series_h.serie), completa y guarda; escribe saclim/completado/resumen.json."""
    import series_h as SH
    resumen = []
    for c in cods:
        S, _ = SH.serie(raiz, c)
        if S.empty:
            continue
        D = completar(S, max_h)
        escribir(raiz, c, D)
        cnt = D.groupby("var").size().to_dict() if len(D) else {}
        resumen.append(dict(codigo=str(c), desde=str(S.index.min())[:10], hasta=str(S.index.max())[:10], completadas=cnt))
        log(f"{c}: {len(D)} horas completadas {cnt}")
    (Path(raiz) / "saclim" / "completado").mkdir(parents=True, exist_ok=True)
    (Path(raiz) / "saclim" / "completado" / "resumen.json").write_text(json.dumps(
        dict(generado=datetime.now(timezone.utc).isoformat(timespec="seconds"), max_h=max_h, estaciones=resumen), ensure_ascii=False))
    return resumen
