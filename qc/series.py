"""Control de series históricas de temperatura máxima y mínima diaria (anuarios públicos del portal de climatología).

Descarga  …/anual/temperaturaMaximaAnual/{cod}/{año}  y  …/temperaturaMinimaAnual/{cod}/{año}  (tabla día × mes),
las guarda en la rama de datos (series/{var}/{cod}/{año}.json), registra los valores que cambian entre descargas
(series/cambios.jsonl: antes → ahora) y revisa cada estación:
  RANGO   fuera del rango físico                         (dudoso)
  TNTX    mínima mayor que la máxima del mismo día        (dudoso)
  IGUAL   mínima igual a la máxima                        (revisar)
  CLIMA   fuera de lo normal de la estación para el mes   (revisar / dudoso; informativo si las vecinas también)
  PICO    se aparta del día anterior y del siguiente      (revisar / dudoso)
  REPE    mismo valor 4 días o más seguidos               (revisar)
  ENTEROS mes con casi todos los valores en .0            (informativo)
  HUECO   mes sin datos o con muchos días sin dato        (informativo)
Para los valores dudosos se busca una variante de digitación (signo, decimal corrido, dígitos invertidos) que sí calce."""
import html, json, math, re, sys, time
from datetime import date, datetime, timezone
from pathlib import Path
import numpy as np, pandas as pd, requests
NOMBRES = {"950001": "C.M.A. Eduardo Frei Montalva, Antártica", "950002": "Arturo Prat, Base Antártica", "950003": "Bernardo O'Higgins, Base Antártica",
           "330031": "Juan Fernández, Estación Meteorológica", "380013": "Maquehue, Temuco Ad."}

URL = "https://climatologia.meteochile.gob.cl/application/anual/{p}/{cod}/{a}"
PAG = {"tx": "temperaturaMaximaAnual", "tn": "temperaturaMinimaAnual"}
NOMV = {"tx": "máxima", "tn": "mínima"}
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
RANGO = {"tx": (-20, 46), "tn": (-35, 32)}
RANGO_ANT = {"tx": (-45, 22), "tn": (-55, 15)}      # Antártica (95xxxx)
UA = {"User-Agent": "METOTEC control de calidad de series (DMC)"}


# ------------------------------------------------------------------ descarga y lectura
def leer_html(t):
    """Tabla día × mes → {'AAAA-MM-DD'… no: {(mes, dia): valor}} como dict 'MM-DD' → float. '.' = sin dato."""
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S | re.I)
    for tabla in re.findall(r"<table.*?</table>", t, flags=re.S | re.I):
        txt = html.unescape(re.sub(r"<[^>]+>", " ", tabla)).lower()
        if "enero" not in txt or "diciembre" not in txt:
            continue
        out = {}
        for fila in re.findall(r"<tr.*?</tr>", tabla, flags=re.S | re.I):
            c = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", x))).strip() for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", fila, flags=re.S | re.I)]
            if len(c) < 13 or not re.fullmatch(r"\d{1,2}", c[0]) or not 1 <= int(c[0]) <= 31:
                continue
            d = int(c[0])
            for m in range(12):
                x = c[1 + m].replace(",", ".")
                if re.fullmatch(r"-?\d+(\.\d+)?", x):
                    out[f"{m + 1:02d}-{d:02d}"] = float(x)
        if out:
            return out
    return {}


def descargar(cod, var, a, timeout=60):
    r = requests.get(URL.format(p=PAG[var], cod=cod, a=a), timeout=timeout, headers=UA)
    r.raise_for_status()
    return leer_html(r.text)


def actualizar(raiz, cods, desde, hasta, vars_=("tx", "tn"), pausa=0.3, log=print, solo_faltantes=False):
    """Baja (o vuelve a bajar) los años pedidos y registra los cambios. Devuelve n.º de páginas y de cambios."""
    raiz = Path(raiz) / "series"
    ahora = datetime.now(timezone.utc).isoformat(timespec="seconds")
    n = nc = fallas = 0
    cambios = []
    for cod in cods:
        for var in vars_:
            for a in range(desde, hasta + 1):
                f = raiz / var / str(cod) / f"{a}.json"
                if solo_faltantes and f.exists():
                    continue
                try:
                    nuevo = descargar(cod, var, a)
                except Exception as e:
                    fallas += 1; log(f"  falla {cod} {var} {a}: {e}"); continue
                n += 1
                prev = json.loads(f.read_text()) if f.exists() else None
                if prev is not None:
                    for k in sorted(set(prev) | set(nuevo)):
                        if prev.get(k) != nuevo.get(k):
                            cambios.append(dict(codigo=str(cod), var=var, fecha=f"{a}-{k}", antes=prev.get(k), ahora=nuevo.get(k), detectado=ahora))
                if nuevo or prev is None:
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_text(json.dumps(nuevo, sort_keys=True, separators=(",", ":")))
                time.sleep(pausa)
            log(f"{cod} {var}: listo")
    if cambios:
        with open(raiz / "cambios.jsonl", "a", encoding="utf-8") as fh:
            for c in cambios:
                fh.write(json.dumps(c, ensure_ascii=False) + "\n")
        nc = len(cambios)
    return dict(paginas=n, cambios=nc, fallas=fallas)


def serie(raiz, cod):
    """DataFrame diario (fecha, tx, tn) de una estación con todo lo guardado."""
    raiz = Path(raiz) / "series"
    filas = {}
    for var in ("tx", "tn"):
        d = raiz / var / str(cod)
        if not d.exists():
            continue
        for f in sorted(d.glob("*.json")):
            a = int(f.stem)
            for k, x in json.loads(f.read_text()).items():
                try:
                    filas.setdefault(pd.Timestamp(f"{a}-{k}"), {})[var] = x
                except ValueError:
                    pass
    if not filas:
        return pd.DataFrame(columns=["tx", "tn"])
    S = pd.DataFrame.from_dict(filas, orient="index").sort_index()
    for v_ in ("tx", "tn"):
        if v_ not in S:
            S[v_] = np.nan
    return S[["tx", "tn"]]


# ------------------------------------------------------------------ revisión
def _variantes(x):
    out = {-x}
    s = f"{abs(x):.1f}"
    out |= {x / 10, x * 10}
    ent, dec = s.split(".")
    if len(ent) == 2:
        out.add(math.copysign(float(ent[::-1] + "." + dec), x))
        out.add(math.copysign(float(ent[0] + dec + "." + ent[1]), x))
    return {round(v, 1) for v in out if v != x}


def clima(S):
    """Mediana y rango intercuartil por variable y mes (solo meses con ≥ 8 años de datos)."""
    C = {}
    for v_ in ("tx", "tn"):
        g = S[v_].dropna()
        for m, x in g.groupby(g.index.month):
            if x.index.year.nunique() >= 8 and len(x) >= 150:
                q1, q2, q3 = np.percentile(x, [25, 50, 75])
                C[(v_, m)] = (q2, max(q3 - q1, 1.5))
    return C


def revisar_estacion(cod, S, vecinas=None, E=None):
    """S: serie(…). vecinas: {cod: (S_vecina, clima_vecina)}. Devuelve (hallazgos, resumen por año)."""
    out = []
    ant = str(cod).startswith("95")
    C = clima(S)
    add = lambda f, v_, niv, regla, msg, val=None, prob=None: out.append(dict(fecha=f"{f:%Y-%m-%d}", var=v_, nivel=niv, regla=regla, msg=msg,
                                                                             valor=val, probable=prob))
    for v_ in ("tx", "tn"):
        lo, hi = (RANGO_ANT if ant else RANGO)[v_]
        x = S[v_]
        prev, sig = x.shift(1), x.shift(-1)
        for f, val in x.dropna().items():
            m = f.month
            cl = C.get((v_, m))
            prob = None
            if cl:
                med, iqr = cl
                cand = [w for w in _variantes(val) if abs(w - med) <= 1.5 * iqr]
                prob = min(cand, key=lambda w: abs(w - med)) if cand else None
            if not lo <= val <= hi:
                add(f, v_, 2, "RANGO", f"{NOMV[v_]} {val:g} °C fuera del rango físico ({lo} a {hi} °C)" + (f". Probable: {prob:g} °C (error de digitación)" if prob is not None else ""), val, prob)
                continue
            if cl:
                med, iqr = cl
                z = (val - med) / iqr
                if abs(z) > (4 if ant else 3):
                    niv = 2 if abs(z) > (6 if ant else 5) else 1
                    conf = _vecinas_confirman(f, v_, z, vecinas)
                    txt = (f"{NOMV[v_]} {val:g} °C muy {'alta' if z > 0 else 'baja'} para {MESES[m - 1]} en esta estación "
                           f"(lo normal: {med:.1f} °C ± {iqr:.1f}; se aparta {abs(z):.1f} veces el rango intercuartil)")
                    if conf:
                        add(f, v_, 0, "CLIMA", txt + f". Las vecinas también tuvieron un día extremo ({conf}): probablemente real", val)
                    else:
                        add(f, v_, niv, "CLIMA", txt + (". Las vecinas no muestran lo mismo" if conf is not None else "")
                            + (f". Probable: {prob:g} °C (error de digitación)" if prob is not None else ""), val, prob)
                    continue
            p, s = prev.get(f), sig.get(f)
            if pd.notna(p) and pd.notna(s) and cl:
                iqr = cl[1]
                d1, d2 = val - p, val - s
                lim = max(8.0, 4 * iqr)
                if abs(d1) > lim and abs(d2) > lim and d1 * d2 > 0:
                    conf = _vecinas_confirman(f, v_, d1 / iqr, vecinas)
                    if not conf:
                        add(f, v_, 2 if min(abs(d1), abs(d2)) > 1.5 * lim else 1, "PICO",
                            f"{NOMV[v_]} {val:g} °C entre {p:g} °C el día anterior y {s:g} °C el siguiente (salto de {d1:+.1f} y vuelve)"
                            + (f". Probable: {prob:g} °C" if prob is not None else ""), val, prob)
        # valores repetidos
        g = (x != x.shift()).cumsum()
        for _, bloque in x.dropna().groupby(g[x.notna()]):
            if len(bloque) >= 4 and (bloque.index[-1] - bloque.index[0]).days == len(bloque) - 1:
                add(bloque.index[0], v_, 1, "REPE", f"{NOMV[v_]} {bloque.iloc[0]:g} °C repetida {len(bloque)} días seguidos "
                    f"({bloque.index[0]:%d-%m} al {bloque.index[-1]:%d-%m-%Y})", bloque.iloc[0])
        # meses con casi todo en .0
        for (a, m), xm in x.dropna().groupby([x.dropna().index.year, x.dropna().index.month]):
            if len(xm) >= 15 and (xm == xm.round()).mean() >= 0.7:
                add(pd.Timestamp(a, m, 1), v_, 0, "ENTEROS", f"{NOMV[v_]} de {MESES[m - 1]} {a}: {int((xm == xm.round()).sum())} de {len(xm)} días con valor entero "
                    "(posible redondeo o dato estimado)")
    # mínima vs máxima
    J = S.dropna()
    for f, r in J[J.tn > J.tx].iterrows():
        add(f, "tn", 2, "TNTX", f"mínima {r.tn:g} °C mayor que la máxima {r.tx:g} °C del mismo día (¿columnas o días cruzados?)", r.tn)
    for f, r in J[J.tn == J.tx].iterrows():
        add(f, "tn", 1, "IGUAL", f"mínima igual a la máxima ({r.tn:g} °C)", r.tn)
    # completitud
    res = {}
    if len(S):
        for a in range(S.index.year.min(), S.index.year.max() + 1):
            dias = 366 if a % 4 == 0 and (a % 100 or a % 400 == 0) else 365
            Sa = S[S.index.year == a]
            fin = min(date(a, 12, 31), date.today())
            esper = (fin - date(a, 1, 1)).days + 1 if a <= date.today().year else dias
            res[a] = dict(tx=int(Sa.tx.notna().sum()), tn=int(Sa.tn.notna().sum()), esperados=esper)
            for v_ in ("tx", "tn"):
                for m in range(1, 13):
                    if date(a, m, 1) > date.today():
                        break
                    nm = int(Sa[v_][Sa.index.month == m].notna().sum())
                    if nm == 0 and res[a][v_] > 0:
                        add(pd.Timestamp(a, m, 1), v_, 0, "HUECO", f"{NOMV[v_]}: {MESES[m - 1]} {a} sin ningún dato")
    out.sort(key=lambda h: (h["fecha"], h["var"]))
    return out, res


def _vecinas_confirman(f, v_, z, vecinas):
    """Nombres de vecinas con anomalía del mismo signo y al menos la mitad de grande ese día; None si no hay vecinas con dato."""
    if not vecinas:
        return None
    hay, si = False, []
    for cod, (Sv, Cv, nom) in vecinas.items():
        if f not in Sv.index or pd.isna(Sv.at[f, v_]) or (v_, f.month) not in Cv:
            continue
        hay = True
        med, iqr = Cv[(v_, f.month)]
        zv = (Sv.at[f, v_] - med) / iqr
        if zv * z > 0 and abs(zv) >= abs(z) / 2:
            si.append(nom)
    return ", ".join(si[:3]) if si else ("" if hay else None)


def dist_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def revisar_todo(raiz, cods, E):
    """Revisa todas las estaciones guardadas. E: {cod: {nombre, lat, lon, alt}}. Escribe series/resultado/{cod}.json y resumen.json."""
    raiz_p = Path(raiz) / "series"
    S_ = {c: serie(raiz, c) for c in cods}
    C_ = {c: clima(S) for c, S in S_.items()}
    ant = {}
    for f in (raiz_p / "resultado").glob("*.json") if (raiz_p / "resultado").exists() else []:
        try:
            ant[f.stem] = json.loads(f.read_text())
        except Exception:
            pass
    cambios = []
    if (raiz_p / "cambios.jsonl").exists():
        cambios = [json.loads(l) for l in (raiz_p / "cambios.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    resumen = []
    (raiz_p / "resultado").mkdir(parents=True, exist_ok=True)
    for c in cods:
        S = S_[c]
        if S.empty:
            continue
        e = E.get(c) or {"nombre": NOMBRES.get(c)}
        vec = {}
        if e.get("lat") is not None:
            cand = sorted(((dist_km(e, E[o]), o) for o in cods if o != c and o in E and E[o].get("lat") is not None
                           and abs((E[o].get("alt") or 0) - (e.get("alt") or 0)) <= 600), key=lambda x: x[0])
            vec = {o: (S_[o], C_[o], E[o].get("nombre", o)) for d, o in cand if d <= 200 and not S_[o].empty}
            vec = dict(list(vec.items())[:5])
        hall, res = revisar_estacion(c, S, vec, E)
        # alertas que estaban antes y ya no: corregidas (con el valor anterior y el nuevo si hubo cambio)
        clave = lambda h: (h["fecha"], h["var"], h["regla"])
        ahora_k = {clave(h) for h in hall}
        corr = list((ant.get(c) or {}).get("corregidos", []))
        mis_c = [x for x in cambios if x["codigo"] == c]
        for h in (ant.get(c) or {}).get("hallazgos", []):
            if h["nivel"] > 0 and clave(h) not in ahora_k:
                cb = next((x for x in reversed(mis_c) if x["fecha"] == h["fecha"] and x["var"] == h["var"]), None)
                corr.append({**h, "antes": cb["antes"] if cb else h.get("valor"), "ahora": cb["ahora"] if cb else None,
                             "corregido": cb["detectado"] if cb else datetime.now(timezone.utc).isoformat(timespec="seconds")})
        R = dict(codigo=c, nombre=e.get("nombre"), desde=str(S.index.min().date()), hasta=str(S.index.max().date()),
                 vecinas=[v[2] for v in vec.values()], anios=res, hallazgos=hall, corregidos=corr[-300:],
                 cambios=mis_c[-300:], generado=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 datos={v_: {f"{k:%Y-%m-%d}": x for k, x in S[v_].dropna().items()} for v_ in ("tx", "tn")})
        (raiz_p / "resultado" / f"{c}.json").write_text(json.dumps(R, ensure_ascii=False, separators=(",", ":"), default=str))
        cnt = lambda n: sum(1 for h in hall if h["nivel"] == n)
        tot = sum(r["esperados"] * 2 for r in res.values()) or 1
        resumen.append(dict(codigo=c, nombre=e.get("nombre"), desde=R["desde"][:4], hasta=R["hasta"][:4], dudosos=cnt(2), revisar=cnt(1),
                            info=cnt(0), corregidos=len(corr), completitud=round(100 * sum(r["tx"] + r["tn"] for r in res.values()) / tot, 1),
                            reglas={k: sum(1 for h in hall if h["regla"] == k and h["nivel"] > 0) for k in {h["regla"] for h in hall}}))
    resumen.sort(key=lambda r: -r["dudosos"])
    (raiz_p / "resultado" / "resumen.json").write_text(json.dumps(dict(generado=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                                                     estaciones=resumen), ensure_ascii=False))
    return resumen
