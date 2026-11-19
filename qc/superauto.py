"""Super automático: control más estricto de las estaciones automáticas SIN observador.

Usa el minutario archivado de las últimas ~26 h y umbrales cerca de la mitad de los de la pasada normal
(avisa antes, a costa de más falsas alarmas; cada alerta se puede marcar Resuelto / Falsa alarma / Omitir).
Pestañas: pp (precipitación), ext (extremas Tn12/Tx12), pre (presiones), tem (Ts, Td, HR), vie (viento).
Salida (KV qc/super): {generado, horas, estaciones:[{codigo, nombre, oaci, lat, lon, ultima, nivel, hallazgos:[{hora, regla, nivel, tipo, msg}]}]}
Una alerta por estación y regla (la peor y más reciente); «hora» es el minuto UTC del dato.
"""
import math
import numpy as np
import pandas as pd

import pruebas as P
import externas_vec as EV

# --- umbrales estrictos (sospechoso, erróneo)
SALTO_T = (5, 8)           # °C entre minutos consecutivos: solo saltos groseros (el ruido normal del sensor no avisa)
SALTO_TD = (6.0, 10.0)
SALTO_HR = (30, 45)
SALTO_P = (2.0, 4.0)       # hPa
SALTO_FF10 = (15, 25)      # kt: cambio del viento medio entre dos ventanas de 10 min seguidas (no entre minutos: un minuto casi no mueve un promedio de 10)
TOL_EXT = (1.0, 1.5)      # °C (sospechoso, erróneo): la extrema sale de muestras de segundos y puede pasar ~1 °C al valor por minuto; la normal acepta 1.5
TOL_HR = (6, 12)           # % entre HR informada y la calculada con Ts y Td
TOL_QFF = (3.0, 6.0)       # hPa entre QFF informado y el reducido desde QFE
PEGADO_H = {"T": 3, "Td": 3, "P_est": 3, "HR": 8}      # horas sin cambio (la normal: 3, 3, 3, 10)
VAR3H_P = 10.0             # hPa en 3 h
PP_MIN_HR = 55             # % : lluvia con aire más seco que esto es dudosa
PP_MIN_MIN = 5             # minutos con lluvia para avisar


def _f(m):
    return pd.Timestamp(m).strftime("%Y-%m-%dT%H:%M")


def _h(cod, regla, nivel, tipo, momento, msg, **extra):
    return dict(hora=_f(momento), regla=regla, nivel=int(nivel), tipo=tipo, msg=msg, **extra)


def _salto(g, v, umbral, regla, tipo, nombre, un):
    d = g[v].diff().abs()
    dt = g["momento"].diff().dt.total_seconds() / 60
    m = (dt <= 10) & d.notna()
    if not m.any():
        return None
    i = d[m].idxmax()
    x = d[i]
    if x <= umbral[0]:
        return None
    n = int((d[m] > umbral[0]).sum())
    return _h(None, regla, 2 if x > umbral[1] else 1, tipo, g.at[i, "momento"],
              f"{nombre}: cambio de {x:.1f} {un} en {dt[i]:.0f} min ({g[v].shift().at[i]:.1f} → {g.at[i, v]:.1f})" + (f"; {n} saltos en 24 h" if n > 1 else ""))


def _pegado(g, v, horas, regla, tipo, nombre, filtro=None):
    fin = g["momento"].max()
    W = g[g["momento"] > fin - pd.Timedelta(hours=horas)]
    if W["momento"].nunique() < 6 or (W["momento"].max() - W["momento"].min()) < pd.Timedelta(hours=horas - 0.5):
        return None
    s = W[v].dropna()
    if len(s) < 6 or s.max() != s.min():
        return None
    if filtro and not filtro(s):
        return None
    return _h(None, regla, 2, tipo, fin, f"{nombre}: sin cambio durante {horas} h (valor {s.iloc[-1]:.1f})")


def _estacion(g, m):
    """Hallazgos de una estación (g: minutario ordenado de las últimas ~26 h; m: lat, alt)."""
    out = []
    g = g.sort_values("momento").reset_index(drop=True)
    fin = g["momento"].max()
    g24 = g[g["momento"] > fin - pd.Timedelta(hours=24)].reset_index(drop=True)
    alt = None if pd.isna(m.get("alt")) else float(m["alt"])

    # ---------------- temperaturas
    for v, u, r, n in (("T", SALTO_T, "ZT01", "Ts"), ("Td", SALTO_TD, "ZT02", "Td"), ("HR", SALTO_HR, "ZT03", "HR")):
        if v in g24:
            x = _salto(g24, v, u, r, "tem", n, "%" if v == "HR" else "°C")
            if x: out.append(x)
    bad = g24[(g24["Td"] > g24["T"] + 0.2)]
    if len(bad):
        i = bad.index[-1]
        out.append(_h(None, "ZT04", 2, "tem", g24.at[i, "momento"], f"Td {g24.at[i, 'Td']:.1f} mayor que Ts {g24.at[i, 'T']:.1f} °C ({len(bad)} minutos en 24 h)"))
    H = g24[g24["momento"].dt.minute == 0].dropna(subset=["T", "Td", "HR"])
    if len(H):
        calc = P.hr_magnus(H["T"], H["Td"].clip(upper=H["T"]))
        d = (H["HR"] - calc).abs()
        i = d.idxmax()
        if d[i] > TOL_HR[0]:
            out.append(_h(None, "ZT05", 2 if d[i] > TOL_HR[1] else 1, "tem", H.at[i, "momento"],
                          f"HR {H.at[i, 'HR']:.0f} % no calza con Ts {H.at[i, 'T']:.1f} y Td {H.at[i, 'Td']:.1f} (daría {calc[i]:.0f} %, diferencia {d[i]:.0f} puntos)"))
    for v, r, n in (("T", "ZT06", "Ts"), ("Td", "ZT07", "Td"), ("HR", "ZT08", "HR")):
        if v in g:
            x = _pegado(g, v, PEGADO_H[v], r, "tem", n, (lambda s: s.min() < 99) if v == "HR" else None)
            if x: out.append(x)
    if m.get("lat") is not None and not pd.isna(m.get("lat")):
        z = P.zona(m["lat"], 0 if alt is None else alt)
        tl, th = P.ZONAS_T[z]
        lo, hi = tl + 1, th - 1          # 1 °C más estrecho que en la pasada normal
        mal = g24[((g24["T"] < lo) | (g24["T"] > hi)) & g24["T"].between(*P.LIM["T"])]
        if len(mal):
            i = mal.index[-1]
            out.append(_h(None, "ZT09", 1, "tem", mal.at[i, "momento"], f"Ts {mal.at[i, 'T']:.1f} °C fuera de lo habitual para la zona {z} [{lo:.0f}, {hi:.0f}] ({len(mal)} minutos)"))

    # Ts casi sin variar en 24 h: poco probable (sensor muerto o valor fijo)
    T24 = g24["T"].dropna() if "T" in g24 else pd.Series(dtype=float)
    if len(T24) >= 1200 and T24.max() - T24.min() < AMPL_MIN:
        out.append(_h(None, "ZT10", 1, "tem", fin, f"Ts varió solo {T24.max() - T24.min():.1f} °C en 24 h ({T24.min():.1f} a {T24.max():.1f}): poco probable, revisar el sensor"))

    # ---------------- extremas de 12 h (mañana 12 UTC: mínima de la noche · tarde 00 UTC: máxima del día) contra los minutos de esas 12 h
    # ZE06 desactivada: el período real de Tn12/Tx12 de las EMA no es «las 12 h previas» a las 00 y 12 UTC (daba falsas alarmas en masa, 19/11/2026)
    for var, mn, hh, nom in ():
        if var not in g:
            continue
        R = g[(g["momento"].dt.hour == hh) & (g["momento"].dt.minute == 0)].dropna(subset=[var])
        for _, r in R.iterrows():
            W = g[(g["momento"] > r["momento"] - pd.Timedelta(hours=12)) & (g["momento"] <= r["momento"])]["T"].dropna()
            if len(W) < 600:
                continue
            ref = float(W.min() if mn else W.max()); d = abs(float(r[var]) - ref)
            if d > TOL_EXT[0]:
                out.append(_h(None, "ZE06", 2 if d > TOL_EXT[1] else 1, "ext", r["momento"],
                              f"{var} ({nom}, {r['momento']:%H} UTC) informa {r[var]:.1f} °C y la Ts por minuto de esas 12 h {'bajó' if mn else 'subió'} hasta {ref:.1f} °C (diferencia {d:.1f} °C)",
                              ingresado=f"{var} {r[var]:.1f} °C", deberia=f"≈ {ref:.1f} °C"))

    # ---------------- viento poco probable
    if "ff10" in g24 and g24["ff10"].notna().any():
        mx_ = g24["ff10"].max()
        if mx_ > FF_MAX:
            i = g24["ff10"].idxmax()
            out.append(_h(None, "ZV08", 1, "vie", g24.at[i, "momento"], f"Viento medio de {mx_:.0f} kt: poco probable (sobre {FF_MAX} kt), revisar el anemómetro"))
        if "fx10" in g24:
            q = g24.dropna(subset=["ff10", "fx10"]); q = q[(q["fx10"] >= 30) & (q["fx10"] > RAFAGA_X * q["ff10"].clip(lower=1))]
            if len(q) >= 3:
                i = q.index[-1]
                out.append(_h(None, "ZV09", 1, "vie", q.at[i, "momento"], f"Racha {q.at[i, 'fx10']:.0f} kt con viento medio {q.at[i, 'ff10']:.0f} kt (más de {RAFAGA_X} veces, {len(q)} minutos): poco probable"))

    # ---------------- presiones
    if "P_est" in g24:
        x = _salto(g24, "P_est", SALTO_P, "ZP01", "pre", "QFE", "hPa")
        if x: out.append(x)
        x = _pegado(g, "P_est", PEGADO_H["P_est"], "ZP02", "pre", "QFE")
        if x: out.append(x)
        if alt is not None:
            pe = P.p_esperada(alt)
            mal = g24[(g24["P_est"] < pe - 25) | (g24["P_est"] > pe + 25)]
            if len(mal):
                i = mal.index[-1]
                out.append(_h(None, "ZP03", 1, "pre", mal.at[i, "momento"], f"QFE {mal.at[i, 'P_est']:.1f} hPa lejos de lo esperado a {alt:.0f} m ({pe:.0f} ± 25 hPa)"))
        H = g24[g24["momento"].dt.minute == 0].dropna(subset=["P_est"])
        if len(H) >= 4:
            ph = H.set_index("momento")["P_est"]
            v3 = (ph - ph.shift(3, freq="h")).dropna()
            if len(v3) and v3.abs().max() > VAR3H_P:
                t = v3.abs().idxmax()
                out.append(_h(None, "ZP04", 1, "pre", t, f"QFE cambió {v3[t]:+.1f} hPa en 3 h"))
        if alt is not None and alt < P.ALT_PMAR and "P_mar" in g24:
            Hq = g24[g24["momento"].dt.minute == 0].dropna(subset=["P_est", "P_mar", "T"])
            if len(Hq):
                tm = Hq["T"] + 273.15 + 0.0065 * alt / 2
                calc = Hq["P_est"] * np.exp(9.80665 * alt / (287.05 * tm))
                d = (Hq["P_mar"] - calc).abs()
                i = d.idxmax()
                if d[i] > TOL_QFF[0]:
                    out.append(_h(None, "ZP05", 2 if d[i] > TOL_QFF[1] else 1, "pre", Hq.at[i, "momento"],
                                  f"QFF {Hq.at[i, 'P_mar']:.1f} no calza con el QFE {Hq.at[i, 'P_est']:.1f} a {alt:.0f} m (daría {calc[i]:.1f}, diferencia {d[i]:.1f} hPa)"))

    # ---------------- viento
    if "ff10" in g24:
        sf = g24.set_index("momento")["ff10"]
        d = (sf - sf.shift(10, freq="min").reindex(sf.index)).dropna()
        if len(d) and d.abs().max() > SALTO_FF10[0]:
            t = d.abs().idxmax()
            out.append(_h(None, "ZV01", 2 if abs(d[t]) > SALTO_FF10[1] else 1, "vie", t,
                          f"Viento medio de 10 min: de {sf[t] - d[t]:.1f} a {sf[t]:.1f} kt en 10 min (cambio de {abs(d[t]):.1f} kt)"))
        x = _pegado(g, "ff10", 3, "ZV02", "vie", "Viento medio 10 min", lambda s: s.iloc[-1] > 1)
        if x: out.append(x)
        if "dd10" in g:
            W = g[g["momento"] > fin - pd.Timedelta(hours=3)]
            if W["momento"].nunique() >= 6 and (W["momento"].max() - W["momento"].min()) >= pd.Timedelta(hours=2.5):
                s, f = W["dd10"].dropna(), W["ff10"].dropna()
                if len(s) >= 6 and s.max() == s.min() and len(f) and f.min() > 2:
                    out.append(_h(None, "ZV03", 2, "vie", fin, f"Dirección {s.iloc[-1]:.0f}° sin cambio durante 3 h con viento sobre {f.min():.0f}"))
            mal = g24[(g24["dd10"] > 360) | (g24["dd10"] < 0)]
            if len(mal):
                i = mal.index[-1]
                out.append(_h(None, "ZV05", 2, "vie", mal.at[i, "momento"], f"Dirección {mal.at[i, 'dd10']:.0f}° fuera de 0–360"))
        if "fx10" in g24:
            mal = g24[g24["fx10"] < g24["ff10"] - 2]
            if len(mal) >= 10:
                i = mal.index[-1]
                out.append(_h(None, "ZV06", 1, "vie", mal.at[i, "momento"], f"Racha {mal.at[i, 'fx10']:.1f} menor que el viento medio {mal.at[i, 'ff10']:.1f} ({len(mal)} minutos)"))

    # ---------------- precipitación
    if "rr1m" in g24:
        ll = g24[g24["rr1m"] > 0]
        seco = ll[(ll["HR"] < PP_MIN_HR)]
        if len(seco) >= PP_MIN_MIN:
            i = seco.index[-1]
            out.append(_h(None, "ZR01", 1, "pp", seco.at[i, "momento"], f"{len(seco)} minutos con lluvia y HR bajo {PP_MIN_HR} % (último: {seco.at[i, 'rr1m']:.1f} mm con HR {seco.at[i, 'HR']:.0f} %)"))
        dep = ll[(ll["T"] - ll["Td"]) > 10]
        if len(dep) >= PP_MIN_MIN:
            i = dep.index[-1]
            out.append(_h(None, "ZR02", 1, "pp", dep.at[i, "momento"], f"{len(dep)} minutos con lluvia y aire muy seco (Ts − Td mayor que 10 °C)"))
        fuerte = g24[g24["rr1m"] > 2]
        if len(fuerte):
            i = fuerte["rr1m"].idxmax()
            out.append(_h(None, "ZR03", 2 if g24.at[i, "rr1m"] > 4 else 1, "pp", g24.at[i, "momento"], f"{g24.at[i, 'rr1m']:.1f} mm en un minuto ({len(fuerte)} minutos sobre 2 mm)"))
        # mismo valor positivo repetido: balancín pegado
        s = g24["rr1m"].where(g24["rr1m"] > 0)
        grp = (s != s.shift()).cumsum()
        runs = s.groupby(grp).agg(["count", "first"])
        runs = runs[runs["first"].notna() & (runs["count"] >= 10)]
        if len(runs):
            k = runs["count"].idxmax()
            idx = g24.index[grp == k]
            out.append(_h(None, "ZR04", 2, "pp", g24.at[idx[-1], "momento"], f"{int(runs.at[k, 'count'])} minutos seguidos con {runs.at[k, 'first']:.1f} mm: pluviómetro pegado"))

    # ---------------- extremas del sensor (Tn12, Tx12) frente a la temperatura por minuto de las 24 h previas
    if "Tn12" in g and (g["momento"].max() - g["momento"].min()) >= pd.Timedelta(hours=24):
        u = g.dropna(subset=["T"])
        for var, mn in (("Tn12", True), ("Tx12", False)):
            if var not in g:
                continue
            x = g[var].dropna()
            if x.empty:
                continue
            t = g.at[x.index[-1], "momento"]
            val = float(x.iloc[-1])
            W = u[(u["momento"] > t - pd.Timedelta(hours=24)) & (u["momento"] <= t)]
            if len(W) < 1200:
                continue
            ref = float(W["T"].min() if mn else W["T"].max())
            dif = (ref - val) if mn else (val - ref)       # cuánto pasa la extrema del sensor al valor por minuto más extremo
            if dif > TOL_EXT[0]:
                nom = "mínima" if mn else "máxima"
                out.append(_h(None, "ZE01", 2 if dif > TOL_EXT[1] else 1, "ext", t,
                              f"La estación informa una temperatura {nom} de 12 h ({var}) de {val:.1f} °C, pero en las últimas 24 h ningún minuto {'bajó' if mn else 'subió'} de {ref:.1f} °C. "
                              f"Diferencia: {dif:.1f} °C (hasta ~1 °C es normal, porque la extrema sale de muestras más finas que el minuto).",
                              ingresado=f"{var} {val:.1f} °C", deberia=(f"{ref - TOL_EXT[0]:.1f} °C o más" if mn else f"{ref + TOL_EXT[0]:.1f} °C o menos")))
        a, b = g["Tn12"].dropna(), (g["Tx12"].dropna() if "Tx12" in g else pd.Series(dtype=float))
        if len(a) and len(b) and a.iloc[-1] > b.iloc[-1] + 0.05:
            out.append(_h(None, "ZE03", 2, "ext", g["momento"].max(), f"La temperatura mínima de 12 h (Tn12 {a.iloc[-1]:.1f} °C) es mayor que la máxima de 12 h (Tx12 {b.iloc[-1]:.1f} °C)"))
    return out


def _bloques6(g):
    """Bloques de 6 h que cierran a las 00, 06, 12 y 18 UTC dentro de los datos: RRR6 que informa la estación y suma de los minutos."""
    out = []
    if "rr1m" not in g or g.empty:
        return out
    fin, ini = g["momento"].max(), g["momento"].min()
    t = fin.floor("6h")
    for _ in range(5):
        a = t - pd.Timedelta(hours=6)
        if a >= ini - pd.Timedelta(minutes=5) and t <= fin:
            W = g[(g["momento"] > a) & (g["momento"] <= t)]
            n = int(W["rr1m"].notna().sum())
            near = g[(g["momento"] <= t) & (g["momento"] > t - pd.Timedelta(minutes=15))]
            inf = near["rr6"].dropna().iloc[-1] if "rr6" in near and near["rr6"].notna().any() else None
            suma = float(W["rr1m"].sum()) if n >= 330 else None
            if (inf is not None and inf > 0) or (suma is not None and suma > 0):
                out.append([_f(t), None if inf is None else round(float(inf), 1), None if suma is None else round(suma, 1), n])
        t -= pd.Timedelta(hours=6)
    return out


def _zr05(bl, tol=(0.3, 0.1)):
    """RRR6 de la estación frente a la suma del agua caída por minuto en las mismas 6 h."""
    out = []
    for hora, inf, suma, n in bl:
        if inf is None or suma is None:
            continue
        if abs(inf - suma) > tol[0] + tol[1] * suma:
            x = dict(hora=hora, regla="ZR05", nivel=1 if abs(inf - suma) < 1.0 + 0.3 * suma else 2, tipo="pp",
                     msg=f"La estación informa RRR6 de {inf:.1f} mm para las 6 h hasta las {hora[11:16]} UTC, pero la suma del agua caída por minuto da {suma:.1f} mm.",
                     ingresado=f"RRR6 {inf:.1f} mm", deberia=f"{suma:.1f} mm")
            out.append(x)
    return out


def _resumen(g):
    """Últimos valores y extremos de 24 h de una estación, para las tablas de cada pestaña."""
    g = g.sort_values("momento")
    fin = g["momento"].max()
    g24 = g[g["momento"] > fin - pd.Timedelta(hours=24)]
    r = lambda x, n=1: None if x is None or pd.isna(x) else round(float(x), n)
    ult = lambda v: r(g[v].dropna().iloc[-1]) if v in g and g[v].notna().any() else None
    mx = lambda v: r(g24[v].max()) if v in g24 and g24[v].notna().any() else None
    mn = lambda v: r(g24[v].min()) if v in g24 and g24[v].notna().any() else None
    out = {v: ult(v) for v in ("T", "Td", "HR", "P_est", "P_mar", "ff10", "fx10", "dd10", "rr6", "rr24", "Tn12", "Tx12")}
    out.update(Tmin24=mn("T"), Tmax24=mx("T"), ffmax24=mx("ff10"), fxmax24=mx("fx10"))
    if "rr1m" in g24 and g24["rr1m"].notna().sum() >= 600:
        out["rr_24h"] = r(g24["rr1m"].sum()); out["rr_1h"] = r(g24[g24["momento"] > fin - pd.Timedelta(hours=1)]["rr1m"].sum())
        out["rr_min"] = r(g24["rr1m"].max())
        out["rr_hoy"] = r(g[g["momento"] >= fin.normalize()]["rr1m"].sum())
        for h in (3, 6, 12):
            out[f"rr_{h}h"] = r(g24[g24["momento"] > fin - pd.Timedelta(hours=h)]["rr1m"].sum())
    if "P_est" in g24 and g24["P_est"].notna().sum() > 200:
        h = g24.set_index("momento")["P_est"].dropna()
        a = h[h.index <= fin - pd.Timedelta(hours=3)]
        out["dP3"] = r(h.iloc[-1] - a.iloc[-1]) if len(a) else None
    return out


# --- comparación con estaciones vecinas y con el modelo (errores groseros): diferencia sostenida en ≥ 2 de las últimas 3 horas
VEC_S = {"T": (3, 6, True, "Ts", "°C"), "Td": (4, 8, True, "Td", "°C"), "HR": (25, 40, False, "HR", "%"), "P_mar": (2, 4, False, "QFF", "hPa")}     # sospechoso, erróneo, corrige por altura
MOD_S = {"T": (5, 9, "Ts", "°C"), "Td": (6, 11, "Td", "°C"), "HR": (25, 40, "HR", "%"), "P_mar": (3.5, 7, "QFF", "hPa"), "ff10": (12, 20, "Viento medio", "kt")}
REGLA_V = {"T": ("ZC01", "tem"), "Td": ("ZC02", "tem"), "HR": ("ZC03", "tem"), "P_mar": ("ZC04", "pre")}
REGLA_M = {"T": ("ZM01", "tem"), "Td": ("ZM02", "tem"), "HR": ("ZM03", "tem"), "P_mar": ("ZM04", "pre"), "ff10": ("ZM05", "vie")}
ALT_PMAR = 1500
VIENTO_V = (12, 20)       # kt: diferencia del viento medio contra la mediana de las vecinas (sospechoso, erróneo); se exige en 3 de las últimas 4 horas
LLUVIA_SIN = 2.0          # mm en 3 h: la mediana de las vecinas acumuló esto y la estación 0
LLUVIA_SOLA = 5.0         # mm en 3 h: la estación acumuló esto y ninguna vecina pasó de 0,2


def _hc(cod, *a, **k):
    x = _h(None, *a, **k); x["_cod"] = cod
    return x


def _sostenida(dif, t1, t2, horas=3, minimo=2):
    """dif: Serie horaria (valor − referencia). Devuelve (momento, valor, nivel) del peor caso si ≥ `minimo` de las últimas `horas` horas pasan t1."""
    d = dif.dropna().sort_index().tail(horas)
    if len(d) < minimo:
        return None
    mal = d[d.abs() > t1]
    if len(mal) < minimo:
        return None
    t = mal.abs().idxmax()
    return t, float(mal[t]), 2 if (mal.abs() > t2).sum() >= minimo else 1


def comparar(H, E, V, M=None, aisladas=(), X=None, errores=None):
    """Alertas de comparación con vecinas (mediana ponderada de ≥ 3, con corrección por altura) y con el modelo, solo estaciones sin observador (H ya viene filtrado).
    X: externas (externas_vec.Ext): se suman como vecinas de menor peso; no se les calcula alerta. Un fallo en una estación se anota en `errores` y no tumba a las demás."""
    out = []
    if H is None or H.empty:
        return out
    errores = errores if errores is not None else []
    cods = list(H["codigo"].unique())
    H, E, V = EV.unir(X, H, E, V)
    alt = {c: (None if pd.isna(z) else float(z)) for c, z in E.set_index("codigo")["alt"].items()}
    Ha = H.pivot(index="momento", columns="codigo")
    horas = sorted(H.loc[H["codigo"].isin(cods), "momento"].unique())[-4:]
    for cod in cods:
        try:
            out += _comparar_est(cod, Ha, alt, V, M, aisladas, horas)
        except Exception:
            import traceback
            errores.append(f"comparar {cod}: {traceback.format_exc(limit=2)}")
    return out


def _comparar_est(cod, Ha, alt, V, M, aisladas, horas):
    out = []
    a = alt.get(cod)
    vs = [c for c in V.get(cod, []) if c in Ha["T"].columns]
    for v, (t1, t2, corr, nom, un) in VEC_S.items():
        if v == "P_mar" and (a or 0) > ALT_PMAR or v not in Ha or cod not in Ha[v].columns or len(vs) < 3:
            continue
        cols = [c for c in vs if c in Ha[v].columns]
        F = pd.DataFrame({c: Ha[v][c] + (0.0065 * ((alt.get(c) or 0) - (a or 0)) if corr else 0) for c in cols})
        ref, fin = EV.ref_filas(F, v)
        r = _sostenida((Ha[v][cod] - ref).loc[lambda x: x.index.isin(horas)], t1, t2)
        if r:
            t, d, niv = r
            val = float(Ha[v][cod].get(t))
            nd = sum(1 for c in cols if not EV.es_ext(c) and bool(fin.loc[t, c]))
            out.append(_hc(cod, REGLA_V[v][0], niv, REGLA_V[v][1], t, f"{nom} {'mayor' if d > 0 else 'menor'} en {abs(d):.1f} {un} que la mediana de sus {nd} estaciones vecinas (diferencia sostenida en las últimas horas; revisar el sensor)." + EV.nota(cols, fin.loc[t]),
                           ingresado=f"{nom} {val:.1f} {un}", deberia=f"≈ {val - d:.1f} {un} (vecinas)"))
    # viento medio y lluvia contra las vecinas (≥ 3); estaciones muy altas o aisladas se omiten: el viento cambia mucho de un lugar a otro
    if len(vs) >= 3 and not (cod in aisladas or (a or 0) >= 2000):
        if "ff10" in Ha and cod in Ha["ff10"].columns:
            cols = [c for c in vs if c in Ha["ff10"].columns]
            refv, fin = EV.ref_filas(pd.DataFrame({c: Ha["ff10"][c] for c in cols}), "ff10")
            r = _sostenida((Ha["ff10"][cod] - refv).loc[lambda x: x.index.isin(horas)], VIENTO_V[0], VIENTO_V[1], horas=4, minimo=3)
            if r:
                t, d, niv = r
                val = float(Ha["ff10"][cod].get(t))
                nd = sum(1 for c in cols if not EV.es_ext(c) and bool(fin.loc[t, c]))
                out.append(_hc(cod, "ZC05", niv, "vie", t, f"Viento medio {'mayor' if d > 0 else 'menor'} en {abs(d):.0f} kt que la mediana de sus {nd} estaciones vecinas (diferencia sostenida en 3 de las últimas 4 horas; revisar el anemómetro)." + EV.nota(cols, fin.loc[t]),
                               ingresado=f"Viento medio {val:.0f} kt", deberia=f"≈ {val - d:.0f} kt (vecinas)"))
            # calma prolongada con viento en las vecinas
            hc = list(Ha["ff10"].index.sort_values()[-CALMA_H:])
            mio = [Ha["ff10"][cod].get(h) for h in hc]
            if len(hc) == CALMA_H and all(x is not None and not pd.isna(x) and x == 0 for x in mio) and all(not pd.isna(refv.get(h)) and refv.get(h) >= CALMA_V for h in hc):
                out.append(_hc(cod, "ZC07", 1, "vie", hc[-1], f"Calma (0 kt) {CALMA_H} h seguidas mientras la mediana de sus vecinas marca {float(np.mean([refv.get(h) for h in hc])):.0f} kt: anemómetro trabado o sin señal.",
                               ingresado="Viento 0 kt", deberia=f"≈ {float(np.mean([refv.get(h) for h in hc])):.0f} kt (vecinas)"))
        if "rr1h" in Ha and cod in Ha["rr1h"].columns and "n" in Ha:
            u = [h for h in horas[-3:] if (Ha["n"][cod].get(h) or 0) >= 50]
            if len(u) == 3:
                mia = float(sum(Ha["rr1h"][cod].get(h) or 0 for h in u))
                ve = [(float(sum(Ha["rr1h"][c].get(h) or 0 for h in u)), EV.peso(c, "rr1h")) for c in vs
                      if c in Ha["rr1h"].columns and all((Ha["n"][c].get(h) or 0) >= 50 for h in u)]
                pes = [w for _, w in ve]
                if EV.suficiente(pes):
                    med = EV.mediana_pond([x for x, _ in ve], pes)
                    llu = [w for x, w in ve if x >= 0.5]
                    ext_n = sum(1 for c in vs if EV.es_ext(c) and c in Ha["rr1h"].columns and all((Ha["n"][c].get(h) or 0) >= 50 for h in u))
                    nd = len(ve) - ext_n
                    n_ext = f" La referencia incluye {ext_n} estaciones externas de menor peso." if ext_n else ""
                    if mia == 0 and med >= LLUVIA_SIN and EV.suficiente(llu):
                        out.append(_hc(cod, "ZC06", 1, "pp", u[-1], f"El pluviómetro no marcó lluvia en 3 h y la mediana de sus {nd} estaciones vecinas acumuló {med:.1f} mm (pluviómetro tapado o sin medir)." + n_ext,
                                       ingresado="0.0 mm en 3 h", deberia=f"≈ {med:.1f} mm (vecinas)"))
                    elif mia >= LLUVIA_SOLA and max(x for x, _ in ve) <= 0.2:
                        out.append(_hc(cod, "ZC06", 1, "pp", u[-1], f"El pluviómetro acumuló {mia:.1f} mm en 3 h y ninguna de sus {nd} estaciones vecinas pasó de 0,2 mm (puede ser una tormenta local; revisar el pluviómetro)." + n_ext,
                                       ingresado=f"{mia:.1f} mm en 3 h", deberia="≈ 0 mm (vecinas)"))
    if M is not None and not M.empty:
        Mc = M[M["codigo"] == cod].set_index("momento")
        for v, (t1, t2, nom, un) in MOD_S.items():
            if v == "P_mar" and (a or 0) > ALT_PMAR or v not in Mc or v not in Ha or cod not in Ha[v].columns:
                continue
            dif = (Ha[v][cod] - Mc[v]).dropna()
            f = 1.5 if (a or 0) >= 2000 and cod in aisladas else 1.0
            r = _sostenida(dif[dif.index.isin(horas)], t1 * f, t2 * f)
            if r:
                t, d, niv = r
                val = float(Ha[v][cod].get(t))
                out.append(_hc(cod, REGLA_M[v][0], niv, REGLA_M[v][1], t, f"{nom} {'mayor' if d > 0 else 'menor'} en {abs(d):.1f} {un} que el modelo (diferencia sostenida en las últimas horas; revisar el sensor)",
                               ingresado=f"{nom} {val:.1f} {un}", deberia=f"≈ {val - d:.1f} {un} (modelo)"))
    return out


# ------------------------------------------------------------------ resumen diario (para las vistas Mes y Año de la pestaña «Estación»)
CAMPOS_DIA = ["tmin", "tmax", "tmed", "hrmed", "pest", "pmar", "ffmax", "fxmax", "rr", "n", "rr_b0", "rr_b1", "rr_b2", "rr_b3", "rrmax", "tmin_h", "tmax_h"]


def _dia(raiz, dia):
    """Resumen de un día UTC de todas las estaciones, leído de sus 24 archivos horarios. Devuelve {código: [valores en CAMPOS_DIA]}."""
    from pathlib import Path
    partes = []
    for h in range(24):
        f = Path(raiz) / "ema" / dia.strftime("%Y/%m/%d") / f"{h:02d}.csv.gz"
        if f.exists():
            partes.append(pd.read_csv(f, parse_dates=["momento"], dtype={"codigo": str}))
    if not partes:
        return {}
    D = pd.concat(partes, ignore_index=True).drop_duplicates(["codigo", "momento"])
    r = lambda x, n=1: None if pd.isna(x) else round(float(x), n)
    out = {}
    for cod, g in D.groupby("codigo"):
        rr = g["rr1m"].sum() if "rr1m" in g and g["rr1m"].notna().sum() >= 600 else None
        out[cod] = [r(g["T"].min()), r(g["T"].max()), r(g["T"].mean()), r(g["HR"].mean(), 0), r(g["P_est"].mean()), r(g["P_mar"].mean()),
                    r(g["ff10"].max()), r(g["fx10"].max()), r(rr), int(len(g))]
        if rr is not None:
            b = g.groupby(g["momento"].dt.hour // 6)["rr1m"].sum()
            out[cod] += [r(b.get(k, 0.0)) for k in range(4)] + [r(g["rr1m"].max())]
        else:
            out[cod] += [None] * 5
        t = g.dropna(subset=["T"])
        out[cod] += ([f"{t.loc[t['T'].idxmin(), 'momento']:%H:%M}", f"{t.loc[t['T'].idxmax(), 'momento']:%H:%M}"] if len(t) else [None, None])
    return out


def diario(raiz, ahora=None, subir=None):
    """Mantiene datos/diario/AAAA/MM.json: {campos, dias: {AAAA-MM-DD: {código: [...]}}}. Calcula los días que faltan y recalcula hoy y ayer."""
    import json
    from pathlib import Path
    ahora = pd.Timestamp.now("UTC").tz_localize(None) if ahora is None else ahora
    hoy = ahora.normalize()
    ema = Path(raiz) / "ema"
    dias = {}
    for mm in ((hoy - pd.Timedelta(days=40)).strftime("%Y/%m"), (hoy - pd.Timedelta(days=20)).strftime("%Y/%m"), hoy.strftime("%Y/%m")):
        for d in sorted((ema / mm).glob("*")) if (ema / mm).exists() else []:
            if d.is_dir():
                dias[f"{mm.replace('/', '-')}-{d.name}"] = d
    tocados = set()
    for dia in sorted(dias):
        t = pd.Timestamp(dia)
        mes = Path(raiz) / "diario" / t.strftime("%Y") / t.strftime("%m.json")
        M = json.loads(mes.read_text(encoding="utf-8")) if mes.exists() else {"campos": CAMPOS_DIA, "dias": {}}
        if M.get("campos") != CAMPOS_DIA:      # cambió el formato: se recalcula todo el mes
            M = {"campos": CAMPOS_DIA, "dias": {}}
        if dia in M["dias"] and t < hoy - pd.Timedelta(days=1):
            continue
        M["dias"][dia] = _dia(raiz, t)
        M["campos"] = CAMPOS_DIA
        mes.parent.mkdir(parents=True, exist_ok=True)
        mes.write_text(json.dumps(M, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tocados.add(dia)
    return sorted(tocados)


AMPL_MIN = 0.5               # °C: amplitud mínima creíble de Ts en 24 h
FF_MAX, RAFAGA_X = 70, 4     # kt: viento medio poco probable; racha más de 4 veces el medio
CALMA_H, CALMA_V = 6, 5      # calma ≥ 6 h seguidas con las vecinas en ≥ 5 kt
TOL_AMPL_V = 8.0             # °C: amplitud del día contra la mediana de las vecinas
ESPACIAL = {"ZC01", "ZC02", "ZC03", "ZC04", "ZC05", "ZC06", "ZC07", "ZC08", "ZC09", "ZC10", "ZE05", "ZE08", "ZK01"}
LIM_T = (-35.0, 45.0)        # rango físico para las extremas de 24 h armadas con los minutos
TOL_EXT_V = (6.0, 10.0)      # °C: extrema de 24 h contra la mediana de las vecinas (corregida por altura)


def _extremas_red(est, V):
    """ZE04: mínima o máxima de 24 h (de los minutos) fuera de rango físico → la extrema del día queda inválida (picos del sensor).
    ZE05: mínima o máxima de 24 h muy distinta de la de sus vecinas (≥ 3, corregida por altura)."""
    R = {f["codigo"]: f for f in est if f.get("res")}
    for f in R.values():
        r, cod, z = f["res"], f["codigo"], f.get("alt") or 0
        for k, nom in (("Tmin24", "mínima"), ("Tmax24", "máxima")):
            v = r.get(k)
            if v is None:
                continue
            if v < LIM_T[0] or v > LIM_T[1]:
                f["hallazgos"].append(_h(None, "ZE04", 2, "ext", f["ultima"], f"La temperatura {nom} de las últimas 24 h, armada con los minutos, es {v:.1f} °C: fuera de rango físico. "
                                         f"Son picos del sensor; la extrema del día queda inválida hasta corregir esos minutos.", ingresado=f"T {nom} 24 h {v:.1f} °C", deberia=f"entre {LIM_T[0]:.0f} y {LIM_T[1]:.0f} °C"))
                continue
            ref = [R[c]["res"][k] + 0.0065 * ((R[c].get("alt") or 0) - z) for c in (V or {}).get(cod, []) if c in R and R[c]["res"].get(k) is not None
                   and LIM_T[0] <= R[c]["res"][k] <= LIM_T[1]]
            if len(ref) < 3:
                continue
            med = float(np.median(ref)); d = v - med
            if abs(d) > TOL_EXT_V[0]:
                f["hallazgos"].append(_h(None, "ZE05", 2 if abs(d) > TOL_EXT_V[1] else 1, "ext", f["ultima"],
                                         f"La temperatura {nom} de 24 h ({v:.1f} °C) es {abs(d):.1f} °C {'más alta' if d > 0 else 'más baja'} que la mediana de sus {len(ref)} vecinas ({med:.1f} °C, llevada a la altura de la estación).",
                                         ingresado=f"T {nom} 24 h {v:.1f} °C", deberia=f"≈ {med:.1f} °C (vecinas)"))
        mn_, mx_ = r.get("Tmin24"), r.get("Tmax24")
        if mn_ is not None and mx_ is not None and LIM_T[0] <= mn_ <= LIM_T[1] and LIM_T[0] <= mx_ <= LIM_T[1]:
            amp = [R[c]["res"]["Tmax24"] - R[c]["res"]["Tmin24"] for c in (V or {}).get(cod, []) if c in R and R[c]["res"].get("Tmin24") is not None and R[c]["res"].get("Tmax24") is not None
                   and LIM_T[0] <= R[c]["res"]["Tmin24"] and R[c]["res"]["Tmax24"] <= LIM_T[1]]
            if len(amp) >= 3:
                ma = float(np.median(amp)); d = (mx_ - mn_) - ma
                if abs(d) > TOL_AMPL_V:
                    f["hallazgos"].append(_h(None, "ZE08", 1, "ext", f["ultima"], f"Amplitud térmica del día {mx_ - mn_:.1f} °C contra {ma:.1f} °C de la mediana de sus {len(amp)} vecinas: poco probable",
                                             ingresado=f"{mn_:.1f} a {mx_:.1f} °C", deberia=f"amplitud ≈ {ma:.1f} °C"))
        f["nivel"] = max([h["nivel"] for h in f["hallazgos"]], default=f["nivel"])


def _satelite(raiz, A, est, fin):
    """ZS01: lluvia en el pluviómetro con el cielo despejado según GOES (≥ 2 h en 24 h).
    ZS02: pluviómetro en 0 durante ≥ 3 h seguidas con lluvia estimada o nube fría sobre la estación."""
    import pluviometros as PL
    arch = PL.leer_satelite(raiz, (fin - pd.Timedelta(hours=24)).to_pydatetime(), fin.to_pydatetime())
    if not arch or A is None or not len(A) or "rr1m" not in A:
        return
    W = A[A["momento"] > fin - pd.Timedelta(hours=24)]
    W = W.assign(h=W["momento"].dt.ceil("h"))
    g = W.groupby(["codigo", "h"])["rr1m"].agg(["sum", "count"]).reset_index()
    g = g[g["count"] >= 50]
    rr = {c: dict(zip(x["h"], x["sum"])) for c, x in g.groupby("codigo")}
    for f in est:
        c = f["codigo"]; mio = rr.get(c)
        if not mio:
            continue
        horas = sorted(h for h in mio if h in arch and c in arch[h])
        desp = [h for h in horas if mio[h] >= 0.5 and arch[h][c][2] and not (arch[h][c][0] or arch[h][c][1])]
        if len(desp) >= 2:
            f["hallazgos"].append(_h(None, "ZS01", 1, "pp", desp[-1], f"El pluviómetro marcó lluvia en {len(desp)} h con el cielo despejado según el satélite GOES (" + ", ".join(f"{h:%H}h {mio[h]:.1f} mm" for h in desp[-4:]) + "): riego, mantención o falla",
                                     ingresado=f"{sum(mio[h] for h in desp):.1f} mm", deberia="0 mm (cielo despejado)"))
        racha, mejor = [], []
        for h in horas:
            if mio[h] == 0 and arch[h][c][0] and arch[h][c][1]:      # lluvia estimada Y nube fría (la nube fría sola daba falsas alarmas en el norte)
                racha.append(h)
                if len(racha) > len(mejor):
                    mejor = list(racha)
            else:
                racha = []
        if len(mejor) >= 4:
            f["hallazgos"].append(_h(None, "ZS02", 1, "pp", mejor[-1], f"El pluviómetro marcó 0 mm durante {len(mejor)} h seguidas ({mejor[0]:%H}–{mejor[-1]:%H} UTC) con lluvia estimada y nube fría sobre la estación según GOES: posible pluviómetro obstruido",
                                     ingresado="0 mm", deberia="lluvia (satélite)"))
        f["nivel"] = max([h["nivel"] for h in f["hallazgos"]], default=f["nivel"])


DD_MIN_FF, DD_TOL = 5, 90          # ZC08: dirección contra vecinas con viento ≥ 5 kt; diferencia > 90° sostenida
DERIVA_DIAS, DERIVA_FIN = 6, 2.0    # ZC10: diferencia contra vecinas que crece día a día; el último día ≥ 2 °C / 2 hPa


def _dif_ang(a, b):
    return abs((a - b + 180) % 360 - 180)


def _media_ang(v):
    v = np.radians(np.asarray(v, float)); return float(np.degrees(np.arctan2(np.sin(v).mean(), np.cos(v).mean())) % 360)


def _espaciales_extra(raiz, A, E, V, fin):
    """ZC08 dirección del viento contra vecinas, ZC09 hora desfasada contra vecinas, ZC10 deriva lenta contra vecinas.
    Devuelve {codigo: [hallazgos]} para todas las estaciones (con y sin observador)."""
    out = {}
    if A is None or not len(A):
        return out
    H = P.horario(A[A["momento"] > fin - pd.Timedelta(hours=26)])
    piv = {v: H.pivot_table(index="momento", columns="codigo", values=v, aggfunc="last").sort_index() for v in ("T", "P_mar", "ff10", "dd10") if v in H}
    alt = {c: (None if pd.isna(z) else float(z)) for c, z in E.set_index("codigo")["alt"].items()}
    for cod in H["codigo"].unique():
        vs = [c for c in (V or {}).get(cod, []) if c in H["codigo"].values]
        if len(vs) < 3:
            continue
        # ZC08 · dirección: últimas 4 h, 3 con diferencia > 90° (con viento ≥ 5 kt en la estación y en las vecinas)
        if "dd10" in piv and cod in piv["dd10"]:
            dif = []
            for t in piv["dd10"].index[-4:]:
                d0, f0 = piv["dd10"].at[t, cod], piv["ff10"].at[t, cod] if cod in piv["ff10"] else np.nan
                ref = [piv["dd10"].at[t, c] for c in vs if c in piv["dd10"] and c in piv["ff10"] and piv["ff10"].at[t, c] >= DD_MIN_FF and not pd.isna(piv["dd10"].at[t, c])]
                if pd.isna(d0) or pd.isna(f0) or f0 < DD_MIN_FF or len(ref) < 3:
                    continue
                m = _media_ang(ref); dif.append((t, d0, m, _dif_ang(d0, m)))
            mal = [x for x in dif if x[3] > DD_TOL]
            if len(dif) >= 3 and len(mal) >= 3:
                t, d0, m, d = mal[-1]
                out.setdefault(cod, []).append(_hc(cod, "ZC08", 1, "vie", t, f"Dirección del viento {d0:.0f}° contra {m:.0f}° de sus vecinas (diferencia {d:.0f}°) en {len(mal)} de las últimas {len(dif)} horas con viento: veleta trabada, mal orientada o invertida.",
                                                   ingresado=f"{d0:.0f}°", deberia=f"≈ {m:.0f}° (vecinas)"))
        # ZC09 · hora desfasada: la curva de Ts calza mejor con las vecinas corrida 1 a 3 h
        if "T" in piv and cod in piv["T"]:
            T = piv["T"]; ref = T[[c for c in vs if c in T]].median(axis=1); mio = T[cod]
            ok = mio.notna() & ref.notna()
            if ok.sum() >= 20 and mio[ok].std() > 1.5:
                cor = {L: mio.shift(L).corr(ref) for L in range(-3, 4)}
                L = max(cor, key=lambda k: -9 if pd.isna(cor[k]) else cor[k])
                if L != 0 and cor[L] > 0.9 and (pd.isna(cor[0]) or cor[L] - cor[0] > 0.1):
                    out.setdefault(cod, []).append(_hc(cod, "ZC09", 1, "tem", T.index[-1], f"La curva de Ts de las últimas 24 h calza con la de sus vecinas solo si se corre {abs(L)} h {'hacia atrás' if L > 0 else 'hacia adelante'} "
                                                       f"(correlación {cor[L]:.2f} contra {cor[0]:.2f} sin correr): posible hora mal configurada en la estación.", ingresado="hora de la estación", deberia=f"corrida {L:+d} h"))
    # ZC10 · deriva lenta con el resumen diario (tmed y pmar), últimos DERIVA_DIAS días
    import json
    from pathlib import Path
    dias = [(fin.normalize() - pd.Timedelta(days=k)) for k in range(DERIVA_DIAS, 0, -1)]
    D = {}
    for d in dias:
        f = Path(raiz) / "diario" / d.strftime("%Y") / d.strftime("%m.json")
        if f.exists():
            M = json.loads(f.read_text(encoding="utf-8")); ix = {k: i for i, k in enumerate(M.get("campos", []))}
            D[d] = {c: v for c, v in M["dias"].get(f"{d:%Y-%m-%d}", {}).items() if (v[ix["n"]] or 0) >= 1200} if "n" in ix else {}
            D[d] = (ix, D[d])
    if len(D) == DERIVA_DIAS:
        for cod in {c for d in D.values() for c in d[1]}:
            vs = (V or {}).get(cod, [])
            for k, nom, un, corr in (("tmed", "Ts media", "°C", True), ("pmar", "QFF medio", "hPa", False)):
                serie = []
                for d in dias:
                    ix, X = D[d]; mio = X.get(cod)
                    ref = [X[c][ix[k]] + (0.0065 * ((alt.get(c) or 0) - (alt.get(cod) or 0)) if corr else 0) for c in vs if c in X and X[c][ix[k]] is not None]
                    if mio is None or mio[ix[k]] is None or len(ref) < 3:
                        break
                    serie.append(mio[ix[k]] - float(np.median(ref)))
                if len(serie) == DERIVA_DIAS:
                    a = np.abs(serie)
                    if a[-1] >= DERIVA_FIN and a[0] < a[-1] / 3 and all(a[i + 1] >= a[i] - 0.3 for i in range(len(a) - 1)) and np.sign(serie[-1]) == np.sign(serie[-2]):
                        out.setdefault(cod, []).append(_hc(cod, "ZC10", 1, "tem" if k == "tmed" else "pre", fin, f"Deriva lenta: la diferencia de {nom} contra sus vecinas creció día a día en {DERIVA_DIAS} días "
                                                           f"({', '.join(f'{x:+.1f}' for x in serie)} {un}): posible descalibración del sensor.", ingresado=f"{serie[-1]:+.1f} {un} hoy", deberia=f"≈ {serie[0]:+.1f} {un} (hace {DERIVA_DIAS} días)"))
    return out


# ------------------------------------------------------------------ Six Sigma
# Diferencia de cada estación contra la mediana de sus vecinas, en σ de SU PROPIA diferencia habitual (media y σ móviles ~30 días, guardadas en datos/sigma/estado.json).
SIX_VARS = {"T": ("Ts", "°C", True, 0.3), "Td": ("Td", "°C", False, 0.5), "HR": ("HR", "%", False, 3.0), "P_mar": ("QFF", "hPa", False, 0.3), "ff10": ("Viento medio", "kt", False, 1.5)}
SIX_MIN_N, SIX_VENT, SIX_SOSP, SIX_ERR = 72, 720, 4.0, 6.0      # 3 días de horas para empezar · ventana ~30 días · 4σ sospechoso · 6σ erróneo
SIX_TIPO = {"T": "tem", "Td": "tem", "HR": "tem", "P_mar": "pre", "ff10": "vie"}


def _six_sigma(raiz, A, E, V, fin, leer=None):
    import json
    from pathlib import Path
    out = {}
    f = Path(raiz) / "sigma" / "estado.json"
    try:
        S = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    except Exception:
        S = {}
    st, ult = S.get("st", {}), pd.Timestamp(S["ultima"]) if S.get("ultima") else None
    if ult is None and leer is not None:        # primera vez: arranca con los ~4 días que haya en el archivo para no esperar 3 días
        try:
            A = leer(96); ult = fin - pd.Timedelta(hours=96)
        except Exception:
            pass
    ult = ult if ult is not None and ult > fin - pd.Timedelta(hours=100) else fin - pd.Timedelta(hours=6)
    H = P.horario(A[A["momento"] > ult - pd.Timedelta(hours=1)])
    if H.empty:
        return out
    hora_fin = fin.floor("h")
    H = H[(H["momento"] > ult) & (H["momento"] <= hora_fin)]
    alt = {c: (None if pd.isna(z) else float(z)) for c, z in E.set_index("codigo")["alt"].items()}
    zs = {}
    for t, G in H.groupby("momento"):
        G = G.set_index("codigo")
        for cod in G.index:
            vs = [c for c in (V or {}).get(cod, []) if c in G.index]
            if len(vs) < 3:
                continue
            for v, (nom, un, corr, piso) in SIX_VARS.items():
                if v not in G or pd.isna(G.at[cod, v]):
                    continue
                if v == "P_mar" and (alt.get(cod) or 0) > ALT_PMAR:
                    continue
                ref = [G.at[c, v] + (0.0065 * ((alt.get(c) or 0) - (alt.get(cod) or 0)) if corr else 0) for c in vs if not pd.isna(G.at[c, v])]
                if len(ref) < 3:
                    continue
                d = float(G.at[cod, v] - np.median(ref)); k = f"{cod}|{v}"; e = st.get(k, [0, 0.0, 0.0])   # [n, media, varianza]
                n, m, var = e; sd = max(math.sqrt(var), piso)
                z = (d - m) / sd if n >= SIX_MIN_N else None
                if z is not None:
                    zs.setdefault(k, []).append((t, z, d, m, sd))
                if z is None or abs(z) < SIX_SOSP:          # lo raro no entra a la estadística (no la infla)
                    a = 1 / min(n + 1, SIX_VENT); dm = d - m
                    st[k] = [n + 1, round(m + a * dm, 4), round((1 - a) * (var + a * dm * dm), 5)]
    for k, L in zs.items():
        cod, v = k.split("|"); nom, un, _, _ = SIX_VARS[v]
        L = L[-2:]
        if len(L) == 2 and all(abs(x[1]) >= SIX_SOSP for x in L) and np.sign(L[0][1]) == np.sign(L[1][1]):
            t, z, d, m, sd = L[-1]
            out.setdefault(cod, []).append(dict(_hc(cod, "ZK01", 2 if abs(z) >= SIX_ERR else 1, SIX_TIPO[v], t,
                f"{nom} {d:+.1f} {un} contra la mediana de sus vecinas; lo habitual en esta estación es {m:+.1f} ± {sd:.1f} {un} → {abs(z):.1f}σ ({'muy' if abs(z) >= SIX_ERR else ''} poco probable, sostenido 2 h).".replace("( ", "("),
                ingresado=f"{d:+.1f} {un} vs vecinas", deberia=f"{m:+.1f} ± {sd:.1f} {un}"), sigma=round(abs(z), 1), var=v))
    if len(H):
        S = {"ultima": f"{H['momento'].max():%Y-%m-%dT%H:%M}", "st": st}
        f.parent.mkdir(parents=True, exist_ok=True); f.write_text(json.dumps(S, separators=(",", ":")), encoding="utf-8")
    return out


def _boletin(A, est, fin):
    if A is None or not len(A):
        return
    loc = (fin - pd.Timedelta(hours=3)).normalize() - pd.Timedelta(days=1)      # ayer, hora local
    a, b = loc + pd.Timedelta(hours=3), loc + pd.Timedelta(hours=27)             # en UTC
    W = A[(A["momento"] > a) & (A["momento"] <= b)]
    por = {c: g for c, g in W.groupby("codigo")}
    r = lambda x: None if x is None or pd.isna(x) else round(float(x), 1)
    hl = lambda t: f"{t - pd.Timedelta(hours=3):%H:%M}"
    for f in est:
        g = por.get(f["codigo"])
        if g is None:
            continue
        t = g.dropna(subset=["T"]) if "T" in g else g.iloc[0:0]
        rr = g["rr1m"].sum() if "rr1m" in g and g["rr1m"].notna().sum() >= 600 else None
        f["bol"] = dict(dia=f"{loc:%Y-%m-%d}", n=int(len(t)),
                        tmin=r(t["T"].min()) if len(t) else None, tmin_h=hl(t.loc[t["T"].idxmin(), "momento"]) if len(t) else None,
                        tmax=r(t["T"].max()) if len(t) else None, tmax_h=hl(t.loc[t["T"].idxmax(), "momento"]) if len(t) else None, rr=r(rr))


def _repetidas(raiz, est, ahora):
    """ZE07: la misma mínima o máxima diaria (de los minutos) 3 días seguidos o más: valor fijo o sensor trabado."""
    import json
    from pathlib import Path
    dias = [(ahora.normalize() - pd.Timedelta(days=k)) for k in range(1, 5)]
    D = {}
    for d in dias:
        f = Path(raiz) / "diario" / d.strftime("%Y") / d.strftime("%m.json")
        if f.exists():
            M = json.loads(f.read_text(encoding="utf-8")); ix = {k: i for i, k in enumerate(M.get("campos", []))}
            D[d] = {c: (v[ix["tmin"]], v[ix["tmax"]], v[ix["n"]]) for c, v in M["dias"].get(f"{d:%Y-%m-%d}", {}).items()}
    for f in est:
        serie = [D.get(d, {}).get(f["codigo"]) for d in dias]
        for k, nom in ((0, "mínima"), (1, "máxima")):
            vals = []
            for x in serie:
                if x is None or x[k] is None or (x[2] or 0) < 1000:
                    break
                vals.append(x[k])
            if len(vals) >= 3 and len(set(vals[:3])) == 1:
                f["hallazgos"].append(_h(None, "ZE07", 2, "ext", f["ultima"] or f"{ahora:%Y-%m-%dT%H:%M}",
                                         f"La temperatura {nom} del día fue {vals[0]:.1f} °C {len([v for v in vals if v == vals[0]])} días seguidos: valor repetido, revisar el sensor o el registro",
                                         ingresado=f"{nom} {vals[0]:.1f} °C repetida"))
                f["nivel"] = max(f["nivel"], 2)


def correr(raiz, E, cods_obs, leer_archivo, horas=26, V=None, M=None, aisladas=(), X=None):
    """E: estaciones (DataFrame); cods_obs: códigos con observador (se excluyen). Devuelve el dict para el KV."""
    fin = pd.Timestamp.utcnow().tz_localize(None)
    A = leer_archivo(raiz, fin, horas=horas)
    cods_obs = {str(c) for c in cods_obs}
    meta = E.set_index("codigo")[["nombre", "oaci", "lat", "lon", "alt"]].to_dict("index")
    por = {c: g for c, g in A.groupby("codigo")} if len(A) else {}
    cmp_al, errores = {}, []
    try:   # comparación con vecinas (DMC y externas) y modelo, sobre el valor horario
        # todas las estaciones (con y sin observador) entran como vecinas; los hallazgos de las con observador van aparte (control espacial de Observaciones)
        for h in comparar(P.horario(A[A["momento"] > fin - pd.Timedelta(hours=8)]) if len(A) else A, E, V or {}, M, aisladas, X=X, errores=errores):
            cmp_al.setdefault(h.pop("_cod"), []).append(h)
    except Exception:      # no se oculta: queda en el resultado (errores) y en el registro de la pasada
        import traceback
        errores.append(f"comparar: {traceback.format_exc(limit=3)}")
    for e_ in errores:
        print("super/comparar:", e_, flush=True)
    est = []
    for cod, m in meta.items():
        if cod in cods_obs:
            continue
        g = por.get(cod)
        fila = dict(codigo=cod, nombre=m["nombre"], oaci=m["oaci"], lat=m["lat"], lon=m["lon"], alt=None if pd.isna(m["alt"]) else m["alt"],
                    ultima=None, nivel=0, hallazgos=[])
        if g is not None and len(g):
            fila["ultima"] = _f(g["momento"].max())
            try:
                fila["res"] = _resumen(g)
                bl = _bloques6(g)
                fila["res"]["blq6"] = bl
            except Exception:
                fila["res"] = {}
            try:
                fila["hallazgos"] = _estacion(g, m)
                fila["hallazgos"] += cmp_al.get(cod, []) + _zr05(bl)
            except Exception as e:      # una estación mala no tumba a las demás
                fila["hallazgos"] = [dict(hora=fila["ultima"], regla="ZERR", nivel=0, tipo="tem", msg=f"No se pudo revisar: {e}")][:0]
            fila["nivel"] = max([h["nivel"] for h in fila["hallazgos"]], default=0)
        else:
            fila["nivel"] = 3
        est.append(fila)
    try:   # boletín automático: día local de ayer (Chile continental, UTC−3), armado con los minutos
        _boletin(leer_archivo(raiz, fin, horas=54), est, fin)
    except Exception:
        import traceback
        errores.append(f"boletin: {traceback.format_exc(limit=3)}")
    try:
        _satelite(raiz, A, est, fin)
    except Exception:
        import traceback
        errores.append(f"satelite: {traceback.format_exc(limit=3)}")
    try:
        _repetidas(raiz, est, fin)
    except Exception:
        import traceback
        errores.append(f"repetidas: {traceback.format_exc(limit=3)}")
    try:
        _extremas_red(est, V)
    except Exception:
        import traceback
        errores.append(f"extremas_red: {traceback.format_exc(limit=3)}")
    try:      # dirección del viento, hora desfasada y deriva lenta contra vecinas (todas las estaciones)
        X_ = _espaciales_extra(raiz, A, E, V, fin)
        try:
            for c, L in _six_sigma(raiz, A, E, V, fin, leer=lambda h: leer_archivo(raiz, fin, horas=h)).items():
                X_.setdefault(c, []).extend(L)
        except Exception:
            import traceback
            errores.append(f"six_sigma: {traceback.format_exc(limit=3)}")
        for f in est:
            for h in X_.pop(f["codigo"], []):
                h.pop("_cod", None); f["hallazgos"].append(h); f["nivel"] = max(f["nivel"], h["nivel"])
        for c, L in X_.items():
            for h in L:
                h.pop("_cod", None); cmp_al.setdefault(c, []).append(h)
    except Exception:
        import traceback
        errores.append(f"espaciales_extra: {traceback.format_exc(limit=3)}")
    obs_esp = []      # control espacial de las estaciones con observador (su sensor contra todas las cercanas: DMC, INIA…)
    for cod in sorted(cods_obs):
        m = meta.get(cod); H_ = [h for h in cmp_al.get(cod, []) if h["regla"] in ESPACIAL]
        if m is None:
            continue
        obs_esp.append(dict(codigo=cod, nombre=m["nombre"], oaci=m["oaci"], lat=m["lat"], lon=m["lon"], alt=None if pd.isna(m["alt"]) else m["alt"],
                            ultima=_f(por[cod]["momento"].max()) if cod in por else None, nivel=max([h["nivel"] for h in H_], default=0), hallazgos=H_))
    return dict(generado=pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%S"), horas=horas, estaciones=est, obs_esp=obs_esp, errores=errores[:10])
