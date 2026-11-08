"""Prueba, una vez, qué estaciones entregan datos sensoriales (servicio getRecientesSaclim).

Guarda <datos>/sensoriales.json con: código, nombre, horas con datos, elementos con datos y última hora.
No guarda valores ni el identificador del observador.
"""
import json, sys, time
from pathlib import Path
import requests
sys.path.insert(0, str(Path(__file__).parent))
import dmc


def con_valor(nodo):
    """True si algún componente dentro del nodo tiene valor."""
    if isinstance(nodo, dict):
        if "valor" in nodo and "ComponenteNombre" in nodo:
            return nodo.get("valor") not in (None, "") and not nodo.get("SinDato")
        return any(con_valor(v) for v in nodo.values())
    if isinstance(nodo, list):
        return any(con_valor(v) for v in nodo)
    return False


def main(raiz="datos"):
    E, _ = dmc.leer(dmc.descargar())
    filas = []
    for r in E.to_dict("records"):
        f = dict(codigo=r["codigo"], nombre=r["nombre"], oaci=r["oaci"])
        try:
            js = dmc.descargar(f"getRecientesSaclim/{r['codigo']}", timeout=90)
            horas, elems, ult = 0, set(), None
            for bloque in js.get("datos") or []:
                for t, h in (bloque or {}).items():
                    d = (h or {}).get("datos") or {}
                    ok = [eid for eid, v in d.items() if con_valor(v)]
                    if ok:
                        horas += 1
                        elems |= set(ok)
                        ult = max(ult or t, t)
            f.update(estado=js.get("status"), horas=horas, elementos=len(elems), ultima=ult)
        except Exception as e:
            f.update(estado=f"error: {str(e)[:80]}", horas=0, elementos=0, ultima=None)
        filas.append(f)
        time.sleep(0.5)
    con = [f for f in filas if f["horas"] > 0]
    out = dict(revisadas=len(filas), con_datos=len(con), estaciones=filas)
    Path(raiz).mkdir(parents=True, exist_ok=True)
    (Path(raiz) / "sensoriales.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(con)} de {len(filas)} estaciones con datos sensoriales")
    for f in con:
        print(f["codigo"], f["nombre"], f["horas"], "h", f["elementos"], "elementos")


if __name__ == "__main__":
    main(*sys.argv[1:])
