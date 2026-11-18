"""Reputación y estado de cada estación automática: semáforo según cuánto tiempo tiene problemas y estado
(cuarentena / en revisión / operativa).

  - Tiempo con problema (7 y 30 días) = tiempo sin dato + tiempo con una falla de sensor (episodios de qc/episodios.py).
    Se mide sobre la historia disponible (si hay menos de 7 o 30 días guardados, la ventana es más corta y se informa).
  - Semáforo (sobre los últimos 7 días): verde < 5 %, amarillo < 20 %, rojo ≥ 20 %.
  - Estado:
      · cuarentena: estación que aparece en el catastro después de la primera pasada de este módulo. Sus datos se ven, pero
        no son validados hasta tener 14 días, ≥ 80 % de disponibilidad y ninguna falla nivel 2 abierta; entonces queda
        «lista para aprobar» y una persona la aprueba (qc/estados_manuales.json).
      · en revisión: sin dato hace más de 24 h, semáforo rojo o falla nivel 2 abierta hace más de 24 h.
      · operativa: el resto.
    qc/estados_manuales.json ({código: {estado, nota, quien, fecha}}) manda sobre el cálculo (aprobar, poner o sacar de revisión).
Salida: datos/productos/reputacion.json y la clave «qc/reputacion» del KV (solo con la clave general).
Las estaciones que ya estaban en el catastro la primera vez que corrió este módulo quedan como «base»: no pasan por cuarentena.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pandas as pd

CORTA, LARGA = 7, 30                 # días de las dos ventanas
VERDE, AMARILLO = 5.0, 20.0          # % del tiempo con problema
DIAS_CUARENTENA = 14
DISP_MIN = 80.0                      # % de disponibilidad (7 días) para salir de cuarentena
CAIDA_H = 24                         # horas sin dato para pasar a revisión
FALLA_LARGA_H = 24                   # horas con una falla nivel 2 abierta para pasar a revisión
CIERRE_MIN = 70                      # un episodio que no se ve en 70 min está cerrado (igual que qc/episodios.py)
MANUALES = Path(__file__).with_name("estados_manuales.json")
FMT = "%Y-%m-%d %H:%M"


def _json(f, defecto):
    try:
        return json.loads(Path(f).read_text(encoding="utf-8"))
    except Exception:
        return defecto


def _t(s):
    try:
        return datetime.strptime(str(s)[:16], FMT)
    except Exception:
        return None


def _con_dato(raiz, desde, hasta):
    """{código: (datos distintos, último momento, cadencia en minutos)} entre desde y hasta (UTC), y el primer momento de todos los datos."""
    partes, t = [], pd.Timestamp(desde).floor("h")
    while t <= pd.Timestamp(hasta):
        f = Path(raiz) / "ema" / t.strftime("%Y/%m/%d/%H.csv.gz")
        if f.exists():
            try:
                partes.append(pd.read_csv(f, parse_dates=["momento"], dtype={"codigo": str}, usecols=["codigo", "momento"]))
            except Exception:
                pass
        t += pd.Timedelta(hours=1)
    if not partes:
        return {}, None
    A = pd.concat(partes, ignore_index=True).drop_duplicates(["codigo", "momento"])
    A = A[(A["momento"] > pd.Timestamp(desde)) & (A["momento"] <= pd.Timestamp(hasta))]
    if A.empty:
        return {}, None
    g = A.groupby("codigo")["momento"].agg(["size", "max"])
    # cadencia de cada estación (minutos entre datos): 1 en la mayoría, 10, 15 o 60 en otras; la disponibilidad se mide contra la suya
    paso = A.sort_values("momento").groupby("codigo")["momento"].apply(lambda x: x.diff().dt.total_seconds().median() / 60)
    return {c: (int(r["size"]), r["max"].to_pydatetime(), max(1.0, float(paso.get(c) or 1.0))) for c, r in g.iterrows()}, A["momento"].min().to_pydatetime()


def _episodios(raiz, ahora, dias):
    """Episodios de falla de sensor de los últimos días: {(código, sensor, inicio): {fin, nivel}} y {código: [alertas]}."""
    ep, avisos = {}, {}
    for k in range(dias + 1):
        d = (ahora - timedelta(days=k)).date()
        f = Path(raiz) / "hallazgos" / f"{d:%Y/%m/%d}.json"
        if not f.exists():
            continue
        for clave, a in (_json(f, {}).get("ema") or {}).items():
            cod = str(a.get("codigo") or "")
            if not cod:
                continue
            e = a.get("episodio")
            if e and e.get("inicio"):
                ini = _t(e["inicio"])
                if ini:
                    ep[(cod, e.get("sensor") or "sensor", ini)] = dict(fin=_t(e.get("fin")), nivel=a.get("nivel") or 1, sigue=bool(e.get("sigue")))
            elif a.get("prueba") != "completitud":
                avisos.setdefault(cod, {})[clave] = (_t(a.get("momento")), a.get("nivel") or 0)
    for e in (_json(Path(raiz) / "hallazgos" / "episodios.json", {}) or {}).values():
        ini = _t(e.get("inicio"))
        if ini and e.get("codigo"):
            ep.setdefault((str(e["codigo"]), e.get("sensor") or "sensor", ini), dict(fin=_t(e.get("fin")) or _t(e.get("visto")), nivel=e.get("nivel") or 1, sigue=False))
    return ep, avisos


def _union_min(tramos, desde, hasta):
    """Minutos cubiertos por la unión de los tramos (ini, fin) recortados a [desde, hasta]."""
    xs = sorted((max(a, desde), min(b, hasta)) for a, b in tramos if b > desde and a < hasta)
    total, fin = 0.0, None
    for a, b in xs:
        if fin is None or a > fin:
            total += (b - a).total_seconds() / 60
            fin = b
        elif b > fin:
            total += (b - fin).total_seconds() / 60
            fin = b
    return total


def calcular(raiz, ahora=None, manuales=None, previo=None):
    ahora = (ahora or datetime.now(timezone.utc)).replace(tzinfo=None, second=0, microsecond=0)
    cat = _json(Path(raiz) / "estaciones.json", [])
    manuales = _json(MANUALES, {}) if manuales is None else manuales
    previo = _json(Path(raiz) / "productos" / "reputacion.json", {}) if previo is None else previo
    vistas = dict(previo.get("vistas") or {})
    semilla = not previo                     # primera pasada: todas las estaciones existentes quedan como «base»
    dato, primer = _con_dato(raiz, ahora - timedelta(days=CORTA), ahora)
    ep, avisos = _episodios(raiz, ahora, LARGA)
    ini7 = ahora - timedelta(days=CORTA)
    desde7 = max(ini7, primer) if primer else ini7
    min7 = max((ahora - desde7).total_seconds() / 60, 1.0)
    # historia disponible de los avisos: desde el primer archivo diario de hallazgos
    dias_h = [p for p in (Path(raiz) / "hallazgos").glob("20??/??/??.json")]
    prim_h = min((datetime.strptime("-".join(p.parts[-3:]).replace(".json", ""), "%Y-%m-%d") for p in dias_h), default=None) if dias_h else None
    desde30 = max(ahora - timedelta(days=LARGA), prim_h) if prim_h else ahora - timedelta(days=LARGA)
    min30 = max((ahora - desde30).total_seconds() / 60, 1.0)
    pluv = {x["codigo"]: x for x in (_json(Path(raiz) / "productos" / "pluviometros.json", {}) or {}).get("estaciones", [])}
    filas = []
    for e in cat:
        cod = str(e["codigo"])
        if semilla:
            vistas[cod] = None
        elif cod not in vistas:
            vistas[cod] = f"{ahora:%Y-%m-%d}"
        n, ultimo, paso = dato.get(cod, (0, None, 1.0))
        disp = min(100.0, 100.0 * n / (min7 / paso))
        sin_h = None if ultimo is None else (ahora - ultimo).total_seconds() / 3600
        mios = [(k, v) for k, v in ep.items() if k[0] == cod]
        def abierto(v):
            return v["sigue"] or v["fin"] is None or v["fin"] >= ahora - timedelta(minutes=CIERRE_MIN)
        tr = [(k[2], ahora if abierto(v) else (v["fin"] or ahora)) for k, v in mios]
        f7 = min(100.0, 100.0 * _union_min(tr, desde7, ahora) / min7)
        f30 = min(100.0, 100.0 * _union_min(tr, desde30, ahora) / min30)
        por_sensor = {}
        for k, v in mios:
            por_sensor[k[1]] = por_sensor.get(k[1], 0) + _union_min([(k[2], ahora if abierto(v) else (v["fin"] or ahora))], desde30, ahora)
        top = max(por_sensor, key=por_sensor.get) if por_sensor and max(por_sensor.values()) > 0 else None
        n2 = sum(1 for _, (m, nv) in (avisos.get(cod) or {}).items() if nv == 2 and m and m >= ini7)
        n1 = sum(1 for _, (m, nv) in (avisos.get(cod) or {}).items() if nv == 1 and m and m >= ini7)
        prob = min(100.0, (100.0 - disp) + f7)
        sem = "rojo" if prob >= AMARILLO else "amarillo" if prob >= VERDE else "verde"
        graves = [v for k, v in mios if abierto(v) and v["nivel"] >= 2]
        grave_larga = any(v["fin"] is not None and (ahora - min(k[2] for k, vv in mios if vv is v)).total_seconds() / 3600 >= FALLA_LARGA_H for v in graves) if graves else False
        primera = vistas.get(cod)
        lista, estado, nota = False, "operativa", ""
        if primera:
            dias = (ahora.date() - datetime.strptime(primera, "%Y-%m-%d").date()).days
            estado = "cuarentena"
            if dias >= DIAS_CUARENTENA and disp >= DISP_MIN and not graves:
                lista, nota = True, "Cumple los criterios: lista para aprobar."
            else:
                faltan = []
                if dias < DIAS_CUARENTENA: faltan.append(f"día {dias} de {DIAS_CUARENTENA}")
                if disp < DISP_MIN: faltan.append(f"disponibilidad {disp:.0f} % (mínimo {DISP_MIN:.0f} %)")
                if graves: faltan.append("falla de sensor abierta")
                nota = "; ".join(faltan)
        elif sin_h is None or sin_h >= CAIDA_H or sem == "rojo" or grave_larga:
            estado = "en_revision"
            nota = ("Sin datos recientes." if sin_h is None or sin_h >= CAIDA_H else f"{prob:.0f} % del tiempo con problema (7 días)." if sem == "rojo" else "Falla de sensor abierta hace más de 24 h.")
        pl = (pluv.get(cod) or {}).get("estado")
        if pl == "sospecha_obstruccion" and estado == "operativa":
            estado, nota = "en_revision", "Pluviómetro: probablemente llovió y no marcó."
        m = manuales.get(cod)
        if m and m.get("estado") in ("operativa", "en_revision", "cuarentena"):
            estado, nota, lista = m["estado"], (m.get("nota") or "Definido a mano") + (f" ({m['quien']})" if m.get("quien") else ""), False
        sug = ("Aprobar" if lista else "Revisar comunicación" if sin_h is None or sin_h >= CAIDA_H else f"Revisar {top}" if (sem == "rojo" and top) else "Revisar" if sem == "rojo" else "Revisar pluviómetro" if pl in ("sospecha_obstruccion", "revisar") else "")
        filas.append(dict(codigo=cod, nombre=e.get("nombre") or cod, lat=e.get("lat"), alt=e.get("alt"), estado=estado, semaforo=sem, nota=nota,
                          problema_7d=round(prob, 1), sin_dato_7d=round(100.0 - disp, 1), falla_7d=round(f7, 1), falla_30d=round(f30, 1),
                          avisos_n2_7d=n2, avisos_n1_7d=n1, sensor_top=top, sugerido=sug, primera=primera, lista_aprobar=lista,
                          manual=bool(m), pluviometro=pl, horas_sin_dato=None if sin_h is None else round(sin_h, 1)))
    orden = {"rojo": 0, "amarillo": 1, "verde": 2}
    filas.sort(key=lambda f: (f["estado"] != "en_revision", f["estado"] != "cuarentena", orden[f["semaforo"]], -f["problema_7d"], f["nombre"]))
    res = {e: sum(1 for f in filas if f["estado"] == e) for e in ("cuarentena", "en_revision", "operativa")}
    res.update({s: sum(1 for f in filas if f["semaforo"] == s) for s in ("verde", "amarillo", "rojo")})
    res["listas_para_aprobar"] = sum(1 for f in filas if f["lista_aprobar"])
    return dict(generado=f"{ahora:%Y-%m-%d %H:%M}", hasta=f"{ahora:%Y-%m-%d %H:%M}", dias_7d=round(min7 / 1440, 1), dias_30d=round(min30 / 1440, 1),
                criterios=dict(verde=VERDE, amarillo=AMARILLO, cuarentena_dias=DIAS_CUARENTENA, disponibilidad_min=DISP_MIN, caida_h=CAIDA_H),
                vistas=vistas, resumen=res, estaciones=filas)


def correr(raiz, ahora=None, subir=None):
    """Calcula, guarda datos/productos/reputacion.json y sube qc/reputacion al KV."""
    R = calcular(raiz, ahora)
    txt = json.dumps(R, ensure_ascii=False)
    f = Path(raiz) / "productos" / "reputacion.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(txt, encoding="utf-8")
    return dict(resumen=R["resumen"], kv=subir("qc/reputacion", txt) if subir else "sin subir")
