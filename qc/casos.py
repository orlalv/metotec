"""Pruebas fijas: casos ya corregidos que no deben volver a alertar (y sus contrapartes que sí).

Se corren antes de publicar (y en cada pasada de qc.yml):  python qc/casos.py
Para agregar un caso: una función prueba_* que arme la observación y use no_alerta / si_alerta.
"""
import sys
from pathlib import Path
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import sensorial as S


# ----------------------------------------------------------------- ayudas
def obs(ww=None, metar=(), CL=None, capas=(), N=None, VV=None, rr6=None, traza=None, W=None, **otros):
    """Observación mínima en el formato de sensorial.leer. metar: códigos FEN (2 RA, 9 BR, 10 FG…).
    capas: [(octas, tipo C, altura m)]."""
    o = {}
    if ww is not None:
        o["WWSINOP"] = {"ww": ww}
    if VV is not None:
        o["VVSINOP"] = {"VV": VV}
    if N is not None:
        o["N"] = {"N": N}
    if CL is not None:
        o["Nubes"] = {"Cl": CL, "Cm": 0, "Ch": 0, "Nh": capas[0][0] if capas else 0}
    if metar:
        o["WWMETAR"] = dict(zip(("FEN1", "FEN2", "FEN3"), metar))
    if capas:
        o["CapaNube"] = {}
        for i, (n, c, h) in enumerate(capas):
            s = "" if i == 0 else str(i + 1)
            o["CapaNube"].update({f"Ns{s}": n, f"C{s}": c, f"hshshs{s}": h})
    if rr6 is not None or traza is not None:
        o["RRR6"] = {"RRR6": rr6 if rr6 is not None else 0, "Traza": traza or 0}
    if W is not None:
        o["W1W2"] = {"W1": W[0], "W2": W[1]}
    for k, x in otros.items():            # QFF=1001, Ts=15.2, VTO=(dd, ff)
        o[k] = {"dd": x[0], "ff": x[1]} if k == "VTO" else {k: x}
    return o


def minutario(t, horas=6, lluvia=None, **cols):
    """Minutario de la automática: horas previas a t, sin lluvia salvo {minuto (Timestamp): mm}; cols: valor fijo (P_mar=1001.2)."""
    m = pd.date_range(t - pd.Timedelta(hours=horas) + pd.Timedelta(minutes=1), t, freq="1min")
    A = pd.DataFrame({"momento": m, "rr1m": 0.0, **cols})
    for k, mm in (lluvia or {}).items():
        A.loc[A["momento"] == k, "rr1m"] = mm
    return A


def reglas(lista, cod):
    return [x for x in lista if x[1] == cod]


FALLAS = []


def no_alerta(lista, cod, caso):
    if reglas(lista, cod):
        FALLAS.append(f"{caso}: alertó {cod} y no debía → {reglas(lista, cod)}")


def si_alerta(lista, cod, caso, nivel=None):
    r = reglas(lista, cod)
    if not r or (nivel is not None and all(x[2] != nivel for x in r)):
        FALLAS.append(f"{caso}: debía alertar {cod}" + (f" nivel {nivel}" if nivel else "") + f" → {r}")


T = pd.Timestamp("2026-11-10 12:00")


# ----------------------------------------------------------------- casos
def prueba_vina_goteo_neblina():
    """Viña: un pulso de 0.1 mm con neblina (BR) = goteo en el embudo, no se exige precipitación."""
    A = minutario(T, lluvia={T - pd.Timedelta(minutes=5): 0.1})
    r = S.precipitacion_hora(T, obs(ww=10, metar=(9,), VV=4000, CL=7, capas=[(8, 7, 300)], N=8), A)
    no_alerta([x for x in r if x[2] == 2], "SPRE", "Viña goteo de neblina (nivel 2)")
    # contraparte: 0.4 mm sin precipitación informada sí es alerta fuerte
    A2 = minutario(T, lluvia={T - pd.Timedelta(minutes=k): 0.1 for k in (3, 6, 9, 12)})
    si_alerta(S.precipitacion_hora(T, obs(ww=10, metar=(9,), VV=4000, N=8), A2), "SPRE", "lluvia real sin ww", nivel=2)


def prueba_e13_solo_metar():
    """Tobalaba / Peldehue: estación sin SYNOP (solo METAR); RRR6 > 0 con el pluviómetro marcando → no E13."""
    hist = {T - pd.Timedelta(hours=k): obs(metar=(), N=6, CL=6, capas=[(6, 6, 900)]) for k in range(1, 6)}
    o = obs(N=6, CL=6, capas=[(6, 6, 900)], rr6=1.2)
    hist[T] = o
    A = minutario(T, lluvia={T - pd.Timedelta(hours=3, minutes=k): 0.2 for k in range(6)})
    no_alerta(S.evolucion(T, o, hist, A), "E13", "Tobalaba/Peldehue E13")
    # contraparte: el pluviómetro en 0 → el RRR6 está mal
    si_alerta(S.evolucion(T, o, hist, minutario(T)), "E13", "RRR6 sin lluvia en pluviómetro", nivel=2)


def prueba_chubasco_con_sc():
    """Chubasco (ww 80) con solo Sc: el Sc también da chubascos → no C10."""
    no_alerta(S.codificacion(obs(ww=80, CL=5, N=7, VV=8000, capas=[(7, 6, 900)])), "C10", "chubasco con Sc")
    si_alerta(S.codificacion(obs(ww=80, CL=7, N=7, VV=8000, capas=[(7, 7, 300)])), "C10", "chubasco con solo St")


def prueba_c36_lluvia_con_fg():
    """ww 60 (lluvia) con FG en el METAR: la precipitación tiene prioridad sobre la niebla → no C36."""
    no_alerta(S.codificacion(obs(ww=60, metar=(2, 10), VV=800, N=8, CL=7, capas=[(8, 7, 200)])), "C36", "C36 ww 60 con FG")
    si_alerta(S.codificacion(obs(ww=2, metar=(10,), VV=800, N=8, CL=7, capas=[(8, 7, 200)])), "C36", "FG con ww 02")


def prueba_cl8_solo_sc():
    """CL 8 (Cu y Sc a distinta altura) con solo la capa de Sc en los grupos 8 → no C40."""
    no_alerta(S.codificacion(obs(CL=8, N=5, capas=[(5, 6, 1200)])), "C40", "CL 8 con solo Sc")
    si_alerta(S.codificacion(obs(CL=8, N=5, capas=[(5, 3, 3000)])), "C40", "CL 8 sin Cu ni Sc")


# ----------------------------------------------------------------- etapa 1 (menos ruido)
def _serie(el, valores, **kw):
    """Horas t-k … t+k con los valores dados (el del medio es la hora revisada)."""
    n = len(valores) // 2
    return {T + pd.Timedelta(hours=i - n): obs(**{el: x}, **kw) for i, x in enumerate(valores)}


def prueba_digitacion_presion():
    """1001, 1001, 1010, 1001 → probable 1001; si el sensor también marcó 1010, fue real."""
    h = _serie("QFF", [1001.0, 1001.2, 1001.1, 1001.0, 1010.0, 1001.0, 1001.1, 1001.2, 1001.0])
    si_alerta(S.digitacion(T, h[T], h, minutario(T, P_mar=1001.1)), "E20", "QFF 1010 entre 1001", nivel=2)
    no_alerta(S.digitacion(T, h[T], h, minutario(T, P_mar=1010.0)), "E20", "QFF 1010 que el sensor confirma")


def prueba_digitacion_direccion():
    h = {T + pd.Timedelta(hours=k): obs(VTO=(200, 12)) for k in (-2, -1, 1, 2)}
    h[T] = obs(VTO=(20, 12))
    si_alerta(S.evolucion(T, h[T], h, minutario(T, dd10=200.0, ff10=12.0)), "E20", "dirección 020 entre 200")
    no_alerta(S.evolucion(T, h[T], h, minutario(T, dd10=20.0, ff10=12.0)), "E20", "giro que el sensor confirma")


def prueba_frente_sensor_solo_grande():
    A = minutario(T, P_mar=1001.0, T=15.0)
    no_alerta(S.frente_sensor(T, obs(QFF=1002.5), A, {"QFF": 0.0}), "SQFF", "QFF 1.5 hPa sobre el sensor")
    si_alerta(S.frente_sensor(T, obs(QFF=1004.0), A, {"QFF": 0.0}), "SQFF", "QFF 3 hPa sobre el sensor")
    no_alerta(S.frente_sensor(T, obs(QFF=1004.0), A, {"QFF": 3.0}), "SQFF", "QFF con diferencia propia de 3 hPa")
    no_alerta(S.frente_sensor(T, obs(Ts=16.2), A), "STs", "Ts 1.2 °C sobre el sensor")
    si_alerta(S.frente_sensor(T, obs(Ts=18), A), "STs", "Ts entera 3 °C sobre el sensor", nivel=1)
    # valor que aparece en algún minuto de la hora previa
    A2 = A.copy(); A2.loc[A2["momento"] == T - pd.Timedelta(minutes=40), "T"] = 18.4
    no_alerta(S.frente_sensor(T, obs(Ts=18.4), A2), "STs", "Ts que marcó el sensor a los 40 min")


def prueba_viento_kmh():
    A = minutario(T, ff10=10.0, dd10=180.0)
    si_alerta(S.frente_sensor(T, obs(VTO=(180, 19)), A), "Sffkmh", "19 km/h con 10 kt en el sensor")
    no_alerta(S.frente_sensor(T, obs(VTO=(180, 12)), A), "Sffkmh", "12 kt con 10 kt en el sensor")
    no_alerta(S.frente_sensor(T, obs(VTO=(180, 18)), A), "Sff", "8 kt de diferencia")


def prueba_visibilidad_y_nubes():
    no_alerta(S.codificacion(obs(ww=10, VV=7000, N=0)), "C02", "neblina con 7 km")
    si_alerta(S.codificacion(obs(ww=5, VV=10000, N=0)), "C03", "calima con 10 km")
    no_alerta(S.codificacion(obs(CL=1, N=3, capas=[(3, 7, 400)])), "C40", "CL 1 con capa de St")


def prueba_traza():
    si_alerta(S.codificacion(obs(N=0, rr6=0.4, traza=1)), "C42", "traza con RRR6 0.4", nivel=1)
    A = minutario(T, lluvia={T - pd.Timedelta(hours=2, minutes=k): 0.1 for k in range(3)})
    si_alerta(S.frente_sensor(T, obs(N=0, rr6=0, traza=1), A), "SRRR6", "traza con 0.3 mm en el pluviómetro", nivel=1)
    h = {T - pd.Timedelta(hours=k): obs(ww=2, N=2) for k in range(1, 6)}
    h[T] = obs(ww=2, N=2, rr6=0, traza=1)
    si_alerta(S.evolucion(T, h[T], h, minutario(T)), "E21", "traza sin fenómenos", nivel=0)


def prueba_extremas_oficiales():
    """La extrema y su hora oficiales (resumen diario) mandan sobre el minutario."""
    import dmc
    # formato real (Frei, 13-11-2026): el lector no debe tomar la dirección del viento ni los «datos» de maxima06
    js = {"datos": {"vientoMaxino": {"10-11-2026": {"maxima": {"direccion": "322", "intensidad": "30.52", "momento": "2026-11-10 09:36:00"}}},
                    "extremas6Horas": {"viento": {"datos": 354, "maxima": {"direccion": "322", "intensidad": "30.52", "momento": "2026-11-10 09:36:00"}}},
                    "temperaturaExtremas": {"10-11-2026": {"maxima06": {"datos": 360, "valor": "0.2", "momento": "2026-11-09 21:05:00"}, "datos": 765,
                                                           "minima": {"valor": "3.37", "momento": "2026-11-10 06:41:00"},
                                                           "maxima": {"valor": "21.84", "momento": "2026-11-10 19:02:00"}}}}}
    of = dmc.extremas_oficiales(js)
    if sorted((x["tipo"], x["valor"]) for x in of) != [("max", 21.84), ("min", 3.37)]:
        FALLAS.append(f"lector del resumen diario → {of}")
    A = minutario(T, horas=13, T=5.0)
    A.loc[A["momento"] == pd.Timestamp("2026-11-10 09:41"), "T"] = 3.4
    bien = {"TnAM": {"TnAM": 3.4, "FechaHora": "2026-11-10 06:41:00"}}        # resumen y observador en hora local (06:41 = 09:41 UTC)
    no_alerta(S.extremas(T, bien, A, "330020", None, of), "SEXT", "TnAM igual a la oficial")
    no_alerta(S.extremas(T, bien, A, "330020", None, of), "SEXH", "TnAM a la hora oficial")
    mala = {"TnAM": {"TnAM": 3.4, "FechaHora": "2026-11-10 05:10:00"}}
    si_alerta(S.extremas(T, mala, A, "330020", None, of), "SEXH", "TnAM con hora distinta de la oficial")
    # mismo valor repetido a la hora que anotó el observador: no es error
    A.loc[A["momento"] == pd.Timestamp("2026-11-10 08:10"), "T"] = 3.4
    no_alerta(S.extremas(T, mala, A, "330020", None, of), "SEXH", "TnAM repetida a la hora anotada")


def prueba_sexf_y_resumen():
    """SEXF: solo avisa si la máxima AM no se ingresó; el resumen diario con 322 °C se descarta y se informa aparte."""
    import dmc
    t0 = pd.Timestamp("2026-11-10 00:00")
    m = pd.date_range(t0 - pd.Timedelta(hours=26) + pd.Timedelta(minutes=1), t0, freq="1min")
    A = pd.DataFrame({"momento": m, "T": 15.0, "rr1m": 0.0})
    A.loc[A["momento"] == pd.Timestamp("2026-11-09 05:30"), "T"] = 25.0       # máxima AM (00–12 UTC del 9)
    A.loc[A["momento"] == pd.Timestamp("2026-11-09 20:00"), "T"] = 20.0       # máxima PM, más baja
    t12 = t0 - pd.Timedelta(hours=12)
    con = {t12: {"TxAM": {"TxAM": 25.0, "FechaHora": "2026-11-09 02:30:00"}}, t0: {}}
    no_alerta(S.extremas(t0, con[t0], A, "330020", con, None), "SEXF", "Tmax AM ya reportada en su bloque")
    sin = {t12: {}, t0: {}}
    r = reglas(S.extremas(t0, sin[t0], A, "330020", sin, None), "SEXF")
    if not r or "Tmax AM" not in r[0][3] or "TxAM" in r[0][3]:
        FALLAS.append(f"SEXF sin ingresar debía avisar con «Tmax AM» → {r}")
    js = {"datos": {"temperaturaExtremas": {"10-11-2026": {"maxima": {"valor": "322.0", "momento": "2026-11-09 05:30:00"},
                                                          "minima": {"valor": "14.0", "momento": "2026-11-09 03:00:00"}}}}}
    ok, mal = dmc.validar_extremas(dmc.extremas_oficiales(js), A)
    if [x["tipo"] for x in mal] != ["max"] or [x["tipo"] for x in ok] != ["min"]:
        FALLAS.append(f"resumen diario: 322 °C debía descartarse → ok={ok} mal={mal}")


def prueba_columnas_ingresado_y_c41():
    """Las alertas traen «ingresado» y «deberia»; C41 usa el nombre según el caso (Td > Ts / HR que no calza)."""
    t = pd.Timestamp("2026-11-12 18:00")
    A = minutario(t, horas=2, T=10.0, Td=8.0, HR=87.0)
    h = S.revisar("330020", {t: obs(Ts=10.0, Td=8.0, HR=50)}, A, horas=1)
    r = [x for x in h if x["regla"] == "C41H"]
    if not r or "HR 87" not in r[0].get("deberia", "") or "HR 50" not in r[0].get("ingresado", ""):
        FALLAS.append(f"C41H: HR 50 con Ts 10 y Td 8 debía dar «HR 87» y mostrar lo ingresado → {r}")
    if any(x["regla"] == "C41" for x in h):
        FALLAS.append("C41 (Td mayor que Ts) no corresponde cuando Td < Ts")
    h = S.revisar("330020", {t: obs(Ts=10.0, Td=11.5, HR=87)}, A, horas=1)
    r = [x for x in h if x["regla"] == "C41"]
    if not r or not r[0].get("deberia", "").startswith("Td 8.0"):
        FALLAS.append(f"C41: Td 11.5 con Ts 10 y sensor Td 8.0 debía dar «Td 8.0» → {r}")


def prueba_tiempo_pasado_sin_hora_propia():
    """E10: el ww y el METAR de la propia hora son tiempo presente: no cuentan para W1 W2. Intermedias 3 h, principales 6 h."""
    t = pd.Timestamp("2026-11-13 09:00")
    previas = {t - pd.Timedelta(hours=k): obs(ww=0, W=(2, 0)) for k in (1, 2, 3)}
    solo_hoy = {**previas, t: obs(ww=50, metar=(1,), W=(2, 0))}
    h = [(x["hora"], x["regla"], x["nivel"]) for x in S.revisar("330020", solo_hoy, None, horas=1)]
    no_alerta(h, "E10", "llovizna solo en la hora de la observación (tiempo presente)")
    con_previa = {**previas, t - pd.Timedelta(hours=2): obs(ww=50, W=(2, 0)), t: obs(ww=0, W=(2, 0))}
    h = [(x["hora"], x["regla"], x["nivel"]) for x in S.revisar("330020", con_previa, None, horas=1)]
    si_alerta(h, "E10", "llovizna a las 07 y W1 2 en la observación de las 09")
    t6 = pd.Timestamp("2026-11-13 12:00")
    seis = {t6 - pd.Timedelta(hours=k): obs(ww=0, W=(2, 0)) for k in range(1, 7)}
    seis[t6 - pd.Timedelta(hours=5)] = obs(ww=61, W=(2, 0))
    seis[t6] = obs(ww=0, W=(2, 0))
    h = [(x["hora"], x["regla"], x["nivel"]) for x in S.revisar("330020", seis, None, horas=1)]
    si_alerta(h, "E10", "lluvia 5 h antes en una principal (período de 6 h)")
    seis3 = dict(seis); seis3[t6 - pd.Timedelta(hours=5)] = obs(ww=0, W=(2, 0)); seis3[t6 - pd.Timedelta(hours=7)] = obs(ww=61, W=(2, 0))
    h = [(x["hora"], x["regla"], x["nivel"]) for x in S.revisar("330020", seis3, None, horas=1)]
    no_alerta(h, "E10", "lluvia 7 h antes: fuera del período de 6 h")


def prueba_extremas_empate_sin_aviso_de_hora():
    """Si la mínima real se repite en dos horas del minutario y no hay hora oficial, no se avisa por la hora (SEXH); si no hay empate, sí."""
    t = pd.Timestamp("2026-11-13 12:00")
    def caso(minutos_min):
        A = minutario(t, horas=12, T=5.0)
        for m in minutos_min:
            A.loc[A["momento"] == m, "T"] = 0.0
        o = obs(TnAM=None)
        o["TnAM"] = {"TnAM": 0.0, "FechaHora": "2026-11-13 04:00:00"}      # hora local 04:00 = 07:00 UTC: en ese minuto la estación marcaba 5.0
        return [(x["hora"], x["regla"], x["nivel"]) for x in S.revisar("330019", {t: o}, A, horas=1)]
    no_alerta(caso([pd.Timestamp("2026-11-13 09:02"), pd.Timestamp("2026-11-13 09:41")]), "SEXH", "mínima empatada en 09:02 y 09:41")
    si_alerta(caso([pd.Timestamp("2026-11-13 09:02")]), "SEXH", "mínima en un solo minuto y hora anotada distinta")


def prueba_reglas_saclim_activas():
    """Los Controles Definidos de SACLIM (reglas_sistema.json) siguen cargados y siguen avisando dentro de revisar()."""
    if len(S._COMP) < 300:
        FALLAS.append(f"reglas SACLIM: solo {len(S._COMP)} reglas compiladas")
    t = pd.Timestamp("2026-11-12 18:00")
    h = S.revisar("330020", {t: {"Ts": {"Ts": 10.0}, "Td": {"Td": 12.0}}}, None, horas=1)
    if not [x for x in h if x["tipo"] == "sistema"]:
        FALLAS.append(f"reglas SACLIM: Td 12 con Ts 10 debía avisar una regla del sistema → {[x['regla'] for x in h]}")


# ----------------------------------------------------------------- estaciones automáticas
def _ema(horas, **cols):
    m = pd.date_range(T - pd.Timedelta(hours=horas) + pd.Timedelta(minutes=1), T, freq="1min")
    base = dict(codigo="1", momento=m, T=15.0, Td=5.0, HR=50.0, P_est=955.0, rr1m=0.0, ff10=5.0, dd10=180.0, Rad=0.0)
    base.update(cols)
    D = pd.DataFrame(base)
    D["T"] = D["T"] + (D.index % 7) * 0.1; D["Td"] = D["Td"] + (D.index % 5) * 0.1; D["P_est"] = D["P_est"] + (D.index % 3) * 0.1
    return D


def prueba_ema_hr_pegada():
    import pruebas as P
    no_alerta([("", a["prueba"], a["nivel"]) for a in P.pegados(_ema(9)) if a["var"] == "HR"], "pegado", "HR quieta 9 h")
    si_alerta([("", a["prueba"], a["nivel"]) for a in P.pegados(_ema(11)) if a["var"] == "HR"], "pegado", "HR quieta 11 h")


def prueba_ema_rango_zona():
    import pruebas as P
    E = pd.DataFrame([dict(codigo="1", lat=-20.5, alt=10)])            # norte costero: 5 a 38 °C
    si_alerta([("", a["prueba"], a["nivel"]) for a in P.rango_zona(_ema(1, T=2.0, P_est=1010.0), E)], "rango", "Ts 2 °C en el norte costero", nivel=1)
    no_alerta([("", a["prueba"], a["nivel"]) for a in P.rango_zona(_ema(1, P_est=1010.0), E)], "rango", "Ts 15 °C en el norte costero")


def prueba_ema_episodio():
    import episodios as EP, tempfile
    d = tempfile.mkdtemp()
    al = [dict(codigo="1", prueba="rango", var=v, nivel=2, momento=str(T), valor=1, ref=None, msg="x") for v in ("T", "HR")]
    r, _ = EP.agrupar(al, d, T)
    if len(r) != 1 or "termohigrómetro" not in r[0]["msg"]:
        FALLAS.append(f"episodio: Ts y HR debían ir en un solo aviso del termohigrómetro → {r}")
    _, fin = EP.agrupar([], d, T + pd.Timedelta(hours=2))
    if len(fin) != 1 or fin[0]["episodio"]["sigue"]:
        FALLAS.append(f"episodio: debía terminar al no verse → {fin}")


def prueba_productos_extremas_y_lluvia():
    import productos as PR, tempfile, gzip, json
    from datetime import datetime, timezone
    d = Path(tempfile.mkdtemp())
    ahora = datetime(2026, 11, 13, 20, 5, tzinfo=timezone.utc)           # 17:05 en Santiago (UTC-3)
    filas = ["codigo,momento,T,fx10,rr1m"]
    for h in range(3, 20):                                                 # 00:00 local = 03:00 UTC
        for m in range(0, 60, 10):
            t = f"2026-11-13 {h:02d}:{m:02d}:00"
            filas += [f"A,{t},{15 + (h - 3) / 2},20,0", f"B,{t},10,,0", f"C,{t},{40 if (h, m) == (12, 30) else 12},,0"]   # C: pico aislado de 40 °C
    for h in range(3, 20):
        g = d / "ema" / f"2026/11/13/{h:02d}.csv.gz"; g.parent.mkdir(parents=True, exist_ok=True)
        g.write_bytes(gzip.compress(("\n".join([filas[0]] + [x for x in filas[1:] if f",2026-11-13 {h:02d}:" in x]) + "\n").encode()))
    r = PR.extremas_dia(str(d), ahora)["hoy"]
    if [x["cod"] for x in r["tx"]][:1] != ["A"] or r["tx"][0]["valor"] != 23.0:
        FALLAS.append(f"productos: la máxima debía ser A 23.0 → {r['tx'][:2]}")
    if any(x["cod"] == "C" and x["valor"] > 20 for x in r["tx"]):
        FALLAS.append("productos: el pico aislado de 40 °C no debía entrar al ranking")
    if not r["racha"] or r["racha"][0]["cod"] != "A":
        FALLAS.append(f"productos: la racha debía ser de A → {r['racha']}")
    sen = {"A": {h: {"RRR6": {"RRR6": v, "Traza": 0}} for h, v in (("18", 0.0), ("00", 1.2), ("06", 0.0), ("12", 0.4))}}
    for dia, hs in (("2026/11/12", ("18",)), ("2026/11/13", ("00", "06", "12"))):
        (d / "sensorial" / dia).parent.mkdir(parents=True, exist_ok=True)
        (d / "sensorial" / (dia + ".json.gz")).write_bytes(gzip.compress(json.dumps({"A": {h: sen["A"][h] for h in hs}}).encode()))
    l = PR.lluvia_observador(str(d), ahora)
    if len(l["filas"]) != 1 or l["filas"][0]["total"] != 1.6 or l["filas"][0]["estado"] != "sin referencia":
        FALLAS.append(f"productos: lluvia con observador debía sumar 1.6 mm sin referencia → {l['filas']}")


def prueba_completar_huecos():
    import numpy as np, completar as CP
    ix = pd.date_range("2020-01-01", periods=24 * 365 * 3, freq="h")
    ciclo = 15 + 6 * np.sin((ix.hour - 9) / 24 * 2 * np.pi)
    S = pd.DataFrame({"Ts": ciclo, "Td": ciclo - 5, "HR": 60.0, "QFE": 1000.0, "QFF": 1010.0, "ff": 5.0, "RRR6": 0.0}, index=ix)
    i = 24 * 200 + 8
    S.iloc[i:i + 6] = np.nan                       # hueco de 6 h: se completa
    S.iloc[i + 100:i + 115] = np.nan               # hueco de 15 h: no se completa
    D = CP.completar(S)
    d = D[D.fecha < ix[i + 50]]
    if sorted(d["var"].unique()) != ["HR", "QFE", "QFF", "Td", "Ts"] or len(d) != 30:
        FALLAS.append(f"completar: hueco de 6 h debía dar Ts, Td, HR, QFE y QFF (sin ff ni RRR6) → {d['var'].value_counts().to_dict()}")
    ts = d[d["var"] == "Ts"].set_index("fecha")["valor"]
    if np.abs(ts.to_numpy() - np.asarray(ciclo[i:i + 6])).max() > 0.3:
        FALLAS.append("completar: Ts debía seguir el ciclo diario")
    if D.fecha.between(ix[i + 100], ix[i + 114]).any():
        FALLAS.append("completar: un hueco de 15 h no debe completarse")
    S2 = S.copy(); S2.iloc[:5] = np.nan
    if len(CP.completar(S2)[lambda x: x.fecha < ix[5]]):
        FALLAS.append("completar: sin dato antes del hueco no se completa")


def prueba_neblina_metar_visibilidad():
    """Neblina (BR) con 6000 m: en SACLIM no hay regla de 5000 m, la visibilidad se ingresa tal cual (no avisa); sí avisa sobre 8000 m y bajo 1000 m."""
    import sensorial as SEN
    def obs(vv):
        return {"WWMETAR": {"FEN1": 9, "FEN12": "SD", "FEN13": "SD", "FEN2": "SD", "FEN22": "SD", "FEN23": "SD", "FEN3": "SD", "FEN32": "SD", "FEN33": "SD", "DESC": "SD", "DESC2": "SD", "DESC3": "SD", "IntProx": 2, "IntProx2": "SD", "IntProx3": "SD"},
                "VVMETAR": {"Dv": "SD", "Minima": "SD", "Reinante": vv}}
    mal = lambda vv: [x for x in SEN.reglas_sistema(obs(vv)) if str(x[1]) in ("2972", "3102")] + [x for x in SEN.codificacion(obs(vv)) if x[1] == "C02"]
    if mal(6000):
        FALLAS.append(f"neblina METAR: con 6000 m no debía avisar → {mal(6000)}")
    if not any(x[1] == "C02" for x in mal(9000)) or not any(x[1] == "C02" for x in mal(800)):
        FALLAS.append("neblina METAR: debía avisar con 9000 m y con 800 m")


def prueba_metar_nieve_respalda_w1():
    """METAR con chubascos de nieve (DESC 5 SH + FEN 3 SN) respalda W1 8; SN solo respalda 7; RA 6; TS 9."""
    import sensorial as SEN
    def obs(d, f, i=2):
        W = {k: "SD" for k in ("FEN1", "FEN12", "FEN13", "FEN2", "FEN22", "FEN23", "FEN3", "FEN32", "FEN33", "DESC", "DESC2", "DESC3", "IntProx", "IntProx2", "IntProx3")}
        W.update({"FEN1": f, "DESC": d, "IntProx": i}); return {"WWMETAR": W}
    if SEN.metar_grupos(obs(5, 3)) != ["SHSN"] or SEN.fen_w(obs(5, 3)) != [(8, "SHSN")]:
        FALLAS.append(f"METAR SHSN: {SEN.metar_grupos(obs(5, 3))} {SEN.fen_w(obs(5, 3))}")
    if SEN.fen_w(obs("SD", 3)) != [(7, "SN")] or SEN.fen_w(obs("SD", 2)) != [(6, "RA")] or SEN.fen_w(obs(6, 2)) != [(9, "TSRA")]:
        FALLAS.append("METAR: SN→7, RA→6, TSRA→9")


if __name__ == "__main__":
    pruebas = [f for k, f in sorted(globals().items()) if k.startswith("prueba_")]
    for f in pruebas:
        try:
            f()
        except Exception as e:                  # una prueba que se cae también es falla
            FALLAS.append(f"{f.__name__}: error {type(e).__name__}: {e}")
    if FALLAS:
        print("FALLAN:\n  " + "\n  ".join(FALLAS))
        sys.exit(1)
    print(f"{len(pruebas)} pruebas fijas OK")
