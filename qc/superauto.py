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


def _h(cod, regla, nivel, tipo, momento, msg):
    return dict(hora=_f(momento), regla=regla, nivel=int(nivel), tipo=tipo, msg=msg)


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
        if "rr6" in g24:   # el acumulado de 6 h no puede ser menor que lo sumado por minuto dentro de ese período
            Hh = g24[g24["momento"].dt.minute == 0].dropna(subset=["rr6"])
            for _, r in Hh.iterrows():
                t = r["momento"]
                suma = g[(g["momento"] > t - pd.Timedelta(hours=6)) & (g["momento"] <= t)]["rr1m"].sum()
                n = g[(g["momento"] > t - pd.Timedelta(hours=6)) & (g["momento"] <= t)]["rr1m"].notna().sum()
                if n >= 330 and abs(r["rr6"] - suma) > 0.3 + 0.1 * suma:
                    out.append(_h(None, "ZR05", 1, "pp", t, f"Agua caída 6 h {r['rr6']:.1f} mm y la suma de los minutos da {suma:.1f} mm"))
                    break

    # ---------------- extremas del sensor (Tn12, Tx12) frente a la temperatura por minuto de las 24 h previas
    if "Tn12" in g and (g["momento"].max() - g["momento"].min()) >= pd.Timedelta(hours=24):
        u = g.dropna(subset=["T"])
        for var, mn in (("Tn12", True), ("Tx12", False)):
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
                              f"Diferencia: {dif:.1f} °C (hasta ~1 °C es normal, porque la extrema sale de muestras más finas que el minuto)."))
        a, b = g["Tn12"].dropna(), g["Tx12"].dropna()
        if len(a) and len(b) and a.iloc[-1] > b.iloc[-1] + 0.05:
            out.append(_h(None, "ZE03", 2, "ext", g["momento"].max(), f"La temperatura mínima de 12 h (Tn12 {a.iloc[-1]:.1f} °C) es mayor que la máxima de 12 h (Tx12 {b.iloc[-1]:.1f} °C)"))
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


def _hc(cod, *a):
    x = _h(None, *a); x["_cod"] = cod
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


def comparar(H, E, V, M=None, aisladas=()):
    """Alertas de comparación con vecinas (mediana de ≥ 3, con corrección por altura) y con el modelo, solo estaciones sin observador (H ya viene filtrado)."""
    out = []
    if H is None or H.empty:
        return out
    alt = {c: (None if pd.isna(z) else float(z)) for c, z in E.set_index("codigo")["alt"].items()}
    Hi = H.set_index(["codigo", "momento"]).sort_index()
    Ha = H.pivot(index="momento", columns="codigo")
    horas = sorted(H["momento"].unique())[-4:]
    for cod in H["codigo"].unique():
        a = alt.get(cod)
        vs = [c for c in V.get(cod, []) if c in Ha["T"].columns]
        for v, (t1, t2, corr, nom, un) in VEC_S.items():
            if v == "P_mar" and (a or 0) > ALT_PMAR or v not in Ha or cod not in Ha[v].columns or len(vs) < 3:
                continue
            ref = pd.DataFrame({c: Ha[v][c] + (0.0065 * ((alt.get(c) or 0) - (a or 0)) if corr else 0) for c in vs})
            ref = ref[ref.notna().sum(axis=1) >= 3].median(axis=1)
            r = _sostenida((Ha[v][cod] - ref).loc[lambda x: x.index.isin(horas)], t1, t2)
            if r:
                t, d, niv = r
                out.append(_hc(cod, REGLA_V[v][0], niv, REGLA_V[v][1], t, f"{nom} {'mayor' if d > 0 else 'menor'} en {abs(d):.1f} {un} que la mediana de sus {len(vs)} estaciones vecinas (diferencia sostenida en las últimas horas; revisar el sensor)"))
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
                    out.append(_hc(cod, REGLA_M[v][0], niv, REGLA_M[v][1], t, f"{nom} {'mayor' if d > 0 else 'menor'} en {abs(d):.1f} {un} que el modelo (diferencia sostenida en las últimas horas; revisar el sensor)"))
    return out


def correr(raiz, E, cods_obs, leer_archivo, horas=26, V=None, M=None, aisladas=()):
    """E: estaciones (DataFrame); cods_obs: códigos con observador (se excluyen). Devuelve el dict para el KV."""
    fin = pd.Timestamp.utcnow().tz_localize(None)
    A = leer_archivo(raiz, fin, horas=horas)
    cods_obs = {str(c) for c in cods_obs}
    meta = E.set_index("codigo")[["nombre", "oaci", "lat", "lon", "alt"]].to_dict("index")
    por = {c: g for c, g in A.groupby("codigo")} if len(A) else {}
    cmp_al = {}
    try:   # comparación con vecinas y modelo, sobre el valor horario
        sin = A[~A["codigo"].isin(cods_obs)] if len(A) else A
        for h in comparar(P.horario(sin[sin["momento"] > fin - pd.Timedelta(hours=8)]) if len(sin) else sin, E, V or {}, M, aisladas):
            cmp_al.setdefault(h.pop("_cod"), []).append(h)
    except Exception:
        cmp_al = {}
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
            except Exception:
                fila["res"] = {}
            try:
                fila["hallazgos"] = _estacion(g, m)
                fila["hallazgos"] += cmp_al.get(cod, [])
            except Exception as e:      # una estación mala no tumba a las demás
                fila["hallazgos"] = [dict(hora=fila["ultima"], regla="ZERR", nivel=0, tipo="tem", msg=f"No se pudo revisar: {e}")][:0]
            fila["nivel"] = max([h["nivel"] for h in fila["hallazgos"]], default=0)
        else:
            fila["nivel"] = 3
        est.append(fila)
    return dict(generado=pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%S"), horas=horas, estaciones=est)
