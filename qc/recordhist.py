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
