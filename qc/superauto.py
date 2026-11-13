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
SALTO_T = (2.5, 4.5)       # °C entre minutos consecutivos (≤ 10 min); la pasada normal usa 4 / 8
SALTO_TD = (3.0, 6.0)
SALTO_HR = (15, 30)        # la normal: 25 / 45
SALTO_P = (0.8, 1.5)       # hPa; la normal: 1.5 / 3
SALTO_FF = (2.5, 5.0)      # el viento medio de 10 min no puede cambiar tanto de un minuto a otro
TOL_EXT = 0.3              # °C: la normal acepta 1.5 °C
TOL_HR = (6, 12)           # % entre HR informada y la calculada con Ts y Td
TOL_QFF = (3.0, 6.0)       # hPa entre QFF informado y el reducido desde QFE
PEGADO_H = {"T": 2, "Td": 2, "P_est": 2, "HR": 6}      # horas sin cambio (la normal: 3, 3, 3, 10)
VAR3H_P = 8.0              # hPa en 3 h
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
        lo, hi = tl + 2, th - 2          # 2 °C más estrecho que en la pasada normal
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
        x = _salto(g24, "ff10", SALTO_FF, "ZV01", "vie", "Viento medio 10 min", "")
        if x: out.append(x)
        x = _pegado(g, "ff10", 3, "ZV02", "vie", "Viento medio 10 min", lambda s: s.iloc[-1] > 1)
        if x: out.append(x)
        if "dd10" in g:
            W = g[g["momento"] > fin - pd.Timedelta(hours=3)]
            if W["momento"].nunique() >= 6 and (W["momento"].max() - W["momento"].min()) >= pd.Timedelta(hours=2.5):
                s, f = W["dd10"].dropna(), W["ff10"].dropna()
                if len(s) >= 6 and s.max() == s.min() and len(f) and f.min() > 2:
                    out.append(_h(None, "ZV03", 2, "vie", fin, f"Dirección {s.iloc[-1]:.0f}° sin cambio durante 3 h con viento sobre {f.min():.0f}"))
            mal = g24[(g24["dd10"] == 0) & (g24["ff10"] > 1)]
            if len(mal):
                i = mal.index[-1]
                out.append(_h(None, "ZV04", 1, "vie", mal.at[i, "momento"], f"Dirección 0° con viento {mal.at[i, 'ff10']:.1f} (el norte se informa como 360°; {len(mal)} minutos)"))
            mal = g24[(g24["dd10"] > 360) | (g24["dd10"] < 0)]
            if len(mal):
                i = mal.index[-1]
                out.append(_h(None, "ZV05", 2, "vie", mal.at[i, "momento"], f"Dirección {mal.at[i, 'dd10']:.0f}° fuera de 0–360"))
        if "fx10" in g24:
            mal = g24[g24["fx10"] < g24["ff10"] - 0.5]
            if len(mal):
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

    # ---------------- extremas del sensor (Tn12, Tx12) frente a la temperatura por minuto
    if "Tn12" in g and (g["momento"].max() - g["momento"].min()) >= pd.Timedelta(hours=24):
        u = g.dropna(subset=["T"])
        for var, mn in (("Tn12", True), ("Tx12", False)):
            x = g[var].dropna()
            if x.empty:
                continue
            t = g.at[x.index[-1], "momento"]
            val = float(x.iloc[-1])
            W = u[(u["momento"] > t - pd.Timedelta(hours=12)) & (u["momento"] <= t)]
            if len(W) < 600:
                continue
            ref = float(W["T"].min() if mn else W["T"].max())
            nom = "Tmín" if mn else "Tmáx"
            if (mn and val < ref - TOL_EXT) or (not mn and val > ref + TOL_EXT):
                out.append(_h(None, "ZE01", 2, "ext", t, f"{var} {val:.1f} °C pero la temperatura por minuto de las 12 h previas solo {'bajó' if mn else 'subió'} a {ref:.1f} °C (extrema imposible, diferencia {abs(val - ref):.1f} °C)"))
            elif (mn and val > ref + TOL_EXT) or (not mn and val < ref - TOL_EXT):
                out.append(_h(None, "ZE02", 1, "ext", t, f"{var} {val:.1f} °C no recoge el {nom.lower()} por minuto de las 12 h previas ({ref:.1f} °C, diferencia {abs(val - ref):.1f} °C)"))
        a, b = g["Tn12"].dropna(), g["Tx12"].dropna()
        if len(a) and len(b) and a.iloc[-1] > b.iloc[-1] + 0.05:
            out.append(_h(None, "ZE03", 2, "ext", g["momento"].max(), f"Tn12 {a.iloc[-1]:.1f} mayor que Tx12 {b.iloc[-1]:.1f} °C"))
    return out


def correr(raiz, E, cods_obs, leer_archivo, horas=26):
    """E: estaciones (DataFrame); cods_obs: códigos con observador (se excluyen). Devuelve el dict para el KV."""
    fin = pd.Timestamp.utcnow().tz_localize(None)
    A = leer_archivo(raiz, fin, horas=horas)
    cods_obs = {str(c) for c in cods_obs}
    meta = E.set_index("codigo")[["nombre", "oaci", "lat", "lon", "alt"]].to_dict("index")
    por = {c: g for c, g in A.groupby("codigo")} if len(A) else {}
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
                fila["hallazgos"] = _estacion(g, m)
            except Exception as e:      # una estación mala no tumba a las demás
                fila["hallazgos"] = [dict(hora=fila["ultima"], regla="ZERR", nivel=0, tipo="tem", msg=f"No se pudo revisar: {e}")][:0]
            fila["nivel"] = max([h["nivel"] for h in fila["hallazgos"]], default=0)
        else:
            fila["nivel"] = 3
        est.append(fila)
    return dict(generado=pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%S"), horas=horas, estaciones=est)
