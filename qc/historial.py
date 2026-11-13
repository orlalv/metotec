"""
Historial de hallazgos: nada se borra.

Cada día UTC tiene un archivo hallazgos/AAAA/MM/DD.json (en la rama "datos") y una copia en el KV (qc/hist/AAAA-MM-DD):
  {"obs": {id: registro}, "ema": {id: registro}}

Observaciones (id = o|código|hora|regla):
  estado "abierto" mientras la regla siga fallando; "corregido" cuando la observación ya revisada deja de fallar
  (el observador la corrigió). Si vuelve a fallar, se reabre. Guarda primera y última vez visto y la hora de corrección.
Estaciones automáticas (id = a|código|momento|prueba|variable): son eventos; guarda primera/última vez y cuántas pasadas lo vieron.
"""

import json
from pathlib import Path


def _ruta(raiz, dia):
    return Path(raiz) / "hallazgos" / dia[:4] / dia[5:7] / f"{dia[8:10]}.json"


def _cargar(raiz, dia, cache):
    if dia not in cache:
        p = _ruta(raiz, dia)
        cache[dia] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"obs": {}, "ema": {}}
    return cache[dia]


def actualizar(raiz, ahora, sensorial=None, revisadas=None, alertas=None, nombres=None):
    """sensorial: lista de estaciones con 'hallazgos' (de control_sensorial); revisadas: {código: [horas revisadas]};
    alertas: lista de alertas de las estaciones automáticas. Devuelve {día: texto json} de los días modificados."""
    ahora = ahora.strftime("%Y-%m-%d %H:%M")
    nombres = nombres or {}
    cache, tocados = {}, set()

    if sensorial is not None:
        vistos = set()
        for est in sensorial:
            for h in est.get("hallazgos", []):
                dia = h["hora"][:10]
                D = _cargar(raiz, dia, cache)
                k = f"o|{h['codigo']}|{h['hora'][:16]}|{h['regla']}"
                r = D["obs"].get(k)
                if r is None:
                    r = D["obs"][k] = dict(codigo=h["codigo"], nombre=est.get("nombre"), hora=h["hora"][:16], tipo=h["tipo"], regla=h["regla"], primera=ahora)
                r.update(nivel=h["nivel"], msg=h["msg"], ultima=ahora, estado="abierto", revisado=h.get("revisado"))
                r.pop("corregido", None)
                vistos.add(k); tocados.add(dia)
        for cod, horas in (revisadas or {}).items():
            for hora in horas:
                dia = hora[:10]
                D = _cargar(raiz, dia, cache)
                pref = f"o|{cod}|{hora[:16]}|"
                for k, r in D["obs"].items():
                    if k.startswith(pref) and k not in vistos and r.get("estado") == "abierto":
                        r.update(estado="corregido", corregido=ahora); tocados.add(dia)

    for a in alertas or []:
        dia = str(a["momento"])[:10]
        D = _cargar(raiz, dia, cache)
        ep = a.get("episodio")
        k = f"a|{a['codigo']}|{ep['inicio']}|episodio|{ep['sensor']}" if ep else f"a|{a['codigo']}|{str(a['momento'])[:16]}|{a['prueba']}|{a['var']}"
        r = D["ema"].get(k)
        if r is None:
            r = D["ema"][k] = dict(codigo=a["codigo"], nombre=nombres.get(a["codigo"]), momento=str(a["momento"])[:16], prueba=a["prueba"], var=a["var"], primera=ahora, n=0)
        if ep:
            r.update(var=a["var"], episodio=ep, detalle=a.get("detalle"), estado="sigue" if ep["sigue"] else "resuelta")
        r.update(nivel=max(r.get("nivel", 0), a["nivel"]), msg=a["msg"], valor=a.get("valor"), ref=a.get("ref"), ultima=ahora, n=r["n"] + 1)
        tocados.add(dia)

    salida = {}
    for dia in sorted(tocados):
        p = _ruta(raiz, dia)
        p.parent.mkdir(parents=True, exist_ok=True)
        txt = json.dumps(cache[dia], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        p.write_text(txt, encoding="utf-8")
        salida[dia] = txt
    return salida
