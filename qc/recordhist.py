"""Récords históricos de temperatura (máxima y mínima diarias de 1990 en adelante, anuarios guardados en datos/series).

records.json  →  {cod: {nombre, desde, hasta, n, tx: {max: [valor, fecha], mes: {"1": [valor, fecha], …}}, tn: {min: [valor, fecha], mes: {…}}}}
Se calcula con la serie ya guardada (series.py), sin bajar nada. Se usa para avisar cuando un valor supera lo que la estación ha
registrado en el mes (informativo) o en toda su historia (sospechoso: confirmar)."""
import json
from pathlib import Path

TOL = 0.05


def calcular(datos, estaciones=None):
    datos = Path(datos)
    nom = {str(e["codigo"]): e.get("nombre") for e in (estaciones or [])}
    out = {}
    for var, f in (("tx", "tx"), ("tn", "tn")):
        d = datos / "series" / f
        if not d.exists():
            continue
        for cd in sorted(p for p in d.iterdir() if p.is_dir()):
            cod = cd.name
            r = out.setdefault(cod, dict(nombre=nom.get(cod), desde=None, hasta=None, n=0))
            mejor = None
            por_mes = {}
            n = 0
            for pa in sorted(cd.glob("*.json")):
                try:
                    anio = int(pa.stem)
                    S = json.loads(pa.read_text())
                except Exception:
                    continue
                for md, x in S.items():
                    if not isinstance(x, (int, float)) or x != x:
                        continue
                    n += 1
                    fecha = f"{anio}-{md}"
                    mes = str(int(md[:2]))
                    r["desde"] = min(r["desde"] or fecha, fecha)
                    r["hasta"] = max(r["hasta"] or fecha, fecha)
                    mas = (lambda a, b: a > b) if var == "tx" else (lambda a, b: a < b)
                    if mejor is None or mas(x, mejor[0]):
                        mejor = [x, fecha]
                    if mes not in por_mes or mas(x, por_mes[mes][0]):
                        por_mes[mes] = [x, fecha]
            if mejor:
                r[var] = {("max" if var == "tx" else "min"): mejor, "mes": por_mes}
                r["n"] = max(r["n"], n)
    return {c: v for c, v in out.items() if "tx" in v or "tn" in v}


def cargar(datos):
    p = Path(datos) / "records" / "temperatura.json"
    return json.loads(p.read_text()) if p.exists() else {}


def guardar(datos, R):
    p = Path(datos) / "records"
    p.mkdir(parents=True, exist_ok=True)
    (p / "temperatura.json").write_text(json.dumps(R, ensure_ascii=False, separators=(",", ":")))


def comparar(R, cod, fecha, minimo, x):
    """Devuelve (nivel, texto) si x supera el récord de la estación para la fecha, o None.
    nivel 1 = récord de toda la historia; nivel 0 = récord del mes."""
    e = (R or {}).get(str(cod))
    if not e or x is None:
        return None
    mes = str(int(fecha[5:7]))
    r = e.get("tn" if minimo else "tx") or {}
    ab = r.get("min" if minimo else "max")
    m = (r.get("mes") or {}).get(mes)
    peor = (lambda a, b: a < b - TOL) if minimo else (lambda a, b: a > b + TOL)
    pal = "mínima" if minimo else "máxima"
    if ab and peor(x, ab[0]):
        return 1, f"{x:g} °C supera la {pal} más {'baja' if minimo else 'alta'} de la historia de la estación ({ab[0]:g} °C el {ab[1][8:10]}-{ab[1][5:7]}-{ab[1][:4]}; serie {e['desde'][:4]}–{e['hasta'][:4]}). Posible récord: confirmar que el dato es correcto"
    if m and peor(x, m[0]):
        return 0, f"{x:g} °C supera la {pal} más {'baja' if minimo else 'alta'} registrada en ese mes ({m[0]:g} °C el {m[1][8:10]}-{m[1][5:7]}-{m[1][:4]}; serie {e['desde'][:4]}–{e['hasta'][:4]}). Récord del mes"
    return None


# ------------------------------------------------------------------ precipitación y viento
def _anio_dia(f):
    return f[:4], f[5:7]


def calcular_pp(datos):
    """Récords de agua caída por estación: máxima diaria (de siempre y de cada mes) y máximo mensual. Usa series/pp (servicio de la DMC, llega
    al 31-12-2025) y, donde existe, el archivo SACLIM (RRR6 cada 6 h, suma por día) para lo posterior."""
    import gzip, csv, collections
    datos = Path(datos)
    out = {}
    d = datos / "series" / "pp"
    if not d.exists():
        return out
    for pa in sorted(d.glob("*.json")):
        try:
            j = json.loads(pa.read_text())
        except Exception:
            continue
        cod = str(j.get("cod") or pa.stem)
        dias = {x[0]: x[1] for x in j.get("dias", []) if isinstance(x[1], (int, float)) and x[1] == x[1]}
        ult = max(dias) if dias else None
        for fa in sorted((datos / "saclim" / cod).glob("*/Agua6Horas.csv.gz")) if (datos / "saclim" / cod).exists() else []:
            if ult and fa.parent.name <= ult[:4] and fa.parent.name != ult[:4]:
                continue
            suma = collections.defaultdict(float)
            try:
                with gzip.open(fa, "rt") as f:
                    for r in csv.DictReader(f, delimiter=";"):
                        try:
                            suma[r["Instante"][:10]] += float(r["RRR6"])
                        except Exception:
                            pass
            except Exception:
                continue
            for dia, x in suma.items():
                if not ult or dia > ult:
                    dias[dia] = round(x, 1)
        if len(dias) < 3000:
            continue
        mx, mes, tot = None, {}, collections.defaultdict(float)
        for dia, x in sorted(dias.items()):
            m = str(int(dia[5:7]))
            tot[dia[:7]] += x
            if mx is None or x > mx[0]:
                mx = [x, dia]
            if m not in mes or x > mes[m][0]:
                mes[m] = [x, dia]
        mm = max(tot.items(), key=lambda a: a[1])
        out[cod] = dict(desde=min(dias), hasta=max(dias), n=len(dias), dia=mx, mes=mes, mensual=[round(mm[1], 1), mm[0]])
    return out


def calcular_viento(datos):
    """Viento medio horario máximo (kt) por estación y por mes, del archivo horario SACLIM (seis estaciones)."""
    import gzip, csv
    datos = Path(datos)
    out = {}
    sd = datos / "saclim"
    if not sd.exists():
        return out
    for cd in sorted(p for p in sd.iterdir() if p.is_dir()):
        mx, mes, n, desde, hasta = None, {}, 0, None, None
        for fa in sorted(cd.glob("*/Viento.csv.gz")):
            try:
                with gzip.open(fa, "rt") as f:
                    for r in csv.DictReader(f, delimiter=";"):
                        try:
                            ff = float(r["ff"])
                        except Exception:
                            continue
                        if ff >= 200:
                            continue
                        t = r["Instante"]
                        n += 1
                        desde = min(desde or t, t); hasta = max(hasta or t, t)
                        m = str(int(t[5:7]))
                        if mx is None or ff > mx[0]:
                            mx = [ff, t[:10]]
                        if m not in mes or ff > mes[m][0]:
                            mes[m] = [ff, t[:10]]
            except Exception:
                continue
        if mx and n > 3000:
            out[cd.name] = dict(desde=desde[:10], hasta=hasta[:10], n=n, max=mx, mes=mes)
    return out


def cargar_pv(datos, nombre):
    p = Path(datos) / "records" / f"{nombre}.json"
    try:
        return json.loads(p.read_text()) if p.exists() else {}
    except Exception:
        return {}


def guardar_pv(datos, nombre, R):
    p = Path(datos) / "records"
    p.mkdir(parents=True, exist_ok=True)
    (p / f"{nombre}.json").write_text(json.dumps(R, ensure_ascii=False, separators=(",", ":")))


def todos(datos, estaciones=None, recalcular_viento=False):
    """Los tres juegos de récords {t, p, v}; guarda lo que cambió. El viento (archivo grande) solo se recalcula si falta o se pide."""
    T = calcular(datos, estaciones)
    if T and T != cargar(datos):
        guardar(datos, T)
    P = calcular_pp(datos)
    if P and P != cargar_pv(datos, "precipitacion"):
        guardar_pv(datos, "precipitacion", P)
    V = cargar_pv(datos, "viento")
    if recalcular_viento or not V:
        V = calcular_viento(datos) or V
        if V:
            guardar_pv(datos, "viento", V)
    return {"t": T, "p": P, "v": V}


def _f(f):
    return f"{f[8:10]}-{f[5:7]}-{f[:4]}"


def comparar_pp(R, cod, fecha, x):
    """(nivel, texto) si el agua caída x (mm) supera la máxima diaria de la historia (1) o la máxima diaria de ese mes (0)."""
    e = (R or {}).get(str(cod))
    if not e or x is None:
        return None
    ab = e.get("dia"); m = (e.get("mes") or {}).get(str(int(fecha[5:7])))
    if ab and x > ab[0] + TOL:
        return 1, f"{x:g} mm supera la máxima diaria de la historia de la estación ({ab[0]:g} mm el {_f(ab[1])}; serie {e['desde'][:4]}–{e['hasta'][:4]}). Posible récord: confirmar que el dato es correcto"
    if m and x > m[0] + TOL:
        return 0, f"{x:g} mm supera la máxima diaria registrada en ese mes ({m[0]:g} mm el {_f(m[1])}). Récord del mes"
    return None


def comparar_viento(R, cod, fecha, x):
    e = (R or {}).get(str(cod))
    if not e or x is None:
        return None
    ab = e.get("max"); m = (e.get("mes") or {}).get(str(int(fecha[5:7])))
    if ab and x > ab[0]:
        return 1, f"viento medio {x:g} kt supera el máximo de la historia de la estación ({ab[0]:g} kt el {_f(ab[1])}; serie {e['desde'][:4]}–{e['hasta'][:4]}). Posible récord: confirmar que el dato es correcto"
    if m and x > m[0]:
        return 0, f"viento medio {x:g} kt supera el máximo registrado en ese mes ({m[0]:g} kt el {_f(m[1])}). Récord del mes"
    return None
