"""Pruebas de control de calidad.

Cada prueba devuelve una lista de alertas:
  dict(codigo, prueba, var, nivel, momento, valor, ref, msg)
nivel 1 = sospechoso, 2 = erróneo.

Inspirado en los niveles de MADIS (rango, temporal, espacial) y en las pruebas
de consistencia espacial y aislamiento de TITAN (MET Norway).
"""
import math
import numpy as np
import pandas as pd

# ------------------------------------------------------------------ utilidades
def hr_magnus(T, Td):
    a, b = 17.62, 243.12
    return 100 * np.exp(a * Td / (b + Td) - a * T / (b + T))


def distancia_km(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    return 12742 * math.asin(math.sqrt(a))


def alerta(cod, prueba, var, nivel, momento, valor, ref, msg):
    return dict(codigo=str(cod), prueba=prueba, var=var, nivel=int(nivel), momento=str(momento),
                valor=None if valor is None or pd.isna(valor) else round(float(valor), 2),
                ref=None if ref is None or pd.isna(ref) else round(float(ref), 2), msg=msg)


def horario(D):
    """Valor de cada hora: el dato del minuto 00 o el más cercano de los 15 minutos previos; lluvia sumada en la hora."""
    if D.empty:
        return D
    D = D.copy()
    D["hora"] = D["momento"].dt.ceil("h")
    D["antes"] = (D["hora"] - D["momento"]).dt.total_seconds() / 60
    ult = D[D["antes"] <= 15].sort_values("antes").groupby(["codigo", "hora"]).first().reset_index()
    rr = D.groupby(["codigo", "hora"])["rr1m"].agg(["sum", "count"]).reset_index().rename(columns={"sum": "rr1h", "count": "n"})
    H = rr.merge(ult, on=["codigo", "hora"], how="left").drop(columns=["momento", "antes"]).rename(columns={"hora": "momento"})
    return H


# ------------------------------------------------------------------ 1. rango
LIM = {"T": (-40, 45), "Td": (-60, 35), "HR": (1, 100), "P_est": (450, 1080), "P_mar": (920, 1060),
       "ff10": (0, 150), "dd10": (0, 360), "rr1m": (0, 8), "Rad": (0, 1600)}


def rango(D):
    out = []
    for v, (lo, hi) in LIM.items():
        malo = D[(D[v] < lo) | (D[v] > hi)]
        for cod, g in malo.groupby("codigo"):
            r = g.iloc[-1]
            out.append(alerta(cod, "rango", v, 2, r.momento, r[v], None, f"{len(g)} valores fuera de rango físico [{lo}, {hi}]"))
    # radiación sostenida sobre la constante solar (posible sensor descalibrado)
    alto = D[(D["Rad"] > 1360) & (D["Rad"] <= 1600)].groupby("codigo")
    for cod, g in alto:
        if len(g) >= 10:
            r = g.iloc[-1]
            out.append(alerta(cod, "rango", "Rad", 1, r.momento, r["Rad"], 1360, f"{len(g)} minutos sobre 1360 W/m² (posible sensor descalibrado)"))
    return out


# ------------------------------------------------------------------ 2. saltos
SALTO = {"T": (4, 8), "HR": (25, 45), "P_est": (1.5, 3)}   # máximo cambio en ≤ 10 min (sospechoso, erróneo)


def saltos(D):
    out = []
    for cod, g in D.groupby("codigo"):
        g = g.sort_values("momento")
        dt = g["momento"].diff().dt.total_seconds() / 60
        for v, (s1, s2) in SALTO.items():
            d = g[v].diff().abs()
            m = (dt <= 10) & d.notna()
            if not m.any():
                continue
            i = d[m].idxmax()
            dmax = d[i]
            if dmax > s1:
                out.append(alerta(cod, "salto", v, 2 if dmax > s2 else 1, g.at[i, "momento"], g.at[i, v], g[v].shift().at[i],
                                  f"cambio de {dmax:.1f} en {dt[i]:.0f} min"))
    return out


# ------------------------------------------------------------------ 3. valor pegado
def pegados(D, horas=3):
    out = []
    fin = D["momento"].max()
    W = D[D["momento"] > fin - pd.Timedelta(hours=horas)]
    for cod, g in W.groupby("codigo"):
        if g["momento"].nunique() < 6 or (g["momento"].max() - g["momento"].min()) < pd.Timedelta(hours=horas - 0.5):
            continue
        for v, tol in (("T", 0.0), ("HR", 0.0), ("P_est", 0.0), ("Td", 0.0)):
            s = g[v].dropna()
            if len(s) < 6:
                continue
            if v == "HR" and s.min() >= 99:
                continue          # saturación sostenida es posible (niebla)
            if s.max() - s.min() <= tol:
                out.append(alerta(cod, "pegado", v, 1 if v == "P_est" else 2, g["momento"].max(), s.iloc[-1], None,
                                  f"sin cambio durante {horas} h"))
    return out


# ------------------------------------------------------------------ 4. coherencia interna
def coherencia(H, E):
    out = []
    alt = E.set_index("codigo")["alt"].to_dict()
    for r in H.to_dict("records"):
        T, Td, HR, cod, mom = r["T"], r["Td"], r["HR"], r["codigo"], r["momento"]
        if pd.notna(T) and pd.notna(Td) and Td > T + 0.5:
            out.append(alerta(cod, "coherencia", "Td", 2, mom, Td, T, "punto de rocío mayor que la temperatura"))
        if pd.notna(T) and pd.notna(Td) and pd.notna(HR) and 1 <= HR <= 100:
            hc = float(hr_magnus(T, Td))
            if abs(hc - HR) > 15:
                out.append(alerta(cod, "coherencia", "HR", 1, mom, HR, hc, "humedad no cuadra con T y Td"))
        z = alt.get(cod)
        if z is not None and pd.notna(z) and z < 800 and pd.notna(r["P_est"]) and pd.notna(r["P_mar"]) and pd.notna(T) and r["P_mar"] > 900:
            pr = r["P_est"] * math.exp(z / (29.27 * (T + 273.15 + 0.0065 * z / 2)))
            d = abs(pr - r["P_mar"])
            if d > 5:
                out.append(alerta(cod, "coherencia", "P_mar", 2 if d > 10 else 1, mom, r["P_mar"], pr,
                                  "QFF no cuadra con QFE reducida al nivel del mar"))
    return out


# ------------------------------------------------------------------ 5. estaciones vecinas
VEC = {  # var: (piso de dispersión, diferencia mínima sospechosa, diferencia mínima errónea, corrige por altura)
    "T": (1.5, 4, 8, True), "Td": (2.0, 5, 10, True), "P_mar": (1.0, 3, 6, False)}


def vecinas_de(E, radio=120, dz=500, clusters=None):
    """Vecinas de cada estación: misma agrupación si hay clusters, si no, por distancia y diferencia de altura."""
    V = {}
    rows = E.dropna(subset=["lat", "lon"]).to_dict("records")
    for a in rows:
        L = []
        for b in rows:
            if a["codigo"] == b["codigo"]:
                continue
            d = distancia_km(a["lat"], a["lon"], b["lat"], b["lon"])
            ga, gb = (clusters or {}).get(a["codigo"]), (clusters or {}).get(b["codigo"])
            if ga is not None:
                # misma agrupación climática y a menos de 200 km (las agrupaciones abarcan zonas muy amplias)
                ok = ga == gb and d <= 200 and abs((a["alt"] or 0) - (b["alt"] or 0)) <= 2 * dz
            else:
                ok = d <= radio and abs((a["alt"] or 0) - (b["alt"] or 0)) <= dz
            if ok:
                L.append((b["codigo"], d))
        V[a["codigo"]] = [c for c, _ in sorted(L, key=lambda x: x[1])[:12]]
    return V


def vecinas(H, E, V):
    out = []
    alt = E.set_index("codigo")["alt"].to_dict()
    ult = H.sort_values("momento").groupby("codigo").tail(1).set_index("codigo")
    hora = ult["momento"].max()
    ult = ult[ult["momento"] == hora]
    for cod, r in ult.iterrows():
        vs = [c for c in V.get(cod, []) if c in ult.index]
        for v, (piso, s1, s2, corr) in VEC.items():
            if pd.isna(r[v]):
                continue
            ref = []
            for c in vs:
                x = ult.at[c, v]
                if pd.isna(x):
                    continue
                if corr:
                    x = x + 0.0065 * ((alt.get(c) or 0) - (alt.get(cod) or 0))
                ref.append(x)
            if len(ref) < 3:
                continue
            ref = np.array(ref)
            med = np.median(ref)
            sig = max(1.4826 * np.median(np.abs(ref - med)), piso)
            d = abs(r[v] - med)
            z = d / sig
            if z > 4 and d > s1:
                out.append(alerta(cod, "vecinas", v, 2 if (z > 7 and d > s2) else 1, hora, r[v], med,
                                  f"distinta a sus {len(ref)} vecinas (z = {z:.1f})"))
    return out


# ------------------------------------------------------------------ 6. modelo
MOD = {"T": (7, 12), "Td": (9, 15), "P_mar": (5, 10)}


def modelo(H, M, aisladas=()):
    out = []
    if M is None or M.empty:
        return out
    X = H.merge(M, on=["codigo", "momento"], suffixes=("", "_m"))
    X = X.sort_values("momento").groupby("codigo").tail(1)
    for _, r in X.iterrows():
        for v, (s1, s2) in MOD.items():
            o, m = r[v], r[v + "_m"]
            if pd.isna(o) or pd.isna(m):
                continue
            d = abs(o - m)
            if d > s1:
                extra = " (estación aislada: el modelo es su principal referencia)" if r.codigo in aisladas else ""
                out.append(alerta(r.codigo, "modelo", v, 2 if d > s2 else 1, r.momento, o, m, f"diferencia con el modelo de {d:.1f}{extra}"))
    return out


# ------------------------------------------------------------------ 7. lluvia (modelo y vecinas; el satélite se agrega después)
def lluvia(H, M, V):
    out = []
    if H.empty:
        return out
    fin = H["momento"].max()
    W = H[H["momento"] > fin - pd.Timedelta(hours=3)]
    obs = W.groupby("codigo")["rr1h"].sum(min_count=1)
    mod = None
    if M is not None and not M.empty:
        Wm = M[(M["momento"] > fin - pd.Timedelta(hours=3)) & (M["momento"] <= fin)]
        mod = Wm.groupby("codigo")["rr1h"].sum()
    for cod, o in obs.items():
        if pd.isna(o):
            continue
        vs = [obs.get(c) for c in V.get(cod, []) if pd.notna(obs.get(c))]
        vm = float(np.median(vs)) if len(vs) >= 2 else None
        m = None if mod is None else mod.get(cod)
        if o >= 3 and (m is not None and m < 0.2) and (vm is None or vm < 0.2):
            out.append(alerta(cod, "lluvia", "rr3h", 1, fin, o, m, "lluvia sin respaldo del modelo ni de las vecinas"))
        if o == 0 and m is not None and ((vm is not None and vm >= 3 and m >= 3) or (vm is None and m >= 8)):
            out.append(alerta(cod, "lluvia", "rr3h", 1, fin, o, vm if vm is not None else m, "posible pluviómetro obstruido: no marca y alrededor llueve"))
    return out


# ------------------------------------------------------------------ 8. completitud de la última hora
def completitud(D, E):
    out, pct = [], {}
    if D.empty:
        return out, pct
    # se evalúa la última hora cerrada que ya pasó por dos descargas (la hora anterior a la actual)
    fin = D["momento"].max().floor("h") - pd.Timedelta(hours=1)
    ini = fin - pd.Timedelta(hours=1)
    if D["momento"].min() > ini + pd.Timedelta(minutes=5):
        return out, pct          # el archivo todavía no cubre esa hora completa
    red = D[(D["momento"] > ini) & (D["momento"] <= fin)]["momento"].dt.floor("min")
    if red.nunique() < 57 or red.max() < fin - pd.Timedelta(minutes=2):
        return out, pct          # hueco en nuestras descargas (no es falla de las estaciones)
    for cod in E["codigo"]:
        g = D[D["codigo"] == cod]
        if g.empty:
            pct[cod] = 0.0
            continue
        paso = g["momento"].sort_values().diff().dt.total_seconds().median() / 60 if len(g) > 2 else 1
        paso = max(1, round(paso or 1))
        n = g[(g["momento"] > ini) & (g["momento"] <= fin)]["momento"].nunique()
        p = min(100.0, 100 * n / (60 / paso))
        pct[cod] = round(p, 1)
        if p < 80:
            out.append(alerta(cod, "completitud", "registros", 1, fin, p, 100, f"llegó el {p:.0f} % de los datos de la última hora"))
    return out, pct


# ------------------------------------------------------------------ 6b. modelo WRF-DMC (varias corridas)
def modelo_dmc(H, W, aisladas=()):
    """Compara con la mediana de las últimas corridas del WRF-DMC; el umbral crece con la dispersión entre corridas."""
    out = []
    if W is None or W.empty or H.empty:
        return out
    X = H.merge(W, on=["codigo", "momento"]).sort_values("momento").groupby("codigo").tail(1)
    for r in X.to_dict("records"):
        extra = " (estación aislada)" if r["codigo"] in aisladas else ""
        sd = r.get("T_sd_w") if pd.notna(r.get("T_sd_w")) else 0
        for v, (b1, b2, k) in {"T": (6, 10, 3), "HR": (35, 55, 0), "ff10": (15, 25, 0)}.items():
            o, m = r.get(v), r.get(v + "_w")
            if o is None or m is None or pd.isna(o) or pd.isna(m):
                continue
            s1, s2 = (max(b1, k * sd), max(b2, (k + 2) * sd)) if k else (b1, b2)
            d = abs(o - m)
            if d > s1:
                out.append(alerta(r["codigo"], "wrf", v, 2 if d > s2 else 1, r["momento"], o, m,
                                  f"diferencia con el WRF-DMC de {d:.1f} (mediana de {int(r['n_w'])} corridas){extra}"))
    return out
