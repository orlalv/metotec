"""Fallas de sensor de las estaciones automáticas agrupadas por episodio.

Las pruebas de rango, salto y valor pegado avisan en cada pasada (cada 30 min). Aquí se juntan en un solo aviso por
estación y sensor (Ts y HR van juntas: es el mismo termohigrómetro), con inicio, fin, minutos y si la falla sigue.
Una falla que no se ve por más de VENCE se da por terminada; si vuelve, es un episodio nuevo.
Estado en datos/hallazgos/episodios.json (rama datos).
"""
import json
from pathlib import Path
import pandas as pd

FALLAS = {"rango", "salto", "pegado"}
SENSOR = {"T": "termohigrómetro", "HR": "termohigrómetro", "Td": "termohigrómetro", "P_est": "barómetro", "P_mar": "barómetro",
          "ff10": "anemómetro", "dd10": "veleta", "rr1m": "pluviómetro", "Rad": "piranómetro (radiación)"}
QUE = {"rango": "valores fuera de rango", "salto": "saltos bruscos", "pegado": "valor pegado (sin cambio)"}
NOM = {"T": "Ts", "HR": "HR", "Td": "Td", "P_est": "QFE", "P_mar": "QFF", "ff10": "viento", "dd10": "dirección", "rr1m": "lluvia", "Rad": "radiación"}
VENCE = pd.Timedelta(minutes=70)       # sin verse en dos pasadas seguidas: terminó


def _ruta(raiz):
    return Path(raiz) / "hallazgos" / "episodios.json"


def agrupar(alertas, raiz, ahora=None):
    """Devuelve (alertas con las fallas de sensor reemplazadas por un aviso por episodio, episodios terminados en esta pasada)."""
    ahora = pd.Timestamp(ahora) if ahora is not None else pd.Timestamp.now(tz="UTC")
    ahora = ahora.tz_convert(None) if ahora.tzinfo else ahora
    p = _ruta(raiz)
    abiertos = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    otras, fallas = [], {}
    for a in alertas:
        if a["prueba"] in FALLAS and a["var"] in SENSOR:
            fallas.setdefault((a["codigo"], SENSOR[a["var"]]), []).append(a)
        else:
            otras.append(a)
    nuevas = []
    for (cod, sen), al in fallas.items():
        k = f"{cod}|{sen}"
        mom = max(pd.Timestamp(a["momento"]) for a in al)
        ep = abiertos.get(k)
        if ep is None:
            ini = min(pd.Timestamp(a["momento"]) for a in al)
            # el pegado se detecta al cumplir sus horas: empezó antes
            for a in al:
                if a["prueba"] == "pegado" and "durante" in a["msg"]:
                    try:
                        ini = min(ini, mom - pd.Timedelta(hours=float(a["msg"].split("durante ")[1].split(" h")[0])))
                    except ValueError:
                        pass
            ep = abiertos[k] = dict(codigo=cod, sensor=sen, inicio=str(ini)[:16], vars=[], pruebas=[], nivel=0)
        ep["fin"] = str(max(pd.Timestamp(ep.get("fin", ep["inicio"])), mom))[:16]
        ep["visto"] = str(ahora)[:16]
        ep["vars"] = sorted(set(ep["vars"]) | {a["var"] for a in al})
        ep["pruebas"] = sorted(set(ep["pruebas"]) | {a["prueba"] for a in al})
        ep["nivel"] = max(ep["nivel"], *(a["nivel"] for a in al))
        ep["detalle"] = [f"{NOM.get(a['var'], a['var'])} · {a['prueba']}: {a['msg']}" + (f" (valor {a['valor']})" if a.get("valor") is not None else "") for a in al]
        nuevas.append(_aviso(ep, sigue=True))
    terminados = []
    for k, ep in list(abiertos.items()):
        if ahora - pd.Timestamp(ep["visto"]) > VENCE:
            terminados.append(_aviso(ep, sigue=False))
            del abiertos[k]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(abiertos, ensure_ascii=False, indent=0), encoding="utf-8")
    return otras + nuevas, terminados


def _aviso(ep, sigue):
    ini, fin = pd.Timestamp(ep["inicio"]), pd.Timestamp(ep["fin"])
    minutos = int((fin - ini).total_seconds() // 60)
    dur = f"{minutos} min" if minutos < 120 else f"{minutos / 60:.1f} h"
    vars_ = " y ".join(NOM.get(v, v) for v in ep["vars"])
    que = ", ".join(QUE[p] for p in ep["pruebas"])
    msg = (f"Falla del {ep['sensor']} ({vars_}): {que}, desde {ini:%d/%m %H:%M} UTC ({dur})"
           + (", sigue." if sigue else f", terminó a las {fin:%H:%M} UTC."))
    return dict(codigo=ep["codigo"], prueba=ep["pruebas"][0], var="+".join(ep["vars"]), nivel=ep["nivel"], momento=ep["inicio"] + ":00",
                valor=None, ref=None, msg=msg, episodio=dict(sensor=ep["sensor"], inicio=ep["inicio"], fin=ep["fin"], minutos=minutos, sigue=sigue),
                detalle=ep.get("detalle", []))
