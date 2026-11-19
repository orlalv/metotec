"""Pluviómetros que podrían no estar marcando: periodos en que probablemente llovió y la estación marca 0 (o no tiene dato).

Para cada estación y cada hora cerrada se juntan hasta tres evidencias de lluvia, independientes entre sí:
  · vecinas   al menos 2 estaciones a ≤ 60 km con ≥ 1 mm en la hora y ≥ 60 % de las que reportan
  · modelo    Open-Meteo con ≥ 0,5 mm en la hora o en la anterior/siguiente (el modelo se equivoca en la hora)
  · satélite  GOES: lluvia estimada con nube cerrada, o nube cerrada con tope más frío que −35 °C, o rayos (sat_estaciones.json, últimas 12 h;
              cada corrida archiva el resumen horario en datos/sat/ para poder mirar periodos largos)
  · IMERG     (NASA, imágenes de GIBS, qc/imerg.py) ≥ 0,5 mm en la hora o en la anterior/siguiente; tiene unas 5 h de retraso, así que las horas más recientes no lo traen
El efecto contrario también se revisa: lluvia en la estación con el cielo totalmente despejado y sin lluvia en vecinas ni modelo.
Si hay vecinas con dato y todas están secas, la estación en 0 es coherente y no se sospecha (modelo y satélite solos solo valen sin vecinas cercanas).
Una evidencia de modelo, IMERG o vecinas exige ≥ 1 mm en la hora (±1 h); un episodio es «sospecha de obstrucción» si dura ≥ 3 h y la lluvia esperada suma ≥ 3 mm.
Una hora es «sospechosa» si hay ≥ 2 evidencias y la estación marca menos de 0,2 mm o no tiene dato.
Horas sospechosas seguidas forman un episodio. Además: eventos de lluvia seguidos sin que la estación marque (y desde cuándo), y «goteo»
(horas seguidas con 0,1–0,2 mm sin lluvia en el entorno: agua que escurre de un embudo tapado). La cadencia de transmisión (1, 10 o 60 min) no importa. Un episodio de ≥ 3 horas con la estación en 0 (no sin dato) es «sospecha de obstrucción»;
si en su mayoría no hay dato, es un problema de comunicación y no del pluviómetro.
Además se calcula la razón largo plazo estación / vecinas en las horas con lluvia de las vecinas, y se avisa si ahora el pluviómetro
«descarga» de golpe después de un episodio (agua acumulada que se liberó).
El resultado es una sospecha para enviar a revisión; nunca se corrige el valor. Salida: datos/productos/pluviometros.json y KV «qc/pluviometros».
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np
import pandas as pd

VERSION = 6                      # sube cuando cambia la forma del producto: qc/correr.py lo regenera aunque no hayan pasado 6 h
RADIO_KM = 60
RADIO_VER = 120          # vecinas DMC que se muestran en el detalle y el mapa (solo referencia visual)
MM_VECINA = 1.0
FRAC_VECINAS = 0.6
MM_MODELO = 1.0                  # un modelo o IMERG con lloviznas de décimas no distingue de «0» a un pluviómetro de balancín
MM_IMERG = 1.0
MM_OBSTR = 3.0                   # un episodio solo es «sospecha de obstrucción» si la lluvia esperada suma al menos esto (mm)
MARCA_MIN = 0.2                  # menos que esto en la hora = «no marca»
MIN_DATOS = 70                   # % de los datos esperados en la hora (según la cadencia de la estación: 1, 10, 60 min) para considerarla completa
GOTEO_MAX, GOTEO_H, GOTEO_LARGO = 0.4, 8, 12   # horas seguidas con 0 < mm ≤ 0,4 sin lluvia en el entorno; ≥ 12 h = sospecha
EVENTOS_OBSTR = 2               # eventos de lluvia del entorno seguidos sin que la estación marque
EV_MIN = 2                       # evidencias necesarias
HORAS_OBSTRUCCION = 3
RAZON_BAJA, MM_RAZON, RADIO_RAZON = 0.3, 20.0, 40     # la razón solo vale con lluvia acumulada suficiente (≥ 20 mm en la vecina) y vecinas cercanas
DESCARGA_MM = 2.0
EXT_PESO, EXT_TOPE = 0.5, 3            # vecinas externas: peso de cada una y cuántas como máximo por estación


def _km(la, lo):
    la, lo = np.radians(la), np.radians(lo)
    a = np.sin((la[:, None] - la[None]) / 2) ** 2 + np.cos(la[:, None]) * np.cos(la[None]) * np.sin((lo[:, None] - lo[None]) / 2) ** 2
    return 6371 * 2 * np.arcsin(np.sqrt(a))


def _km1(la1, lo1, la2, lo2):
    return float(_km(np.array([la1, la2], float), np.array([lo1, lo2], float))[0, 1])


def _mediana_pond(v, w):
    import externas_vec as EV
    return float(EV.mediana_pond(v, w))


def leer_horas(raiz, desde, hasta):
    """Lluvia por estación y hora cerrada desde el archivo minutario: (mm, % de datos esperados con dato según la cadencia de cada estación), índices hora UTC y código."""
    partes, t = [], pd.Timestamp(desde).floor("h")
    while t <= pd.Timestamp(hasta):
        f = Path(raiz) / "ema" / t.strftime("%Y/%m/%d/%H.csv.gz")
        if f.exists():
            try:
                partes.append(pd.read_csv(f, dtype={"codigo": str}, parse_dates=["momento"], usecols=["codigo", "momento", "rr1m"]))
            except Exception:
                pass
        t += pd.Timedelta(hours=1)
    if not partes:
        return pd.DataFrame(), pd.DataFrame()
    A = pd.concat(partes, ignore_index=True).drop_duplicates(["codigo", "momento"])
    A = A[(A["momento"] > pd.Timestamp(desde)) & (A["momento"] <= pd.Timestamp(hasta))]
    A["h"] = A["momento"].dt.ceil("h")
    g = A.groupby(["codigo", "h"])["rr1m"].agg(rr="sum", n="count").reset_index()
    paso = A.sort_values("momento").groupby("codigo")["momento"].apply(lambda x: max(1.0, x.diff().dt.total_seconds().median() / 60 if len(x) > 1 else 1.0))
    g["n"] = (100.0 * g["n"] / (60.0 / g["codigo"].map(paso).fillna(1.0))).clip(upper=100)
    return g.pivot(index="h", columns="codigo", values="rr"), g.pivot(index="h", columns="codigo", values="n")


def modelo_pp(E, dias, lote=25):
    """Precipitación horaria del modelo (Open-Meteo, past_days) por estación: DataFrame h × código, mm."""
    import time
    import modelo as MO
    E = E.dropna(subset=["lat", "lon"]).reset_index(drop=True)
    cols = {}
    for i in range(0, len(E), lote):
        L = E.iloc[i:i + lote]
        p = dict(latitude=",".join(f"{x:.4f}" for x in L.lat), longitude=",".join(f"{x:.4f}" for x in L.lon),
                 elevation=",".join(f"{(x if pd.notna(x) else 0):.0f}" for x in L.alt), hourly="precipitation",
                 past_days=min(dias + 1, 92), forecast_days=1, timezone="GMT")
        try:
            js = MO._pedir(p, 60)
        except Exception as e:
            MO.ULTIMOS_ERRORES.append(f"pluviómetros lote {i // lote + 1}: {e}")
            continue
        for cod, j in zip(L.codigo, js if isinstance(js, list) else [js]):
            h = j.get("hourly") or {}
            if h.get("time"):
                cols[str(cod)] = pd.Series(h.get("precipitation"), index=pd.to_datetime(h["time"]), dtype=float)
        time.sleep(1.5)
    return pd.DataFrame(cols)


def resumen_satelite(sat, horas):
    """{hora: {código: [lluvia, nube_fria, despejado, tope_min, rayos]}} a partir de las imágenes de las últimas 12 h (sat_estaciones.json).
      lluvia      ≥ 3 imágenes de la hora con lluvia estimada (rr10 ≥ 2) y nube cerrada (≥ 90 % a 10 km)
      nube_fria   ≥ 3 imágenes con nube cerrada y tope a 10 km más frío que −35 °C, o rayos a ≤ 10 km (nube con capacidad de dar lluvia)
      despejado   todas las imágenes (≥ 4) con ≤ 5 % de nube en 30 km
    Solo se resumen las horas con ≥ 4 imágenes."""
    import satelite as SAT
    S = SAT.series(sat)
    out = {}
    for h in horas:
        d = {}
        for cod, F in S.items():
            v = [f for t, f in F if h - pd.Timedelta(hours=1) < t <= h]
            if len(v) < 4:
                continue
            llu = sum(1 for f in v if (f.get("rr10") or 0) >= 2 and (f.get("nub10") or 0) >= 90) >= 3
            tp = [f.get("t13n10") for f in v if f.get("t13n10") is not None]
            ray = int(sum(f.get("ray10") or 0 for f in v))
            fria = sum(1 for f in v if (f.get("nub10") or 0) >= 90 and f.get("t13n10") is not None and f["t13n10"] <= -35) >= 3 or ray >= 1
            nub = [f.get("nub30") for f in v if f.get("nub30") is not None]
            desp = len(nub) >= 4 and all(x <= 5 for x in nub)
            g = lambda k, fn: (round(float(fn(x)), 1) if (x := [f.get(k) for f in v if f.get(k) is not None]) else None)
            # [lluvia, nube fría, despejado, tope más frío °C, rayos, nube 10 km % (media), nube 30 km % (media), área < −40 °C % (máx), lluvia estimada máx mm/h, imágenes]
            d[cod] = [bool(llu), bool(fria), bool(desp), (round(min(tp), 1) if tp else None), ray,
                      g("nub10", np.mean), g("nub30", np.mean), g("frio30", np.max), g("rr10", np.max), len(v)]
        if d:
            out[h] = d
    return out


def archivar_satelite(raiz, resumen):
    """Guarda el resumen horario en datos/sat/AAAA/MM/DD.json (se acumula: así la evidencia satelital queda para analizar periodos largos)."""
    por_dia = {}
    for h, d in resumen.items():
        por_dia.setdefault(h.strftime("%Y/%m/%d"), {})[h.strftime("%H")] = d
    for dia, horas in por_dia.items():
        f = Path(raiz) / "sat" / f"{dia}.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        previo = _leer(f)
        previo.update(horas)
        f.write_text(json.dumps(previo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def _leer(f):
    try:
        return json.loads(Path(f).read_text(encoding="utf-8"))
    except Exception:
        return {}


def leer_satelite(raiz, desde, hasta):
    """Resumen archivado: {hora: {código: [...]}}."""
    out, t = {}, pd.Timestamp(desde).floor("D")
    while t <= pd.Timestamp(hasta):
        for hh, d in _leer(Path(raiz) / "sat" / f"{t:%Y/%m/%d}.json").items():
            out[t + pd.Timedelta(hours=int(hh))] = d
        t += pd.Timedelta(days=1)
    return out


def tablas_satelite(resumen, horas):
    """De {hora: {código: [lluvia, fria, despejado, ...]}} a tres DataFrames (hora × código) con True/False y NaN donde no hay imagen:
    evidencia de lluvia (lluvia o nube fría), solo la lluvia estimada y cielo despejado."""
    cods = sorted({c for d in resumen.values() for c in d})
    ev, desp = pd.DataFrame(index=horas, columns=cods, dtype=object), pd.DataFrame(index=horas, columns=cods, dtype=object)
    for h, d in resumen.items():
        if h in ev.index:
            for c, v in d.items():
                ev.at[h, c] = bool(v[0] or v[1])
                desp.at[h, c] = bool(v[2])
    return ev, desp


def analizar(R, N, E, M=None, S=None, I=None, C=None, T=None, EXT=None):
    """R, N: mm y minutos con dato (hora × código). E: estaciones (codigo, nombre, lat, lon). M: modelo (hora × código, mm).
    S: satélite, evidencia de lluvia (hora × código, bool). C: satélite, cielo despejado (hora × código, bool). T: resumen satelital archivado ({hora: {código: [lluvia, fría, despejado, tope, rayos, nub10, nub30, frío30, rr10, imágenes]}}) solo para el detalle. I: IMERG (hora × código, mm). EXT: vecinas externas (INIA…), solo comparación: {pp: lluvia horaria hora × id, cat: {id: {lat, lon}}}; pesan EXT_PESO y se muestran todas las de ≤ RADIO_KM (y al menos las EXT_TOPE más cercanas); cuentan como evidencia solo las de ≤ RADIO_KM. Devuelve la lista de estaciones con su diagnóstico."""
    E = E.copy()
    E["codigo"] = E["codigo"].astype(str)
    E = E[E["codigo"].isin(R.columns)].dropna(subset=["lat", "lon"]).reset_index(drop=True)
    cods = list(E["codigo"])
    horas = list(R.index)
    V = R[cods].where(N[cods] >= MIN_DATOS)                          # mm solo de horas completas; si no, NaN
    D = _km(E["lat"].values.astype(float), E["lon"].values.astype(float))
    np.fill_diagonal(D, np.inf)
    nom = dict(zip(E["codigo"], E["nombre"]))
    out = []
    for j, c in enumerate(cods):
        vec = np.where(D[j] <= RADIO_KM)[0]
        X = V.iloc[:, vec].values if len(vec) else np.empty((len(horas), 0))
        tot_d = np.isfinite(X).sum(1)                                  # solo DMC: lo que se muestra en el detalle
        llu_d = np.nansum(np.where(np.isfinite(X), X >= MM_VECINA, False), 1)
        XE = np.empty((len(horas), 0))
        disp = [k for k in np.argsort(D[j])[:8] if D[j, k] <= RADIO_VER]
        ids, dke = [], []
        if EXT and EXT.get("pp") is not None and len(EXT["pp"].columns):
            # siempre las EXT_TOPE externas más cercanas con datos, sin límite de radio
            kmx = lambda i: _km1(E["lat"].values[j], E["lon"].values[j], EXT["cat"][i]["lat"], EXT["cat"][i]["lon"])
            ids = sorted([i for i, c in EXT["cat"].items() if i in EXT["pp"].columns and c.get("lat") is not None and EXT["pp"][i].notna().any()], key=kmx)
            ids = [i for k, i in enumerate(ids) if k < EXT_TOPE or kmx(i) <= RADIO_KM]       # todas las de ≤ 60 km, y al menos las 3 más cercanas
            dke = [kmx(i) for i in ids]
            XV = EXT["pp"][ids].reindex(horas).values.astype(float) if ids else XE      # se muestran siempre
            XE = XV[:, [k for k, d in enumerate(dke) if d <= RADIO_KM]] if ids else XE  # cuentan como evidencia solo a ≤ RADIO_KM
        XA = np.hstack([X, XE])                                        # DMC y externas; las externas pesan menos
        w = np.concatenate([np.ones(X.shape[1]), np.full(XE.shape[1], EXT_PESO)])
        fin_ = np.isfinite(XA)
        tot = (fin_ * w).sum(1)
        llu = (np.where(fin_, XA >= MM_VECINA, False) * w).sum(1)
        ev_vec = (tot >= 2) & (llu >= 2) & (llu >= FRAC_VECINAS * np.maximum(tot, 1))
        mm_vec = np.array([_mediana_pond(r[fin_[i] & (r >= MM_VECINA)], w[fin_[i] & (r >= MM_VECINA)]) if ev_vec[i] else 0.0 for i, r in enumerate(XA)])
        n_ext = np.isfinite(XE).sum(1) if XE.shape[1] else np.zeros(len(horas), int)
        ext_llu = np.nansum(np.where(np.isfinite(XE), XE >= MM_VECINA, False), 1) if XE.shape[1] else np.zeros(len(horas), int)
        ev_mod = np.zeros(len(horas), bool)
        mm_mod = np.zeros(len(horas))
        if M is not None and c in M.columns:
            m = M[c].reindex(horas).fillna(0).values
            mm_mod = m
            ev_mod = pd.Series(m).rolling(3, center=True, min_periods=1).max().values >= MM_MODELO
        ev_sat = np.zeros(len(horas), bool)
        if S is not None and c in S.columns:
            ev_sat = S[c].reindex(horas).fillna(False).astype(bool).values
        ev_imerg = np.zeros(len(horas), bool)
        mm_imerg = np.full(len(horas), np.nan)
        if I is not None and c in I.columns:
            mm_imerg = I[c].reindex(horas).values.astype(float)
            ev_imerg = pd.Series(np.nan_to_num(mm_imerg, nan=0.0)).rolling(3, center=True, min_periods=1).max().values >= MM_IMERG     # ±1 h, igual que el modelo
        pts = ev_vec.astype(int) + ev_mod + ev_sat + ev_imerg
        fuerza = np.maximum.reduce([mm_vec, mm_mod, np.nan_to_num(mm_imerg, nan=0.0)])     # mm esperados en la hora según la mejor fuente
        # si hay vecinas con dato y ninguna llueve, la estación en 0 es coherente: modelo y satélite solos no bastan (se equivocan más que un pluviómetro vecino).
        # Solo valen sin vecinas cercanas con dato (estación aislada).
        pts = np.where(ev_vec | (tot < 2), pts, 0)
        mi = V[c].values
        sin_dato = ~np.isfinite(mi)
        no_marca = sin_dato | (np.nan_to_num(mi, nan=0.0) < MARCA_MIN)
        sosp = (pts >= EV_MIN) & no_marca
        # episodios: horas sospechosas separadas por ≤ 1 hora
        eps, i = [], 0
        idx = np.where(sosp)[0]
        while i < len(idx):
            k = i
            while k + 1 < len(idx) and idx[k + 1] - idx[k] <= 2:
                k += 1
            a, b = idx[i], idx[k]
            seg = np.arange(a, b + 1)
            n_sosp = int(sosp[seg].sum())
            n_sd = int((sosp[seg] & sin_dato[seg]).sum())
            sigue = (b + 1 < len(horas) and np.isfinite(mi[b + 1]) and mi[b + 1] >= DESCARGA_MM and mm_vec[seg].sum() > 0 and mi[b + 1] >= 0.5 * mm_vec[seg].sum())
            det = []
            for i2 in seg[-24:]:
                t = (T or {}).get(horas[i2], {}).get(c)
                # para mostrar: las DMC más cercanas hasta RADIO_VER km (las de más de RADIO_KM no cuentan como evidencia)
                vecs = [[nom.get(cods[k], cods[k]), round(float(D[j, k])), (None if not np.isfinite(V.iat[i2, k]) else round(float(V.iat[i2, k]), 1))] for k in disp]
                vecs += [[f'{EXT["cat"][i].get("inst", "")} {EXT["cat"][i].get("nombre", i)} (ext.)'.strip(), round(dke[k]), (None if not np.isfinite(XV[i2, k]) else round(float(XV[i2, k]), 1)), EXT["cat"][i]["lat"], EXT["cat"][i]["lon"]] for k, i in enumerate(ids)]
                sx = (t[5:] + [None] * 5)[:5] if t else [None] * 5
                det.append(dict(vecs=vecs, mod3=[round(float(mm_mod[i2 - 1]), 1) if i2 > 0 else None, round(float(mm_mod[i2]), 1), round(float(mm_mod[i2 + 1]), 1) if i2 + 1 < len(horas) else None],
                                nub10=sx[0], nub30=sx[1], frio30=sx[2], rr10=sx[3], imagenes=sx[4] if t else None, hora=f"{horas[i2]:%m-%d %H:%M}", est=None if np.isnan(mi[i2]) else round(float(mi[i2]), 1), vec=round(float(mm_vec[i2]), 1),
                                n_vec=int(llu_d[i2]), n_tot=int(tot_d[i2]), n_ext=int(n_ext[i2]), ext_llu=int(ext_llu[i2]), mod=round(float(mm_mod[i2]), 1), imerg=(None if np.isnan(mm_imerg[i2]) else round(float(mm_imerg[i2]), 1)), sat=bool(ev_sat[i2]),
                                fria=(t[1] if t else None), tope=(t[3] if t else None), ray=(t[4] if t else None), sospechosa=bool(sosp[i2])))
            eps.append(dict(detalle=det, inicio=f"{horas[a] - pd.Timedelta(hours=1):%Y-%m-%d %H:%M}", fin=f"{horas[b]:%Y-%m-%d %H:%M}", horas=n_sosp, sin_dato=n_sd,
                            evidencia=dict(vecinas=bool(ev_vec[seg].any()), modelo=bool(ev_mod[seg].any()), satelite=bool(ev_sat[seg].any()), imerg=bool(ev_imerg[seg].any())),
                            mm_vecinas=round(float(mm_vec[seg].sum()), 1), mm_modelo=round(float(mm_mod[seg].sum()), 1), mm_imerg=round(float(np.nan_to_num(mm_imerg[seg], nan=0.0).sum()), 1),
                            descarga_tardia=bool(sigue)))
            i = k + 1
        # efecto contrario: la estación marca lluvia con el cielo totalmente despejado, sin lluvia en las vecinas ni en el modelo (riego, mantención, insecto en el embudo)
        despejado = np.zeros(len(horas), bool)
        if C is not None and c in C.columns:
            despejado = C[c].reindex(horas).fillna(False).astype(bool).values
        mi_ok = np.nan_to_num(mi, nan=0.0)
        raras = np.where(despejado & (mi_ok >= 0.5) & (pts == 0) & ~ev_mod)[0]
        # lluvia solo en la estación (sí/no): marca ≥ 0,5 mm y todas sus vecinas con dato (≥ 3, peso ≥ 2,5) están en 0 y el modelo seco
        seca_v = np.array([bool(fin_[i].any()) and bool((XA[i][fin_[i]] < 0.2).all()) for i in range(len(horas))])
        sola = np.where((mi_ok >= 0.5) & seca_v & (tot >= 2.5) & (fin_.sum(1) >= 3) & ~ev_mod)[0]
        sola_h = [dict(hora=f"{horas[i]:%Y-%m-%d %H:%M}", mm=round(float(mi_ok[i]), 1), vecinas=int(fin_[i].sum())) for i in sola][-6:]
        raras_h = [dict(hora=f"{horas[i]:%Y-%m-%d %H:%M}", mm=round(float(mi_ok[i]), 1)) for i in raras][-6:]
        # eventos de lluvia del entorno (≥ 2 evidencias) y si la estación marcó en cada uno; solo se juzgan las horas con dato
        ev_h = [i for i in np.where((pts >= EV_MIN) & (fuerza >= 1.0))[0] if np.isfinite(mi[i])]
        eventos, grupo = [], []
        for i in ev_h:
            if grupo and i - grupo[-1] > 6:
                eventos.append(grupo); grupo = []
            grupo.append(i)
        if grupo:
            eventos.append(grupo)
        marco = [bool(np.nanmax(mi[g]) >= MARCA_MIN) for g in eventos]
        seguidos = 0
        for m in reversed(marco):
            if m:
                break
            seguidos += 1
        desde_sin = f"{horas[eventos[-seguidos][0]] - pd.Timedelta(hours=1):%Y-%m-%d %H:%M}" if seguidos else None
        ultima_marca = next((f"{horas[i]:%Y-%m-%d %H:%M}" for g, m in zip(reversed(eventos), reversed(marco)) if m for i in [max(g, key=lambda k: mi[k])]), None)
        # goteo: hora tras hora 0,1–0,2 mm sin lluvia en el entorno (agua que escurre de un embudo o cubeta tapada)
        tick = np.isfinite(mi) & (mi > 0) & (mi <= GOTEO_MAX)
        seco = (pts == 0) & (tot >= 2) & (np.array([(np.nansum(np.where(np.isfinite(r), r >= 0.1, False)) / max(np.isfinite(r).sum(), 1)) for r in X]) <= 0.34 if X.shape[1] else False)
        gote, i = [], 0
        while i < len(horas):
            if tick[i] and seco[i]:
                k = i
                while k + 1 < len(horas) and ((tick[k + 1] and seco[k + 1]) or (k + 2 < len(horas) and mi[k + 1] == 0 and tick[k + 2] and seco[k + 2] and seco[k + 1])):
                    k += 1
                nt = int(tick[i:k + 1].sum())
                if k - i + 1 >= GOTEO_H and nt >= 0.6 * (k - i + 1):
                    gote.append(dict(inicio=f"{horas[i] - pd.Timedelta(hours=1):%Y-%m-%d %H:%M}", fin=f"{horas[k]:%Y-%m-%d %H:%M}", horas=k - i + 1, mm=round(float(np.nansum(mi[i:k + 1])), 1)))
                i = k + 1
            else:
                i += 1
        # razón largo plazo: total de la estación / total de cada vecina en las horas en que ambas tienen dato (no depende del horario de cada hora)
        ratios = []
        for k, v in enumerate(vec):
            if D[j, v] > RADIO_RAZON:
                continue
            ambos = np.isfinite(mi) & np.isfinite(X[:, k])
            tv = float(X[ambos, k].sum())
            if ambos.sum() >= 24 and tv >= MM_RAZON:
                ratios.append(float(mi[ambos].sum()) / tv)
        sv = float(np.sum(mm_vec))
        razon = round(float(np.median(ratios)), 2) if len(ratios) >= 2 else None
        marca0 = [e for e in eps if e["sin_dato"] < e["horas"] / 2]
        esperada = lambda e: max(e["mm_vecinas"], e["mm_modelo"], e.get("mm_imerg", 0.0))
        obstr = any(e["horas"] >= HORAS_OBSTRUCCION and esperada(e) >= MM_OBSTR for e in marca0) or any(e["descarga_tardia"] and e["horas"] >= 2 and esperada(e) >= MM_OBSTR for e in marca0) or seguidos >= EVENTOS_OBSTR
        goteo_largo = any(g["horas"] >= GOTEO_LARGO for g in gote)
        comunic = any(e["sin_dato"] >= e["horas"] / 2 for e in eps)
        if obstr or goteo_largo or (razon is not None and razon < RAZON_BAJA and len(ratios) >= 3):
            estado = "sospecha_obstruccion"
        elif gote or len(raras) >= 2 or len(sola) >= 2 or (razon is not None and razon < RAZON_BAJA):
            estado = "revisar"
        elif marca0:
            estado = "revisar"
        elif comunic:
            estado = "sin_dato_con_lluvia"
        else:
            estado = "ok"
        out.append(dict(codigo=c, nombre=nom.get(c, c), estado=estado, horas_sospechosas=int(sosp.sum()), horas_sin_dato=int((sosp & sin_dato).sum()),
                        horas_con_evidencia=int((pts >= EV_MIN).sum()), lluvia_con_cielo_despejado=raras_h, lluvia_sola=sola_h, horas_lluvia_sola=int(len(sola)), eventos_sin_marcar=seguidos, sin_marcar_desde=desde_sin, ultima_vez_que_marco=ultima_marca, goteo=gote[-3:],
                        razon_vecinas=razon, vecinas_comparadas=len(ratios), mm_vecinas_largo=round(sv, 1),
                        episodios=sorted(eps, key=lambda e: e["inicio"], reverse=True)[:6]))
    orden = {"sospecha_obstruccion": 0, "revisar": 1, "sin_dato_con_lluvia": 2, "ok": 3}
    out.sort(key=lambda f: (orden[f["estado"]], -f["horas_sospechosas"], f["nombre"]))
    return out


def correr(raiz, ahora=None, dias=30, subir=None, sat=None, imerg=None, con_modelo=True, ext=None):
    """Calcula el diagnóstico de los últimos días, lo guarda en datos/productos/pluviometros.json y lo sube al KV."""
    ahora = (ahora or datetime.now(timezone.utc)).replace(tzinfo=None, minute=0, second=0, microsecond=0)
    desde = ahora - timedelta(days=dias)
    R, N = leer_horas(raiz, desde, ahora)
    if R.empty:
        return dict(error="sin datos minutarios en el periodo")
    E = pd.DataFrame(json.loads((Path(raiz) / "estaciones.json").read_text(encoding="utf-8")))
    fuentes = dict(vecinas=True, modelo=False, satelite=False, imerg=False)
    M = None
    if con_modelo:
        try:
            M = modelo_pp(E, dias)
            fuentes["modelo"] = not M.empty
        except Exception:
            M = None
    S = C = None
    arch = {}
    try:
        if sat:
            frames = resumen_satelite(sat, sorted({pd.Timestamp(f["t"]).tz_localize(None).ceil("h") for f in sat.get("frames", [])}))
            archivar_satelite(raiz, frames)
        arch = leer_satelite(raiz, desde, ahora)
        if arch:
            S, C = tablas_satelite(arch, list(R.index))
            fuentes["satelite"] = True
            fuentes["satelite_horas"] = len(arch)
    except Exception:
        S = C = None
    if imerg is None:       # IMERG (NASA, vía GIBS): baja los pasos de 30 min que faltan y arma la tabla por hora
        try:
            import imerg as IM
            fuentes["imerg_pasos_nuevos"] = IM.actualizar(raiz, E, ahora)
            imerg = IM.tabla(raiz, list(R.index), [str(c) for c in E["codigo"]])
            if not imerg.notna().any().any():
                imerg = None
        except Exception as e:
            fuentes["imerg_error"] = f"{type(e).__name__}: {str(e)[:120]}"
            imerg = None
    fuentes["imerg"] = imerg is not None
    EXT = None
    if ext is not None:       # vecinas externas (solo comparación): lluvia horaria archivada + lo más reciente del KV
        try:
            import externas_vec as EV
            EXT = dict(pp=EV.leer_pp(raiz, desde, ahora, ext), cat=ext.cat)
            fuentes["externas"] = int(EXT["pp"].shape[1])
        except Exception as e:
            fuentes["externas_error"] = f"{type(e).__name__}: {str(e)[:120]}"
    est = analizar(R, N, E, M, S, imerg, C, arch, EXT=EXT)
    cuenta = {k: sum(1 for e in est if e["estado"] == k) for k in ("sospecha_obstruccion", "revisar", "sin_dato_con_lluvia", "ok")}
    res = dict(version=VERSION, generado=f"{ahora:%Y-%m-%d %H:%M}", desde=f"{desde:%Y-%m-%d %H:%M}", hasta=f"{ahora:%Y-%m-%d %H:%M}", dias=dias,
               horas=len(R.index), fuentes=fuentes, resumen=cuenta, estaciones=est)
    txt = json.dumps(res, ensure_ascii=False)
    f = Path(raiz) / "productos" / "pluviometros.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(txt, encoding="utf-8")
    return dict(resumen=cuenta, fuentes=fuentes, kv=subir("qc/pluviometros", txt) if subir else "sin subir")
