"""Control de calidad del Informe Climatológico Diario Nacional (boletín RE5008 del portal de climatología de la DMC).

Se lee el boletín del día (publicado desde las 10:00 hora local) y se compara, estación por estación, con:
  - la estación automática del mismo lugar (archivo minutario de METOTEC): mínima y máxima con su hora, agua caída 12–12 UTC;
  - lo que ingresó el observador en SACLIM (TnAM de las 12 UTC, TxPM de las 00 UTC y los cuatro RRR6);
  - el boletín de ayer (A la fecha = ayer + 24 horas) y sus propias cuentas (Déf/Sup).
Se repite cada 30 min entre las 10:00 y las 13:00: si el boletín cambia entre una pasada y otra, queda registrado.
Resultado: datos/boletin/AAAA/MM/DD.json y la clave «qc/boletin/AAAA-MM-DD» del KV.
"""
import gzip, json, re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import pandas as pd
import requests

URL = "https://climatologia.meteochile.gob.cl/application/diario/boletinClimatologicoDiario//{:%Y/%m/%d}"
COLS = ["tn", "tn_h", "tx", "tx_h", "rr24", "acum", "ant", "normal_f", "defsup", "normal_a"]

# estación del boletín → (código de la automática, código del observador en SACLIM, zona horaria)
CL, MAG, PAS = "America/Santiago", "America/Punta_Arenas", "Pacific/Easter"
ESTACIONES = {
    "chacalluta": ("180005", "180005", CL), "diego aracena": ("200006", "200006", CL), "el loa": ("220002", "220002", CL),
    "cerro moreno": ("230001", "230001", CL), "mataveri": ("270001", "270001", PAS), "desierto de atacama": ("270008", "270008", CL),
    "la florida": ("290004", "290004", CL), "punta angeles": (None, None, CL), "rodelillo": ("330007", "330007", CL),
    "eulogio sanchez": ("330019", "330019", CL), "quinta normal": ("330020", "330020", CL), "pudahuel": ("330021", "330021", CL),
    "santo domingo": ("330030", "330030", CL), "juan fernandez": ("330031", "330031", CL), "general freire": ("340031", "340031", CL),
    "bernardo o'higgins": ("360011", "360011", CL), "carriel sur": ("360019", "360019", CL), "maquehue": ("380013", None, CL),
    "pichoy": ("390006", "390006", CL), "canal bajo": (None, None, CL), "el tepual": ("410005", "410005", CL),
    "teniente vidal": ("450004", "450004", CL), "balmaceda": ("450005", "450005", CL), "carlos iba": ("520006", "520006", MAG),
    "guardiamarina": ("550001", "550001", MAG), "eduardo frei": ("950001", "950001", MAG),
}


def _sin_tildes(s):
    import unicodedata
    return unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode()


def _codigos(nombre):
    n = _sin_tildes(nombre)
    for k, v in ESTACIONES.items():
        if k in n:
            return v
    return (None, None, CL)


def _txt(s):
    s = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()
    if "Ã" in s or "Â" in s:
        try:
            s = s.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return s


def num(x):
    return float(x) if isinstance(x, str) and re.fullmatch(r"-?\d+(\.\d+)?", x) else (x if isinstance(x, (int, float)) else None)


def descargar(dia):
    r = requests.get(URL.format(dia), timeout=60)
    r.raise_for_status()
    html = r.content.decode("utf-8", "replace")
    if "bg-rotulo-tabla" not in html:
        return None
    tab = html[html.index("bg-rotulo-tabla"):]
    tab = tab[:tab.index("</table>")]
    filas = []
    for tr in re.findall(r"<tr>(.*?)</tr>", tab, re.S):
        td = [_txt(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(td) == 11:
            filas.append(dict(nombre=td[0], v=dict(zip(COLS, td[1:]))))
    m = re.search(r"<strong>\s*(\d+ de \w+ de \d{4})\s*</strong>", html)
    return dict(fecha_txt=m.group(1) if m else None, filas=filas) if filas else None


# ----------------------------------------------------------------------------------------------- datos de apoyo
def ema(raiz, desde, hasta):
    partes = []
    t = desde.floor("h")
    while t <= hasta:
        f = Path(raiz) / "ema" / t.strftime("%Y/%m/%d/%H.csv.gz")
        if f.exists():
            partes.append(pd.read_csv(f, parse_dates=["momento"], dtype={"codigo": str}, usecols=["codigo", "momento", "T", "rr1m"]))
        t += pd.Timedelta(hours=1)
    if not partes:
        return pd.DataFrame(columns=["codigo", "momento", "T", "rr1m"])
    A = pd.concat(partes, ignore_index=True).drop_duplicates(["codigo", "momento"])
    return A[(A["momento"] > desde) & (A["momento"] <= hasta)]


def observador(raiz, dia):
    out = {}
    for d in (dia - timedelta(days=1), dia):
        f = Path(raiz) / "sensorial" / f"{d:%Y/%m/%d}.json.gz"
        if f.exists():
            for cod, hs in json.loads(gzip.decompress(f.read_bytes())).items():
                for h, o in hs.items():
                    out.setdefault(cod, {})[pd.Timestamp(f"{d} {h}:00")] = o
    return out


def _v(o, el, comp=None):
    x = ((o or {}).get(el) or {}).get(comp or el)
    return x if isinstance(x, (int, float)) else None


# ----------------------------------------------------------------------------------------------- revisión
def revisar_dia(dia, bol, raiz, ayer=None):
    """bol: boletín de hoy (descargar). ayer: boletín (o resultado guardado) del día anterior. Devuelve el resultado."""
    t12 = pd.Timestamp(f"{dia} 12:00")
    A = ema(raiz, t12 - pd.Timedelta(hours=36), t12)
    OBS = observador(raiz, dia)
    prev = {f["nombre"]: f["v"] for f in (ayer or {}).get("filas", [])}
    filas, items = [], []
    for f in bol["filas"]:
        nom, v = f["nombre"], f["v"]
        ce, co, zona = _codigos(nom)
        Z = ZoneInfo(zona)
        loc = lambda t: t.tz_localize("UTC").tz_convert(Z).tz_localize(None)
        marcas = {}

        def marca(col, nivel, corto, msg, real=None):
            # siempre que se pueda, se dice qué valor debería ir (no solo que «está raro»)
            if real and real.get("valor") is not None:
                u = " mm" if col in ("rr24", "acum", "normal_f", "normal_a") else " %" if col == "defsup" else " °C"
                vtxt = f"{real['valor']:.1f}" if isinstance(real["valor"], (int, float)) else str(real["valor"])
                fuente = {"automática": "según la estación automática", "cálculo": "según el cálculo",
                          "observador": "según lo ingresado por el observador; sin minutario completo para confirmarlo"}[real["fuente"]]
                pre = "Probable" if real["fuente"] == "observador" else "Debería ir"
                if col.endswith("_h"):
                    corto = f"→ {real.get('hora')}"
                    msg += f" {pre}: {real.get('hora')} ({vtxt}{u}, {fuente})."
                else:
                    corto = f"→ {vtxt}" + (f" · {real['hora']}" if real.get("hora") else "")
                    msg += f" {pre}: {vtxt}{u}" + (f" a las {real['hora']}" if real.get("hora") else "") + f" ({fuente})."
            marcas[col] = dict(nivel=nivel, sub=corto, msg=msg, real=real)
            items.append(dict(estacion=nom, col=col, nivel=nivel, msg=msg, real=real))

        g = A[A["codigo"] == ce].sort_values("momento") if ce else A.iloc[0:0]
        o = OBS.get(co, {}) if co else {}
        tn, tx, rr = num(v["tn"]), num(v["tx"]), v["rr24"]
        realEMA = {}
        # ---- extremas frente a la automática
        for col, val, hora_txt, ini, fin, minimo, el_obs, h_obs in (
                ("tn", tn, v["tn_h"], t12 - pd.Timedelta(hours=12), t12, True, "TnAM", t12),
                ("tx", tx, v["tx_h"], t12 - pd.Timedelta(hours=24), t12 - pd.Timedelta(hours=12), False, "TxPM", t12 - pd.Timedelta(hours=12))):
            nombre = "mínima" if minimo else "máxima de ayer"
            w = g[(g["momento"] > ini) & (g["momento"] <= fin)].dropna(subset=["T"])
            # la máxima también se acepta en el día local completo de ayer (algunas estaciones la toman así)
            w2 = g[(g["momento"] > fin - pd.Timedelta(hours=27)) & (g["momento"] <= fin + pd.Timedelta(hours=3))].dropna(subset=["T"]) if not minimo else w
            paso = (w["momento"].diff().median() / pd.Timedelta(minutes=1)) if len(w) > 1 else 0
            if val is not None and len(w) * paso >= 0.8 * 720:
                i = w["T"].idxmin() if minimo else w["T"].idxmax()
                ref, tref = float(w.loc[i, "T"]), w.loc[i, "momento"]
                otros = [float(w2["T"].min() if minimo else w2["T"].max())]
                d = min(abs(val - ref), *[abs(val - x) for x in otros])
                real = dict(valor=ref, hora=f"{loc(tref):%H:%M}", fuente="automática")
                realEMA[col] = real
                if d > 0.5:
                    imposible = (val < ref - 0.5) if minimo else (val > max([ref] + otros) + 0.5)
                    marca(col, "err" if d > 1.0 or imposible else "warn", f"EMA {ref:.1f} · {loc(tref):%H:%M}",
                          f"{nombre.capitalize()} del boletín {val:.1f} °C a las {hora_txt}; la automática registró {ref:.1f} °C a las {loc(tref):%H:%M}"
                          + (" y nunca llegó a ese valor" if imposible else "") + ".", real)
                # hora: lo que marcaba la automática a la hora indicada
                if re.fullmatch(r"\d\d:\d\d", hora_txt or "") and col not in marcas:
                    hh, mm = map(int, hora_txt.split(":"))
                    cand = [pd.Timestamp(datetime.combine((loc(fin) - pd.Timedelta(days=k)).date(), datetime.min.time())) + pd.Timedelta(hours=hh, minutes=mm) for k in (0, 1)]
                    best = None
                    for c in cand:
                        cu = pd.Timestamp(c).tz_localize(Z).tz_convert("UTC").tz_localize(None)
                        cerca = w2[(w2["momento"] - cu).abs() <= pd.Timedelta(minutes=3)]
                        if len(cerca):
                            x = float(cerca["T"].iloc[(cerca["momento"] - cu).abs().argmin()])
                            if best is None or abs(x - val) < abs(best - val):
                                best = x
                    if best is not None and abs(best - val) > 1.0:
                        marca(col + "_h", "warn", f"EMA {ref:.1f} · {loc(tref):%H:%M}",
                              f"Hora de la {nombre} {hora_txt}: a esa hora la automática marcaba {best:.1f} °C; su {('mínimo' if minimo else 'máximo')} ({ref:.1f} °C) fue a las {loc(tref):%H:%M}.", real)
            # frente al observador
            ob = o.get(h_obs)
            x, fh = _v(ob, el_obs), ((ob or {}).get(el_obs) or {}).get("FechaHora")
            if val is not None and x is not None and abs(x - val) > 0.05 and col not in marcas:
                re_ = realEMA.get(col) or dict(valor=x, hora=str(fh)[11:16] if fh else None, fuente="observador")
                marca(col, "warn", "", f"{nombre.capitalize()} del boletín {val:.1f} °C; el observador ingresó {x:.1f} °C"
                      + (f" a las {str(fh)[11:16]}" if fh else "") + f" ({el_obs}).", re_)
            if minimo is False and val is not None and re.fullmatch(r"\d\d:\d\d", hora_txt or "") and col + "_h" not in marcas:
                hh = int(hora_txt[:2])
                if zona != PAS and (hh < 10 or hh >= 21):
                    re_ = realEMA.get("tx")
                    if not re_ and x is not None and fh and str(fh)[11:16] != hora_txt:
                        re_ = dict(valor=x, hora=str(fh)[11:16], fuente="observador")
                    marca("tx_h", "warn", "hora rara", f"Máxima de ayer a las {hora_txt}: es rara una máxima a esa hora."
                          + ("" if re_ else " No hay minutario completo ni otra hora del observador para decir cuál fue la hora real."), re_)
        # ---- agua caída 24 h
        r24 = 0.0 if rr == "S/P" else num(rr)
        if r24 is not None and len(g):
            w = g[(g["momento"] > t12 - pd.Timedelta(hours=24)) & (g["momento"] <= t12)]
            n = w["rr1m"].notna().sum()
            paso = (w["momento"].diff().median() / pd.Timedelta(minutes=1)) if len(w) > 1 else 1
            if n * paso >= 0.9 * 1440:
                s = round(float(w["rr1m"].sum()), 1)
                d = round(abs(s - r24), 1)
                if d >= 0.2:
                    nivel = "err" if d > max(1.0, 0.3 * max(s, r24)) else "warn"
                    marca("rr24", nivel, f"EMA {s:.1f} mm", f"Agua caída 24 h del boletín {rr}{'' if rr == 'S/P' else ' mm'}; el pluviómetro automático sumó {s:.1f} mm de 12 a 12 UTC.",
                          dict(valor=s, fuente="automática"))
        if r24 is not None and o:
            hs = [t12 - pd.Timedelta(hours=k) for k in (18, 12, 6, 0)]
            r6 = [_v(o.get(h), "RRR6") for h in hs]
            tz = any(_v(o.get(h), "RRR6", "Traza") == 1 for h in hs)
            if all(x is not None for x in r6):
                s = round(sum(r6), 1)
                if abs(s - r24) >= 0.1 and "rr24" not in marcas:
                    marca("rr24", "warn", "", f"Agua caída 24 h del boletín {rr}; la suma de los RRR6 del observador (18, 00, 06 y 12 UTC) es {s:.1f} mm"
                          + (" (con traza)" if tz else "") + ".", dict(valor=s, fuente="observador"))
        # ---- A la fecha, Déf/Sup y normales
        acum, nf, ds, na = num(v["acum"]), num(v["normal_f"]), num(v["defsup"]), num(v["normal_a"])
        p = prev.get(nom)
        if p and acum is not None and r24 is not None and not (dia.month == 1 and dia.day == 1):
            pa = num(p["acum"])
            if pa is not None and abs(pa + r24 - acum) > 0.05:
                marca("acum", "err", f"esperado {pa + r24:.1f}", f"A la fecha {acum:.1f} mm; ayer era {pa:.1f} mm y las 24 h son {rr}: debería ser {pa + r24:.1f} mm.",
                      dict(valor=round(pa + r24, 1), fuente="cálculo"))
        if acum is not None and nf and ds is not None:
            calc = round((acum / nf - 1) * 100, 1)
            if abs(calc - ds) > 0.2:
                marca("defsup", "warn", f"calc. {calc:.1f}", f"Déf/Sup {ds:.1f} %; con A la fecha {acum:.1f} y Normal a la fecha {nf:.1f} da {calc:.1f} %.", dict(valor=calc, fuente="cálculo"))
        if p:
            pn, pnf = num(p["normal_a"]), num(p["normal_f"])
            if na is not None and pn is not None and abs(na - pn) > 0.05:
                marca("normal_a", "info", f"ayer {pn:.1f}", f"La normal anual cambió de {pn:.1f} a {na:.1f} mm.")
            if nf is not None and pnf is not None and nf < pnf - 0.05 and not (dia.month == 1 and dia.day == 1):
                marca("normal_f", "warn", f"ayer {pnf:.1f}", f"La normal a la fecha bajó de {pnf:.1f} a {nf:.1f} mm: debería subir o mantenerse.")
        for col in COLS:
            if v[col] in (".", "-") and col not in marcas and col not in ("ant",):
                marcas[col] = dict(nivel="info", sub="sin dato" if v[col] == "." else "no actualizado", msg=None, real=None)
        filas.append(dict(nombre=nom, ema=ce, obs=co, v=v, marcas=marcas))
    return dict(dia=str(dia), fecha_txt=bol.get("fecha_txt"), filas=filas, items=items)


def correr(raiz, ahora=None, forzar=False, subir=None):
    """Entre las 10:00 y las 13:00 hora local revisa el boletín del día y guarda el resultado (con los cambios entre pasadas)."""
    ahora = ahora or datetime.now(timezone.utc)
    local = ahora.astimezone(ZoneInfo(CL))
    if not forzar and not (10 <= local.hour < 13):
        return "fuera de horario"
    dia = local.date()
    bol = descargar(dia)
    if not bol:
        return "boletín no disponible"
    f = Path(raiz) / "boletin" / f"{dia:%Y/%m/%d}.json"
    fa = Path(raiz) / "boletin" / f"{dia - timedelta(days=1):%Y/%m/%d}.json"
    ayer = json.loads(fa.read_text()) if fa.exists() else None
    if ayer is None:
        try:
            ayer = descargar(dia - timedelta(days=1))
        except Exception:
            ayer = None
    res = revisar_dia(dia, bol, raiz, ayer)
    previo = json.loads(f.read_text()) if f.exists() else None
    cambios = (previo or {}).get("cambios", [])
    if previo:
        pv = {x["nombre"]: x["v"] for x in previo["filas"]}
        for x in res["filas"]:
            for c in COLS:
                a, b = (pv.get(x["nombre"]) or {}).get(c), x["v"][c]
                if a is not None and a != b:
                    cambios.append(dict(hora=f"{local:%H:%M}", estacion=x["nombre"], col=c, antes=a, ahora=b))
    res["cambios"] = cambios
    res["pasadas"] = (previo or {}).get("pasadas", []) + [f"{local:%H:%M}"]
    res["revisado"] = ahora.isoformat(timespec="seconds")
    f.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(res, ensure_ascii=False)
    f.write_text(txt, encoding="utf-8")
    kv = subir(f"qc/boletin/{dia}", txt) if subir else None
    return dict(dia=str(dia), estaciones=len(res["filas"]), hallazgos=len(res["items"]), cambios=len(cambios), kv=kv)
