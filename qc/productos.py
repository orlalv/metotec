"""Productos públicos (punto 33): extremas del día de la red automática y precipitación de las estaciones con observador.

  - extremas_dia: máxima, mínima, racha máxima y lluvia del día local (hora de Santiago, 00:00 hasta ahora) de cada estación,
    con su hora local y un ranking. El día anterior se guarda una vez completo.
  - lluvia_observador: lluvia del último periodo sinóptico (12 a 12 UTC): los cuatro RRR6 del observador (18, 00, 06 y 12 UTC),
    su suma, lo que sumó el pluviómetro automático y lo que dice el boletín climatológico.
Salida: datos/productos/extremas.json y lluvia_obs.json (más una copia por día) y las claves «pub/extremas» y «pub/lluvia_obs» del KV.
Las estaciones con una falla activa del sensor (episodios) no entran en el ranking de esa variable.
"""
import gzip, json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import pandas as pd

CL = ZoneInfo("America/Santiago")
RANGO = {"T": (-60, 50), "fx10": (0, 150)}          # rango físico: fuera de él, el dato no entra al ranking
SENSOR_VAR = {"T": "termohigrómetro", "fx10": "anemómetro", "rr1m": "pluviómetro"}
TOP = 10
COBERTURA = 0.8                                      # fracción mínima del tiempo transcurrido con dato


def _catalogo(raiz):
    f = Path(raiz) / "estaciones.json"
    try:
        return {str(e["codigo"]): e for e in json.loads(f.read_text(encoding="utf-8"))}
    except Exception:
        return {}


def _nombre(cat, cod):
    return (cat.get(cod) or {}).get("nombre") or cod


def _leer_ema(raiz, desde, hasta):
    """Datos minutarios (UTC, sin zona) con desde < momento ≤ hasta."""
    partes, t = [], desde.floor("h")
    while t <= hasta:
        f = Path(raiz) / "ema" / t.strftime("%Y/%m/%d/%H.csv.gz")
        if f.exists():
            partes.append(pd.read_csv(f, parse_dates=["momento"], dtype={"codigo": str}, usecols=["codigo", "momento", "T", "fx10", "rr1m"]))
        t += pd.Timedelta(hours=1)
    if not partes:
        return pd.DataFrame(columns=["codigo", "momento", "T", "fx10", "rr1m"])
    A = pd.concat(partes, ignore_index=True).drop_duplicates(["codigo", "momento"])
    return A[(A["momento"] > desde) & (A["momento"] <= hasta)]


def _fallas(raiz, desde, hasta):
    """{(código, variable)} con una falla de sensor que toca el periodo."""
    f = Path(raiz) / "hallazgos" / "episodios.json"
    out = set()
    try:
        ep = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return out
    d0, d1 = desde.strftime("%Y-%m-%d %H:%M"), hasta.strftime("%Y-%m-%d %H:%M")
    for e in ep.values():
        ini, fin = e.get("inicio") or "", e.get("fin") or e.get("visto") or "9999"
        if ini <= d1 and fin >= d0:
            for v, s in SENSOR_VAR.items():
                if s == e.get("sensor"):
                    out.add((str(e["codigo"]), v))
    return out


def _cobertura(g, minutos):
    """Minutos con dato (mediana del paso × cantidad) frente a los minutos transcurridos."""
    if len(g) < 2 or minutos <= 0:
        return 0.0
    paso = g["momento"].sort_values().diff().dt.total_seconds().median() / 60
    return min(1.0, len(g) * max(paso, 1) / minutos)


def _loc(t):
    return t.tz_localize("UTC").tz_convert(CL)


def _dia(raiz, dia, ahora_utc, cat):
    """Extremas del día local `dia` (date) hasta `ahora_utc` (Timestamp sin zona). completo=True si el día ya terminó."""
    ini = pd.Timestamp(datetime.combine(dia, datetime.min.time()), tz=CL).tz_convert("UTC").tz_localize(None)
    fin_dia = pd.Timestamp(datetime.combine(dia + timedelta(days=1), datetime.min.time()), tz=CL).tz_convert("UTC").tz_localize(None)
    fin = min(fin_dia, ahora_utc)
    A = _leer_ema(raiz, ini, fin)
    minutos = (fin - ini).total_seconds() / 60
    fall = _fallas(raiz, ini, fin)
    filas = []
    for cod, g in A.groupby("codigo"):
        r = dict(cod=cod, nombre=_nombre(cat, cod), alt=(cat.get(cod) or {}).get("alt"))
        t = g.dropna(subset=["T"])
        t = t[(t["T"] >= RANGO["T"][0]) & (t["T"] <= RANGO["T"][1])].sort_values("momento")
        if len(t) >= 7:      # quita picos sueltos: valores a más de 3 °C de la mediana de sus 7 vecinos
            t = t[(t["T"] - t["T"].rolling(7, center=True, min_periods=3).median()).abs() <= 3]
        if (cod, "T") not in fall and _cobertura(t, minutos) >= COBERTURA:
            i, j = t["T"].idxmax(), t["T"].idxmin()
            r.update(tx=round(float(t.loc[i, "T"]), 1), tx_h=f"{_loc(t.loc[i, 'momento']):%H:%M}",
                     tn=round(float(t.loc[j, "T"]), 1), tn_h=f"{_loc(t.loc[j, 'momento']):%H:%M}")
        w = g.dropna(subset=["fx10"])
        w = w[(w["fx10"] >= RANGO["fx10"][0]) & (w["fx10"] <= RANGO["fx10"][1])]
        if (cod, "fx10") not in fall and len(w):      # la racha se informa solo en los minutos en que ocurre: no se exige cobertura
            i = w["fx10"].idxmax()
            r.update(fx=round(float(w.loc[i, "fx10"]), 1), fx_h=f"{_loc(w.loc[i, 'momento']):%H:%M}")
        p = g.dropna(subset=["rr1m"])
        if (cod, "rr1m") not in fall and _cobertura(p, minutos) >= 0.9:
            r["rr"] = round(float(p["rr1m"].clip(lower=0).sum()), 1)
        filas.append(r)

    def rank(col, rev, hora=None, minimo=None):
        L = [x for x in filas if x.get(col) is not None and (minimo is None or x[col] >= minimo)]
        L.sort(key=lambda x: (-x[col] if rev else x[col], x["nombre"]))
        return [dict(cod=x["cod"], nombre=x["nombre"], alt=x["alt"], valor=x[col], hora=x.get(hora) if hora else None) for x in L[:TOP]]

    return dict(dia=str(dia), completo=bool(ahora_utc >= fin_dia), hasta=f"{_loc(fin):%H:%M}", estaciones=len(filas),
                con_T=sum(1 for x in filas if "tx" in x), excluidas=sorted({c for c, _ in fall}),
                tx=rank("tx", True, "tx_h"), tn=rank("tn", False, "tn_h"), racha=rank("fx", True, "fx_h"), lluvia=rank("rr", True, minimo=0.1),
                con_lluvia=sum(1 for x in filas if (x.get("rr") or 0) >= 0.1))


def extremas_dia(raiz, ahora=None):
    ahora = ahora or datetime.now(timezone.utc)
    cat = _catalogo(raiz)
    ahora_utc = pd.Timestamp(ahora.astimezone(timezone.utc).replace(tzinfo=None))
    hoy = ahora.astimezone(CL).date()
    base = Path(raiz) / "productos" / "extremas"
    ayer_f = base / f"{hoy - timedelta(days=1):%Y/%m/%d}.json"
    ayer = None
    if ayer_f.exists():
        try:
            ayer = json.loads(ayer_f.read_text(encoding="utf-8"))
        except Exception:
            ayer = None
    if not ayer or not ayer.get("completo"):
        ayer = _dia(raiz, hoy - timedelta(days=1), ahora_utc, cat)
        if ayer["estaciones"]:
            ayer_f.parent.mkdir(parents=True, exist_ok=True)
            ayer_f.write_text(json.dumps(ayer, ensure_ascii=False), encoding="utf-8")
    res = dict(generado=ahora.isoformat(timespec="seconds"), hoy=_dia(raiz, hoy, ahora_utc, cat), ayer=ayer if ayer["estaciones"] else None)
    return res


# ----------------------------------------------------------------------------------------------- lluvia con observador
def _v(o, el, comp=None):
    x = ((o or {}).get(el) or {}).get(comp or el)
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def lluvia_observador(raiz, ahora=None):
    ahora = ahora or datetime.now(timezone.utc)
    ahora_utc = pd.Timestamp(ahora.astimezone(timezone.utc).replace(tzinfo=None))
    fin = ahora_utc.floor("D") + pd.Timedelta(hours=12)
    if fin > ahora_utc - pd.Timedelta(minutes=30):     # la observación de las 12 UTC llega unos minutos después
        fin -= pd.Timedelta(days=1)
    ini = fin - pd.Timedelta(hours=24)
    horas = [fin - pd.Timedelta(hours=k) for k in (18, 12, 6, 0)]      # 18, 00, 06 y 12 UTC
    cat = _catalogo(raiz)
    OBS = {}
    for d in sorted({h.date() for h in horas}):
        f = Path(raiz) / "sensorial" / f"{d:%Y/%m/%d}.json.gz"
        if f.exists():
            for cod, hs in json.loads(gzip.decompress(f.read_bytes())).items():
                for h, o in hs.items():
                    OBS.setdefault(cod, {})[pd.Timestamp(f"{d} {h}:00")] = o
    A = _leer_ema(raiz, ini, fin)
    fall = _fallas(raiz, ini, fin)
    bol = {}      # boletín del día local de «fin» (publicado desde las 10:00 hora local; su agua caída es de 12 a 12 UTC)
    f = Path(raiz) / "boletin" / f"{_loc(fin + pd.Timedelta(hours=1)).date():%Y/%m/%d}.json"
    if f.exists():
        try:
            for x in json.loads(f.read_text(encoding="utf-8")).get("filas", []):
                if x.get("obs"):
                    bol[x["obs"]] = x["v"].get("rr24")
        except Exception:
            pass
    filas = []
    for cod, hs in OBS.items():
        r6 = [_v(hs.get(h), "RRR6") for h in horas]
        traza = [_v(hs.get(h), "RRR6", "Traza") == 1 for h in horas]
        if all(x is None for x in r6):
            continue
        completo = all(x is not None for x in r6)
        tot = round(sum(x or 0 for x in r6), 1)
        g = A[A["codigo"] == cod].dropna(subset=["rr1m"])
        ema = round(float(g["rr1m"].clip(lower=0).sum()), 1) if (cod, "rr1m") not in fall and _cobertura(g, 1440) >= 0.9 else None
        b = bol.get(cod)
        bv = 0.0 if b == "S/P" else (float(b) if isinstance(b, str) and b.replace(".", "", 1).isdigit() else None)
        estado = "incompleto" if not completo else None
        ref = [x for x in (ema, bv) if x is not None]
        if estado is None:
            estado = "sin referencia" if not ref else "coincide" if all(abs(tot - x) < 0.15 for x in ref) else "difiere"
        filas.append(dict(cod=cod, nombre=_nombre(cat, cod), r6=r6, traza=any(traza), total=tot, ema=ema, boletin=bv, estado=estado))
    filas.sort(key=lambda x: (-x["total"], x["nombre"]))
    return dict(generado=ahora.isoformat(timespec="seconds"), desde=f"{ini:%Y-%m-%d %H:%M}", hasta=f"{fin:%Y-%m-%d %H:%M}",
                horas=["18 UTC", "00 UTC", "06 UTC", "12 UTC"], estaciones=len(filas), con_lluvia=sum(1 for x in filas if x["total"] >= 0.1 or x["traza"]),
                filas=filas)


def correr(raiz, ahora=None, subir=None):
    """Genera los dos productos, los guarda en la rama «datos» y los sube al KV."""
    ahora = ahora or datetime.now(timezone.utc)
    out = {}
    for nombre, fn in (("extremas", extremas_dia), ("lluvia_obs", lluvia_observador)):
        try:
            res = fn(raiz, ahora)
        except Exception as e:
            out[nombre] = f"error: {e}"
            continue
        txt = json.dumps(res, ensure_ascii=False)
        f = Path(raiz) / "productos" / f"{nombre}.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(txt, encoding="utf-8")
        out[nombre] = subir(f"pub/{nombre}", txt) if subir else "guardado"
    return out
