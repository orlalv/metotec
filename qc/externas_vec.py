"""Vecinas externas (INIA, CEAZA, SERVIMET…) para los controles: solo comparación, nunca se muestran como estaciones.

Lee del KV lo que deja qc/externas.py (qc/externas/cat y qc/externas/<VAR>), lo lleva a las mismas variables y unidades que las nuestras
(Ts °C, Td °C, HR %, QFF hPa, viento medio kt, lluvia mm/h, hora UTC en que termina el acumulado) y entrega las vecinas externas de cada estación DMC:
  · viento km/h → kt; Td desde TA y HR (Magnus); QFF desde la presión de estación con la altura (sin QFF sobre 1500 m)
  · pesan menos que una DMC (PESO_EXT) y cada estación usa a lo más TOPE_EXT externas (las más cercanas, ≤ RADIO_KM y ≤ DZ_M de diferencia de altura)
  · la lista de desactivadas (KV qc/externas/off, {"off": [id…]}) se respeta siempre
Cada mediana de vecinas se calcula ponderada y exige al menos MIN_N vecinas y MIN_PESO de peso total (3 DMC = 3; 1 DMC + 3 externas = 2,5).
Las externas son vecinas, no estaciones: no se les calcula ninguna alerta y no salen en mapas, listas ni contadores.
"""
import json
import math
from pathlib import Path
import numpy as np
import pandas as pd

import pruebas as P

KV_OFF = "qc/externas/off"
KV_DESVIO = "qc/externas/desvio"
VARS_KV = ("PP", "TA", "HR", "VV", "PS")
PESO_EXT = {"T": 0.5, "Td": 0.5, "HR": 0.5, "P_mar": 0.5, "ff10": 0.3, "rr1h": 0.5}
MIN_N, MIN_PESO = 3, 2.5
TOPE_EXT = 4                 # externas por estación
RADIO_KM, DZ_M = 80, 400
ALT_PMAR = 1500
KT = 1 / 1.852               # km/h → kt
PP_MAX_H = 120.0             # mm en una hora: sobre esto el dato externo se descarta
VENTANA_H = 12               # horas de historial que se mezclan con las nuestras (la comparación mira 8 h)


def es_ext(cod):
    return ":" in str(cod)


def inst(cod):
    return str(cod).split(":", 1)[0]


def td_magnus(T, HR):
    """Punto de rocío (°C) desde temperatura y humedad relativa (inversa de P.hr_magnus)."""
    a, b = 17.62, 243.12
    g = np.log(np.clip(HR, 1.0, 100.0) / 100.0) + a * T / (b + T)
    return b * g / (a - g)


def qff(ps, T, alt):
    """Presión reducida al nivel del mar con la altura (misma fórmula que ZP05); NaN sobre ALT_PMAR o sin altura."""
    if alt is None or alt > ALT_PMAR:
        return np.full(len(ps), np.nan)
    tm = T + 273.15 + 0.0065 * alt / 2
    return ps * np.exp(9.80665 * alt / (287.05 * tm))


def _largo(datos, idx=None):
    filas = []
    for i, s in (datos or {}).items():
        for h, v in s.items():
            x = v[idx] if (idx is not None and isinstance(v, (list, tuple))) else (None if idx is not None else v)
            if x is not None:
                filas.append((i, h, float(x)))
    if not filas:
        return pd.Series(dtype=float)
    d = pd.DataFrame(filas, columns=["codigo", "h", "v"])
    d["momento"] = pd.to_datetime(d["h"], format="%Y-%m-%dT%H", errors="coerce")
    return d.dropna(subset=["momento"]).set_index(["codigo", "momento"])["v"]


def tabla(datos, cat, off=()):
    """DataFrame horario largo (codigo, momento, T, Td, HR, P_mar, ff10, rr1h, n) de las externas activas con altura conocida."""
    off = set(off)
    ok = {i: c for i, c in cat.items() if i not in off and c.get("alt") is not None and c.get("lat") is not None}
    S = {"T": _largo(datos.get("TA")), "HR": _largo(datos.get("HR")), "ff10": _largo(datos.get("VV"), 0) * KT,
         "ps": _largo(datos.get("PS")), "rr1h": _largo(datos.get("PP"))}
    D = pd.DataFrame(S)
    if D.empty:
        return pd.DataFrame(columns=["codigo", "momento", "T", "Td", "HR", "P_mar", "ff10", "rr1h", "n"])
    D = D[D.index.get_level_values(0).isin(ok)]
    D = D.reset_index()
    D.columns = ["codigo", "momento"] + list(D.columns[2:])
    # límites físicos (los mismos de la prueba de rango) y coherencia básica
    D.loc[~D["T"].between(*P.LIM["T"]), "T"] = np.nan
    D.loc[~D["HR"].between(*P.LIM["HR"]), "HR"] = np.nan
    D.loc[~D["ff10"].between(*P.LIM["ff10"]), "ff10"] = np.nan
    D.loc[~D["rr1h"].between(0, PP_MAX_H), "rr1h"] = np.nan
    D["Td"] = td_magnus(D["T"], D["HR"])
    D.loc[~D["Td"].between(*P.LIM["Td"]), "Td"] = np.nan
    alt = D["codigo"].map({i: c["alt"] for i, c in ok.items()}).astype(float)
    esp = pd.Series([P.p_esperada(a) for a in alt], index=D.index)
    ps = D["ps"].where((D["ps"] - esp).abs() <= 40)                    # presión de estación incoherente con su altura: se descarta
    q = pd.Series(np.nan, index=D.index)
    m = alt <= ALT_PMAR
    if m.any():
        tm = D.loc[m, "T"] + 273.15 + 0.0065 * alt[m] / 2
        q[m] = ps[m] * np.exp(9.80665 * alt[m] / (287.05 * tm))
    D["P_mar"] = q.where(q.between(*P.LIM["P_mar"]))
    D["n"] = np.where(D["rr1h"].notna(), 60, np.nan)
    return D[["codigo", "momento", "T", "Td", "HR", "P_mar", "ff10", "rr1h", "n"]]


class Ext:
    """Externas ya convertidas: H (largo), meta por id y vecinas externas de cada estación DMC."""

    def __init__(self, H, cat, vec, off, generado=None):
        self.H, self.cat, self.vec, self.off, self.generado = H, cat, vec, set(off), generado
        self.alt = {i: c["alt"] for i, c in cat.items()}
        self.P = {v: H.pivot(index="momento", columns="codigo", values=v) for v in ("T", "Td", "HR", "P_mar", "ff10", "rr1h")} if len(H) else {}

    def valores(self, var, hora, cod):
        """[(id, valor, peso)] de las externas vecinas de `cod` con dato en esa hora."""
        F = self.P.get(var)
        if F is None or hora not in F.index:
            return []
        fila = F.loc[hora]
        return [(i, float(fila[i]), PESO_EXT[var]) for i in self.vec.get(cod, []) if i in fila.index and pd.notna(fila[i])]

    def lluvia(self, horas, cod):
        """[(id, mm en las horas dadas, peso)] de las vecinas externas con dato en todas las horas."""
        F = self.P.get("rr1h")
        if F is None or not all(h in F.index for h in horas):
            return []
        out = []
        for i in self.vec.get(cod, []):
            if i in F.columns:
                x = F.loc[list(horas), i]
                if x.notna().all():
                    out.append((i, float(x.sum()), PESO_EXT["rr1h"]))
        return out


def cargar(leer_kv, E, ahora=None):
    """Lee el KV y arma Ext con las vecinas externas de cada estación de E (DataFrame: codigo, lat, lon, alt). None si no hay datos."""
    cat = leer_kv("qc/externas/cat")
    if not isinstance(cat, dict) or not cat.get("estaciones"):
        return None
    o = leer_kv(KV_OFF)
    off = o.get("off", []) if isinstance(o, dict) else []
    datos, gen = {}, cat.get("generado")
    for v in VARS_KV:
        d = leer_kv(f"qc/externas/{v}")
        if isinstance(d, dict) and d.get("datos"):
            datos[v] = d["datos"]
    if not datos:
        return None
    C = {c["id"]: c for c in cat["estaciones"]}
    H = tabla(datos, C, off)
    if H.empty:
        return None
    if ahora is not None:       # solo las últimas horas: es lo único que se mezcla con el minutario reciente
        H = H[H["momento"] > pd.Timestamp(ahora) - pd.Timedelta(hours=VENTANA_H + 40)]
    return Ext(H, {i: C[i] for i in H["codigo"].unique()}, vecinas_ext(E, {i: C[i] for i in H["codigo"].unique()}), off, gen)


def _km(la1, lo1, la2, lo2):
    la1, lo1, la2, lo2 = (np.radians(x) for x in (la1, lo1, la2, lo2))
    a = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * np.arcsin(np.sqrt(a))


def vecinas_ext(E, cat, radio=RADIO_KM, dz=DZ_M, tope=TOPE_EXT):
    """{código DMC: [id externas más cercanas, hasta `tope`]} a ≤ radio km y ≤ dz m de diferencia de altura."""
    if not cat:
        return {}
    ids = list(cat)
    la = np.array([cat[i]["lat"] for i in ids], float)
    lo = np.array([cat[i]["lon"] for i in ids], float)
    al = np.array([cat[i]["alt"] for i in ids], float)
    out = {}
    for r in E.dropna(subset=["lat", "lon"]).to_dict("records"):
        d = _km(float(r["lat"]), float(r["lon"]), la, lo)
        ok = (d <= radio) & (np.abs(al - (0 if pd.isna(r.get("alt")) else float(r["alt"]))) <= dz)
        idx = np.where(ok)[0]
        out[r["codigo"]] = [ids[k] for k in idx[np.argsort(d[idx])][:tope]]
    return out


def unir(X, H, E, V):
    """Mezcla las externas con la tabla horaria H (largo), el catastro E y las vecinas V. Devuelve (H2, E2, V2); V2[cod] = DMC + externas."""
    if X is None or X.H.empty or H is None or H.empty:
        return H, E, V
    t0 = H["momento"].min()
    Hx = X.H[X.H["momento"] >= t0]
    if Hx.empty:
        return H, E, V
    usadas = {i for L in X.vec.values() for i in L}
    Hx = Hx[Hx["codigo"].isin(usadas)]
    Ex = pd.DataFrame([dict(codigo=i, nombre=i, oaci="", lat=X.cat[i]["lat"], lon=X.cat[i]["lon"], alt=X.cat[i]["alt"]) for i in sorted(usadas)])
    V2 = {c: list(L) + [i for i in X.vec.get(c, []) if i not in L] for c, L in V.items()}
    return pd.concat([H, Hx], ignore_index=True), pd.concat([E, Ex], ignore_index=True), V2


def peso(cod, var):
    return PESO_EXT.get(var, 0.5) if es_ext(cod) else 1.0


def mediana_pond(vals, pesos):
    """Mediana ponderada (el primer valor cuya masa acumulada llega a la mitad; promedia si cae justo en el medio)."""
    v = np.asarray(vals, float)
    w = np.asarray(pesos, float)
    o = np.argsort(v)
    v, w = v[o], w[o]
    c = np.cumsum(w)
    mitad = c[-1] / 2
    k = int(np.searchsorted(c, mitad))
    if k + 1 < len(v) and math.isclose(c[k], mitad):
        return float((v[k] + v[k + 1]) / 2)
    return float(v[min(k, len(v) - 1)])


def suficiente(pesos, min_n=MIN_N, min_peso=MIN_PESO):
    return len(pesos) >= min_n and sum(pesos) >= min_peso - 1e-9


def mad_pond(vals, pesos, med):
    return mediana_pond(np.abs(np.asarray(vals, float) - med), pesos)


def ref_filas(F, var, min_n=MIN_N, min_peso=MIN_PESO):
    """F: DataFrame (horas × vecinas) ya corregido por altura. Mediana ponderada fila a fila (NaN si faltan vecinas o peso).
    Devuelve (Serie referencia, DataFrame bool de las vecinas con dato en cada hora)."""
    w = np.array([peso(c, var) for c in F.columns])
    fin = F.notna()
    out = {}
    for t, fila in F.iterrows():
        m = fila.notna().values
        out[t] = mediana_pond(fila.values[m], w[m]) if suficiente(w[m], min_n, min_peso) else np.nan
    return pd.Series(out, dtype=float), fin


def nota(vs, mask_fila):
    """Línea de detalle para la alerta cuando la referencia se apoyó en externas: '' si no hubo."""
    ex = [c for c in vs if es_ext(c) and bool(mask_fila.get(c, False))]
    if not ex:
        return ""
    ins = {}
    for c in ex:
        ins[inst(c)] = ins.get(inst(c), 0) + 1
    return f" La referencia incluye {len(ex)} estaciones externas de menor peso ({', '.join(f'{k} {n}' for k, n in sorted(ins.items()))})."


# ------------------------------------------------------------------ archivo de lluvia horaria de las externas (para periodos más largos que las 42 h del KV)
def archivar_pp(raiz, X):
    """Acumula la lluvia horaria de las externas vecinas en <raiz>/ext/pp/AAAA/MM/DD.json ({id: {HH: mm}}), solo las que se usan como vecinas."""
    if X is None or "rr1h" not in X.P:
        return 0
    F = X.P["rr1h"]
    usadas = {i for L in X.vec.values() for i in L}
    n = 0
    for dia, g in F.groupby(F.index.floor("D")):
        f = Path(raiz) / "ext" / "pp" / f"{dia:%Y/%m/%d}.json"
        try:
            prev = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
        except Exception:
            prev = {}
        for i in g.columns:
            if i not in usadas:
                continue
            s = g[i].dropna()
            if len(s):
                prev.setdefault(i, {}).update({f"{t:%H}": round(float(x), 1) for t, x in s.items()})
                n += len(s)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(prev, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return n


def archivar_ta(raiz, X):
    """Acumula la temperatura horaria (media) de las externas vecinas en <raiz>/ext/ta/AAAA/MM/DD.json ({id: {HH: °C}}), solo las que se usan como vecinas.
    Es lo que usa la pestaña Agro para mostrar las externas en el mapa de cercanas de semanas pasadas (el KV solo guarda ~42 h)."""
    if X is None or "T" not in X.P:
        return 0
    F = X.P["T"]
    usadas = {i for L in X.vec.values() for i in L}
    n = 0
    for dia, g in F.groupby(F.index.floor("D")):
        f = Path(raiz) / "ext" / "ta" / f"{dia:%Y/%m/%d}.json"
        try:
            prev = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
        except Exception:
            prev = {}
        for i in g.columns:
            if i not in usadas:
                continue
            s = g[i].dropna()
            if len(s):
                prev.setdefault(i, {}).update({f"{t:%H}": round(float(x), 1) for t, x in s.items()})
                n += len(s)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(prev, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return n


def leer_pp(raiz, desde, hasta, X=None):
    """Lluvia horaria de las externas (hora × id): lo archivado más lo que trae X (que manda)."""
    cols = {}
    t = pd.Timestamp(desde).floor("D")
    while t <= pd.Timestamp(hasta):
        f = Path(raiz) / "ext" / "pp" / f"{t:%Y/%m/%d}.json"
        try:
            js = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
        except Exception:
            js = {}
        for i, hs in js.items():
            for hh, x in hs.items():
                cols.setdefault(i, {})[t + pd.Timedelta(hours=int(hh))] = x
        t += pd.Timedelta(days=1)
    A = pd.DataFrame(cols, dtype=float)
    if X is not None and "rr1h" in X.P:
        A = X.P["rr1h"].combine_first(A) if len(A) else X.P["rr1h"].copy()
    return A.sort_index()


# ------------------------------------------------------------------ señal «se desvía de sus vecinas» (opcional, para el menú de Gestión)
DESVIO = {"T": 3.0, "HR": 20.0}      # diferencia mediana de 24 h contra la mediana de las DMC vecinas (con corrección de altura en T)


def desvios(X, H, E, V, min_horas=12):
    """{id: {T: dif, HR: dif, n: horas}} solo de las externas que se apartan sostenidamente de sus vecinas DMC (≥ 3)."""
    if X is None or H is None or H.empty:
        return {}
    alt = {c: (0.0 if pd.isna(z) else float(z)) for c, z in E.set_index("codigo")["alt"].items()}
    Ha = H.pivot(index="momento", columns="codigo")
    out = {}
    for i, c in X.cat.items():
        d = _km(c["lat"], c["lon"], E["lat"].astype(float).values, E["lon"].astype(float).values)
        cand = [k for k in np.argsort(d)[:12] if d[k] <= RADIO_KM and abs(alt.get(E.iloc[k]["codigo"], 0) - c["alt"]) <= DZ_M and E.iloc[k]["codigo"] in Ha["T"].columns]
        vs = [E.iloc[k]["codigo"] for k in cand]
        if len(vs) < 3 or i not in X.P["T"].columns:
            continue
        res = {}
        for v, corr in (("T", True), ("HR", False)):
            ref = pd.DataFrame({k: Ha[v][k] + (0.0065 * (alt[k] - c["alt"]) if corr else 0) for k in vs if k in Ha[v].columns})
            ref = ref[ref.notna().sum(axis=1) >= 3].median(axis=1)
            dif = (X.P[v][i] - ref).dropna()
            if len(dif) >= min_horas and abs(dif).gt(DESVIO[v]).sum() >= min_horas:
                res[v] = round(float(dif.median()), 1)
        if res:
            res["n"] = int(len(dif))
            out[i] = res
    return out
