"""
Incendios cerca de las estaciones automáticas.

Lee el producto de incendios de METOTEC (satelite.metotec.cl/incendios/data.json: focos GOES-19 y FIRMS, viento).
- Estación a ≤ 5 km de un foco de las últimas 3 horas → aviso «incendio cercano» (nivel 1).
- Estación a ≤ 10 km: los avisos de temperatura, punto de rocío y humedad se anotan con el incendio como posible
  causa y un «erróneo» baja a «sospechoso» (el dato puede ser real: aire caliente y seco del incendio).
"""
import math
from datetime import datetime, timedelta, timezone

import requests

URLS = ["https://satelite.metotec.cl/incendios/data.json", "https://orlalv.github.io/conveccion-chile/incendios/data.json"]
RUMBOS = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"]
VARS = {"T", "Td", "HR", "Tx12", "Tn12"}


def obtener():
    err = []
    for u in URLS:
        try:
            r = requests.get(u, timeout=40, headers={"User-Agent": "metotec-qc/0.1"}); r.raise_for_status()
            return r.json()
        except Exception as e:
            err.append(f"{u}: {e}")
    raise RuntimeError(" | ".join(err))


def _km(a1, o1, a2, o2):
    a, b = math.radians(a1), math.radians(a2)
    return 6371 * math.acos(max(-1, min(1, math.sin(a) * math.sin(b) + math.cos(a) * math.cos(b) * math.cos(math.radians(o2 - o1)))))


def _rumbo(a1, o1, a2, o2):
    az = math.degrees(math.atan2(math.radians(o2 - o1) * math.cos(math.radians(a1)), math.radians(a2 - a1))) % 360
    return RUMBOS[int((az + 22.5) // 45) % 8], az


def cercania(E, js, horas=3, radio=10):
    """{código: {dist, rumbo, edad_min, focos, a_sotavento}} de las estaciones con fuego cerca."""
    if not js:
        return {}
    ahora = datetime.now(timezone.utc)
    lim = (ahora - timedelta(hours=horas)).strftime("%Y-%m-%dT%H:%MZ")
    F = [f for f in js.get("focos", []) if not f.get("industrial") and f["t"] >= lim]
    V = js.get("viento") or []
    out = {}
    for r in E.to_dict("records"):
        if r.get("lat") is None:
            continue
        cerca = [(_km(r["lat"], r["lon"], f["lat"], f["lon"]), f) for f in F]
        cerca = [(d, f) for d, f in cerca if d <= radio]
        if not cerca:
            continue
        d, f = min(cerca, key=lambda x: x[0])
        rb, az = _rumbo(r["lat"], r["lon"], f["lat"], f["lon"])          # dónde está el fuego visto desde la estación
        sota = None
        if V:
            w = min(V, key=lambda w: (w[0] - f["lat"]) ** 2 + (w[1] - f["lon"]) ** 2)
            hacia = (w[2] + 180) % 360                                      # hacia dónde va el humo
            az_est = (az + 180) % 360                                       # desde el fuego hacia la estación
            sota = abs((az_est - hacia + 180) % 360 - 180) <= 45
        edad = (ahora - datetime.strptime(max(x["t"] for _, x in cerca), "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)).total_seconds() / 60
        out[r["codigo"]] = dict(dist=round(d, 1), rumbo=rb, edad_min=round(edad), focos=len(cerca), a_sotavento=sota)
    return out


def aplicar(alertas, cerc, fin, alerta):
    """Anota o agrega avisos según la cercanía de incendios. Devuelve la lista nueva."""
    for a in alertas:
        c = cerc.get(a["codigo"])
        if c and a["var"] in VARS:
            a["msg"] += f" · hay un incendio a {c['dist']:g} km al {c['rumbo']}: el valor puede ser real (aire caliente y seco del fuego)"
            a["nivel"] = min(a["nivel"], 1)
            a["incendio"] = True
    for cod, c in cerc.items():
        if c["dist"] <= 5:
            humo = " y el viento lleva el humo hacia la estación" if c["a_sotavento"] else ""
            alertas.append(alerta(cod, "incendio", "T", 1, fin, None, None,
                                  f"incendio a {c['dist']:g} km al {c['rumbo']} (detectado hace {c['edad_min']} min){humo}: temperatura, humedad, radiación y viento pueden estar alterados"))
    return alertas
