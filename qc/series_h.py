"""Series históricas horarias de SACLIM (portal: /application/datos/getDatosSaclim/{cod}_{año}_{Variable}_, ZIP con un CSV).

Guarda cada archivo en la rama de datos (saclim/{cod}/{año}/{Variable}.csv.gz), registra los valores que cambian entre
descargas (saclim/cambios.jsonl) y revisa cada estación con controles vectorizados (rápidos para décadas de datos):
  RANGO  fuera del rango físico                      DIG   posible error de digitación (signo, decimal, dígitos)
  CLIMA  fuera de lo normal de la estación (mes y hora)  PICO  sube o baja y vuelve en la hora siguiente
  PEGADO mismo valor muchas horas seguidas            HRTD  HR que no calza con Ts y Td
  TDTS   Td mayor que Ts                               SALTO salto de presión en una hora
  EXTH   máxima/mínima que no calza con las Ts horarias
  HUECO  horas sin dato (resumen por año y variable)"""
import io, json, math, time, zipfile, gzip
from datetime import datetime, timezone, date
from pathlib import Path
import numpy as np, pandas as pd, requests

URL = "https://climatologia.meteochile.gob.cl/application/datos/getDatosSaclim/{cod}_{a}_{v}_"
VARS = ["Temperatura", "PuntoRocio", "Humedad", "PresionQFE", "PresionQFF", "Viento", "Agua6Horas", "TMaxima", "TMinima"]
UA = {"User-Agent": "METOTEC control de calidad de series (DMC)"}
NOM = {"Ts": "Ts", "Td": "Td", "HR": "HR", "QFE": "QFE", "QFF": "QFF", "ff": "viento", "RRR6": "RRR6"}
UNI = {"Ts": "°C", "Td": "°C", "HR": "%", "QFE": "hPa", "QFF": "hPa", "ff": "kt", "RRR6": "mm"}
RANGO = {"Ts": (-35, 46), "Td": (-50, 32), "HR": (1, 100), "QFE": (500, 1080), "QFF": (920, 1060), "ff": (0, 120), "RRR6": (0, 300)}
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


# ------------------------------------------------------------------ descarga
def descargar(cod, a, v, timeout=90):
    r = requests.get(URL.format(cod=cod, a=a, v=v), headers=UA, timeout=timeout)
    r.raise_for_status()
    if not r.content.startswith(b"PK"):
        return None                                   # sin datos (el portal devuelve una página)
    z = zipfile.ZipFile(io.BytesIO(r.content))
    return z.read(z.namelist()[0]).decode("utf-8", errors="replace")


def actualizar(raiz, cods, desde, hasta, vars_=VARS, pausa=0.25, solo_faltantes=False, log=print):
    raiz = Path(raiz) / "saclim"
    ahora = datetime.now(timezone.utc).isoformat(timespec="seconds")
    n = fallas = 0
    cambios = []
    for cod in cods:
        for a in range(desde, hasta + 1):
            for v in vars_:
                f = raiz / str(cod) / str(a) / f"{v}.csv.gz"
                if solo_faltantes and (f.exists() or f.with_suffix(".vacio").exists()):
                    continue
                try:
                    txt = descargar(cod, a, v)
                except Exception as e:
                    fallas += 1; log(f"  falla {cod} {a} {v}: {e}"); time.sleep(2); continue
                n += 1
                f.parent.mkdir(parents=True, exist_ok=True)
                if txt is None:
                    f.with_suffix(".vacio").write_text("")
                    continue
                if f.exists():
                    viejo = gzip.decompress(f.read_bytes()).decode("utf-8")
                    if viejo != txt:
                        cambios += _diferencias(cod, v, viejo, txt, ahora)
                f.write_bytes(gzip.compress(txt.encode("utf-8"), mtime=0))
                time.sleep(pausa)
        log(f"{cod}: listo")
    if cambios:
        with open(raiz / "cambios.jsonl", "a", encoding="utf-8") as fh:
            for c in cambios:
                fh.write(json.dumps(c, ensure_ascii=False) + "\n")
    return dict(archivos=n, cambios=len(cambios), fallas=fallas)


def _tabla(txt):
    D = pd.read_csv(io.StringIO(txt), sep=";", dtype=str)
    k = "Instante" if "Instante" in D else ("Fecha" if "Fecha" in D else D.columns[1])
    return D.set_index(k).drop(columns=[c for c in D.columns if c.lower().startswith("codigo")], errors="ignore")


def _diferencias(cod, v, viejo, nuevo, ahora):
    try:
        A, B = _tabla(viejo), _tabla(nuevo)
    except Exception:
        return []
    out = []
    for k in sorted(set(A.index) | set(B.index)):
        for c in B.columns:
            x = A.at[k, c] if k in A.index and c in A.columns else None
            y = B.at[k, c] if k in B.index else None
            if isinstance(x, pd.Series): x = x.iloc[0]
            if isinstance(y, pd.Series): y = y.iloc[0]
            if (x if pd.notna(x) else None) != (y if pd.notna(y) else None):
                out.append(dict(codigo=str(cod), var=c, fecha=str(k), antes=None if pd.isna(x) else x, ahora=None if pd.isna(y) else y, detectado=ahora))
    return out


# ------------------------------------------------------------------ lectura
def serie(raiz, cod):
    """DataFrame horario (UTC) con Ts, Td, HR, QFE, QFF, dd, ff, RRR6, Traza; y extremas diarias aparte."""
    d = Path(raiz) / "saclim" / str(cod)
    H, X = [], []
    for fa in sorted(d.glob("*")) if d.exists() else []:
        for f in fa.glob("*.csv.gz"):
            v = f.name.split(".")[0]
            try:
                T = _tabla(gzip.decompress(f.read_bytes()).decode("utf-8"))
            except Exception:
                continue
            if v in ("TMaxima", "TMinima"):
                T.index = pd.to_datetime(T.index, format="%d-%m-%Y", errors="coerce")
                T = T[T.index.notna()]
                col = [c for c in T.columns if c != "FechaHora"][0]
                X.append(pd.DataFrame({"var": col, "valor": pd.to_numeric(T[col], errors="coerce"), "hora": T.get("FechaHora")}, index=T.index))
            else:
                T.index = pd.to_datetime(T.index, errors="coerce")
                H.append(T[T.index.notna()].apply(pd.to_numeric, errors="coerce"))
    S = pd.concat(H, axis=1) if H else pd.DataFrame()
    if len(S):
        S = S.T.groupby(level=0).first().T if S.columns.duplicated().any() else S
        S = S[~S.index.duplicated()].sort_index()
    E = pd.concat(X) if X else pd.DataFrame(columns=["var", "valor", "hora"])
    return S, E


# ------------------------------------------------------------------ revisión (vectorizada)
def _es(T): return 6.112 * np.exp(17.62 * T / (243.12 + T))


def _variantes(x):
    s = f"{abs(x):.1f}"; ent, dec = s.split(".")
    out = {-x, x / 10, x * 10}
    if len(ent) >= 2:
        out.add(math.copysign(float(ent[:-2] + ent[-1] + ent[-2] + "." + dec), x))
        out.add(math.copysign(float(ent[:-1] + dec + "." + ent[-1]), x))
    return [round(v, 1) for v in out if v != x]


def revisar_estacion(cod, S, E):
    out = []
    add = lambda t, var, niv, regla, msg, val=None, prob=None: out.append(dict(fecha=str(t)[:16], var=var, nivel=niv, regla=regla, msg=msg,
                                                                               valor=None if val is None or pd.isna(val) else float(val), probable=prob))
    if S.empty:
        return out, {}
    ant = str(cod).startswith("95")
    mes, hora = S.index.month, S.index.hour
    for v in ("Ts", "Td", "HR", "QFE", "QFF", "ff", "RRR6"):
        if v not in S:
            continue
        x = S[v]
        lo, hi = RANGO[v]
        if ant and v in ("Ts", "Td"):
            lo = -60
        malo = x[(x < lo) | (x > hi)]
        # clima por mes y hora (mediana y rango intercuartil robustos)
        g = x.groupby([mes, hora])
        med, q1, q3, nn = g.transform("median"), g.transform(lambda s: s.quantile(.25)), g.transform(lambda s: s.quantile(.75)), g.transform("count")
        iqr = (q3 - q1).clip(lower={"Ts": 1.5, "Td": 1.5, "HR": 5, "QFE": 1.5, "QFF": 1.5, "ff": 3, "RRR6": 1}[v])
        z = (x - med) / iqr
        ok_cl = nn >= 150
        vec = (x.shift(1) + x.shift(-1)) / 2           # referencia de las horas vecinas (sirve aunque haya pocos años)
        for t, val in malo.items():
            prob = [w for w in _variantes(val) if (ok_cl.get(t) and abs(w - med[t]) <= 1.5 * iqr[t]) or (pd.notna(vec.get(t)) and abs(w - vec[t]) <= {"Ts": 2, "Td": 2.5, "HR": 8, "QFE": 1, "QFF": 1, "ff": 5, "RRR6": 2}[v])]
            add(t, v, 2, "RANGO", f"{NOM[v]} {val:g} {UNI[v]} fuera del rango físico ({lo} a {hi})" + (f". Probable: {prob[0]:g} (digitación)" if prob else ""), val, prob[0] if prob else None)
        if v in ("RRR6", "ff"):
            pass
        else:
            sel = x[(z.abs() > 4) & ok_cl & ~x.index.isin(malo.index)]
            p, s = x.shift(1), x.shift(-1)
            for t, val in sel.items():
                prob = [w for w in _variantes(val) if abs(w - med[t]) <= 1.5 * iqr[t]]
                if prob:
                    add(t, v, 2, "DIG", f"{NOM[v]} {val:g} {UNI[v]} muy distinto de lo normal a esa hora ({med[t]:.1f} ± {iqr[t]:.1f}). Probable: {prob[0]:g} (signo, decimal o dígitos)", val, prob[0])
                else:
                    add(t, v, 2 if abs(z[t]) > 6 else 1, "CLIMA", f"{NOM[v]} {val:g} {UNI[v]} fuera de lo normal para {MESES[t.month - 1]} a las {t.hour:02d} UTC ({med[t]:.1f} ± {iqr[t]:.1f})", val)
            # pico: se aparta de la hora anterior y la siguiente en el mismo sentido
            lim = {"Ts": 5, "Td": 7, "HR": 30, "QFE": 2.5, "QFF": 3}[v]
            d1, d2 = x - p, x - s
            pk = x[(d1.abs() > lim) & (d2.abs() > lim) & (d1 * d2 > 0) & ~x.index.isin(sel.index) & ~x.index.isin(malo.index)
                   & (x.index.to_series().diff().dt.total_seconds().eq(3600)) & (x.index.to_series().diff(-1).dt.total_seconds().eq(-3600))]
            for t, val in pk.items():
                prob = [w for w in _variantes(val) if abs(w - (p[t] + s[t]) / 2) <= lim / 2]
                grande = min(abs(d1[t]), abs(d2[t])) > 3 * lim
                add(t, v, 2 if prob or grande else 1, "DIG" if prob else "PICO", f"{NOM[v]} {val:g} {UNI[v]} entre {p[t]:g} y {s[t]:g} en las horas vecinas"
                    + (f". Probable: {prob[0]:g} (signo, decimal o dígitos)" if prob else ""), val, prob[0] if prob else None)
        # pegado
        if v in ("Ts", "Td", "QFE", "QFF", "HR"):
            b = (x != x.shift()).cumsum()
            largo = x.groupby(b).transform("size")
            umbral = {"Ts": 8, "Td": 10, "HR": 12, "QFE": 8, "QFF": 8}[v]
            ini = x[(largo >= umbral) & (b != b.shift())].dropna()
            for t, val in ini.items():
                add(t, v, 1, "PEGADO", f"{NOM[v]} {val:g} {UNI[v]} sin cambiar durante {int(largo[t])} horas seguidas", val)
    # coherencia entre variables
    if {"Ts", "Td"} <= set(S):
        J = S[["Ts", "Td"] + (["HR"] if "HR" in S else [])].dropna()
        for t, r in J[J.Td > J.Ts + 0.1].iterrows():
            add(t, "Td", 2, "TDTS", f"Td {r.Td:g} °C mayor que Ts {r.Ts:g} °C", r.Td)
        if "HR" in J:
            hc = (100 * _es(J.Td) / _es(J.Ts)).clip(upper=100)
            mal = J[(J.HR - hc).abs() > 6]
            for t, r in mal.iterrows():
                add(t, "HR", 2 if abs(r.HR - hc[t]) > 15 else 1, "HRTD", f"HR {r.HR:g} % y con Ts {r.Ts:g} y Td {r.Td:g} corresponde {hc[t]:.0f} %", r.HR, round(float(hc[t])))
    for v in ("QFE", "QFF"):
        if v in S:
            x = S[v]; d = x.diff()
            ok = x.index.to_series().diff().dt.total_seconds().eq(3600)
            for t, dv in d[(d.abs() > 4) & ok].items():
                if not any(h["fecha"] == str(t)[:16] and h["var"] == v for h in out[-50:]):
                    add(t, v, 1, "SALTO", f"{v} cambió {dv:+.1f} hPa en una hora", x[t])
    # extremas frente a las Ts horarias del período
    if not E.empty and "Ts" in S:
        for t, r in E.iterrows():
            if pd.isna(r.valor):
                continue
            pm = str(r["var"]).endswith("PM")
            ini = t + pd.Timedelta(hours=12) if pm else t
            w = S["Ts"][(S.index >= ini) & (S.index <= ini + pd.Timedelta(hours=12))].dropna()
            if len(w) < 10:
                continue
            es_max = str(r["var"]).startswith("Tx")
            ref = w.max() if es_max else w.min()
            if (es_max and r.valor < ref - 0.3) or (not es_max and r.valor > ref + 0.3):
                add(t, str(r["var"]), 2, "EXTH", f"{r['var']} {r.valor:g} °C, pero una Ts horaria del período fue {ref:g} °C (la extrema debe ser al menos igual)", r.valor)
            elif abs(r.valor - ref) > 6:
                add(t, str(r["var"]), 1, "EXTH", f"{r['var']} {r.valor:g} °C y la Ts horaria más {'alta' if es_max else 'baja'} del período fue {ref:g} °C (diferencia {r.valor - ref:+.1f})", r.valor)
    # completitud por año y variable
    res = {}
    for a, Sa in S.groupby(S.index.year):
        esper = (min(pd.Timestamp(a, 12, 31, 23), pd.Timestamp.utcnow().tz_localize(None).floor("h")) - pd.Timestamp(a, 1, 1)).total_seconds() // 3600 + 1
        res[int(a)] = dict(esperadas=int(esper), **{v: int(Sa[v].notna().sum()) for v in ("Ts", "Td", "HR", "QFE", "QFF", "ff") if v in Sa})
    out.sort(key=lambda h: (h["fecha"], h["var"]))
    return out, res


def revisar_todo(raiz, cods, E_):
    raiz_p = Path(raiz) / "saclim" / "resultado"
    raiz_p.mkdir(parents=True, exist_ok=True)
    cambios = []
    cf = Path(raiz) / "saclim" / "cambios.jsonl"
    if cf.exists():
        cambios = [json.loads(l) for l in cf.read_text(encoding="utf-8").splitlines() if l.strip()]
    resumen = []
    for c in cods:
        S, E = serie(raiz, c)
        if S.empty:
            continue
        ant = {}
        fr = raiz_p / f"{c}.json"
        if fr.exists():
            try: ant = json.loads(fr.read_text())
            except Exception: pass
        hall, res = revisar_estacion(c, S, E)
        k = lambda h: (h["fecha"], h["var"], h["regla"])
        ks = {k(h) for h in hall}
        corr = list(ant.get("corregidos", []))
        mis = [x for x in cambios if x["codigo"] == c]
        for h in ant.get("hallazgos", []):
            if h["nivel"] > 0 and k(h) not in ks:
                cb = next((x for x in reversed(mis) if x["fecha"].startswith(h["fecha"][:16])), None)
                corr.append({**h, "antes": cb["antes"] if cb else h.get("valor"), "ahora": cb["ahora"] if cb else None,
                             "corregido": cb["detectado"] if cb else datetime.now(timezone.utc).isoformat(timespec="seconds")})
        e = E_.get(c, {})
        R = dict(codigo=c, nombre=e.get("nombre"), desde=str(S.index.min())[:10], hasta=str(S.index.max())[:10], anios=res,
                 hallazgos=hall[-6000:], total=len(hall), corregidos=corr[-300:], cambios=mis[-300:],
                 generado=datetime.now(timezone.utc).isoformat(timespec="seconds"))
        fr.write_text(json.dumps(R, ensure_ascii=False, separators=(",", ":"), default=str))
        cnt = lambda n: sum(1 for h in hall if h["nivel"] == n)
        tot = sum(r["esperadas"] for r in res.values()) or 1
        resumen.append(dict(codigo=c, nombre=e.get("nombre"), desde=R["desde"][:4], hasta=R["hasta"][:4], dudosos=cnt(2), revisar=cnt(1),
                            corregidos=len(corr), completitud=round(100 * sum(r.get("Ts", 0) for r in res.values()) / tot, 1),
                            reglas={r_: sum(1 for h in hall if h["regla"] == r_ and h["nivel"] > 0) for r_ in {h["regla"] for h in hall}}))
    resumen.sort(key=lambda r: -r["dudosos"])
    (raiz_p / "resumen.json").write_text(json.dumps(dict(generado=datetime.now(timezone.utc).isoformat(timespec="seconds"), estaciones=resumen), ensure_ascii=False))
    return resumen
