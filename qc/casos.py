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
def obs(ww=None, metar=(), CL=None, capas=(), N=None, VV=None, rr6=None, traza=None, W=None):
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
    return o


def minutario(t, horas=6, lluvia=None):
    """Minutario de la automática: horas previas a t, sin lluvia salvo {minuto (Timestamp): mm}."""
    m = pd.date_range(t - pd.Timedelta(hours=horas) + pd.Timedelta(minutes=1), t, freq="1min")
    A = pd.DataFrame({"momento": m, "rr1m": 0.0})
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
