"""Control de las observaciones de las estaciones con observador (servicio getRecientesSaclim).

Tres niveles:
  sistema      las reglas de control del sistema de ingreso (reglas_sistema.json), evaluadas sobre lo grabado
  codificacion reglas de codificación (OMM / manual) que el sistema no exige
  evolucion    coherencia con las horas anteriores (W1W2, RRR6, tendencia, niebla, nubosidad, precipitación)
  sensor       lo anotado frente a la estación automática del mismo lugar

No se guarda ni se muestra el identificador del observador.
"""
import math
import json, math, re
from pathlib import Path
import numpy as np
import pandas as pd

AQUI = Path(__file__).parent
REGLAS = json.loads((AQUI / "reglas_sistema.json").read_text(encoding="utf-8"))
SD = "SD"     # valor ingresado como "Sin Dato"


# ======================================================================= lectura
def _num(v):
    if v is None or v == "":
        return None
    try:
        x = float(v)
        return int(x) if x.is_integer() else x
    except (TypeError, ValueError):
        return v


def leer(js):
    """Devuelve {momento (Timestamp): {Elemento: {componente: valor | 'SD'}}} solo con lo que el observador ingresó."""
    nombres = {k: v.get("elementoNombreCorto") for k, v in (js.get("datosElementos") or {}).items()}
    obs = {}
    for bloque in js.get("datos") or []:
        for t, h in (bloque or {}).items():
            d = (h or {}).get("datos") or {}
            o = {}
            for eid, lineas in d.items():
                el = nombres.get(eid)
                if not el:
                    continue
                for comps in (lineas or {}).values():
                    for cn, c in (comps or {}).items():
                        if c.get("SinDato") is None:          # elemento no aplicable a esta hora
                            continue
                        o.setdefault(el, {})[cn] = SD if c.get("SinDato") else _num(c.get("valor"))
                        if c.get("RevisadoQA"):
                            o.setdefault("_qa", set()).add(el)
            if o:
                obs[pd.Timestamp(t)] = o
    return dict(sorted(obs.items()))


def v(o, el, comp=None):
    """Valor numérico o None (Sin Dato o no ingresado)."""
    x = (o.get(el) or {}).get(comp or el)
    return None if x == SD or isinstance(x, str) else x


def ingresado(o, el, comp=None):
    return (comp or el) in (o.get(el) or {})


OBSERVADOR = ("WWSINOP", "W1W2", "Nubes", "N", "CapaNube")


def importada(o):
    """Observación cargada por un proceso de importación (solo datos de sensor, sin nada que ingrese un observador:
    tiempo presente/pasado ni nubosidad). En esas no se puede exigir coherencia con ww, W1W2 o METAR."""
    return not any(el in o for el in OBSERVADOR)


def es_sd(o, el, comp=None):
    return (o.get(el) or {}).get(comp or el) == SD


# ======================================================================= reglas del sistema
class _V:
    """Valor que, si falta, hace falsas todas las comparaciones (como un dato ausente)."""
    def __init__(self, x): self.x = x
    JS = False        # el dato faltante se compara como en JavaScript (null < 1 es verdadero, null == 0 es falso)
    COMODIN = False   # el dato faltante cumple cualquier comparación (beneficio de la duda)
    def _c(self, o, f, igualdad=False):
        a, b = self.x, (o.x if isinstance(o, _V) else o)
        a = None if isinstance(a, str) else a
        b = None if isinstance(b, str) else b
        if a is None or b is None:
            if _V.COMODIN:
                return True
            if not _V.JS:
                return False
            if igualdad:
                return f(a, b)
            a, b = a or 0, b or 0
        return f(a, b)
    __eq__ = lambda s, o: s._c(o, lambda a, b: a == b, True)
    __ne__ = lambda s, o: s._c(o, lambda a, b: a != b, True)
    __lt__ = lambda s, o: s._c(o, lambda a, b: a < b)
    __le__ = lambda s, o: s._c(o, lambda a, b: a <= b)
    __gt__ = lambda s, o: s._c(o, lambda a, b: a > b)
    __ge__ = lambda s, o: s._c(o, lambda a, b: a >= b)
    def _a(self, o, f):
        a, b = self.x, (o.x if isinstance(o, _V) else o)
        return _V(None if a is None or b is None or isinstance(a, str) or isinstance(b, str) else f(a, b))
    __add__ = lambda s, o: s._a(o, lambda a, b: a + b)
    __radd__ = lambda s, o: s._a(o, lambda a, b: b + a)
    __sub__ = lambda s, o: s._a(o, lambda a, b: a - b)
    __rsub__ = lambda s, o: s._a(o, lambda a, b: b - a)
    __mul__ = lambda s, o: s._a(o, lambda a, b: a * b)
    __rmul__ = lambda s, o: s._a(o, lambda a, b: b * a)
    __truediv__ = lambda s, o: s._a(o, lambda a, b: a / b if b else None)
    __rtruediv__ = lambda s, o: s._a(o, lambda a, b: b / a if a else None)
    __pow__ = lambda s, o: s._a(o, lambda a, b: a ** b)
    def __bool__(self): return bool(self.x) and not isinstance(self.x, str)
    def __hash__(self): return hash(self.x)


def _en(x, lista):
    x = x.x if isinstance(x, _V) else x
    return x is not None and not isinstance(x, str) and x in lista


def _round(x):
    x = x.x if isinstance(x, _V) else x
    return _V(None if x is None or isinstance(x, str) else math.floor(x + 0.5))


def _abs(x):
    x = x.x if isinstance(x, _V) else x
    return _V(None if x is None or isinstance(x, str) else abs(x))


_REF = re.compile(r"(#?)\b([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)\b")


def _compilar(f):
    refs, conhash = set(), set()
    def rep(m):
        refs.add((m.group(2), m.group(3)))
        if m.group(1):
            conhash.add((m.group(2).lower(), m.group(3).lower()))
        return f'_S("{m.group(2)}","{m.group(3)}")' if m.group(1) else f'_G("{m.group(2)}","{m.group(3)}")'
    s = _REF.sub(rep, f)
    s = re.sub(r"(\S+|\([^()]*\))\s+[Ii]n\s*\(([^)]*)\)", lambda m: f"_EN({m.group(1)},({m.group(2).replace(';', ',')},))", s)
    s = s.replace("<>", "!=").replace("^", "**")
    s = re.sub(r"(?<![<>!=])=(?!=)", "==", s)
    s = re.sub(r"\bROUND\(|\bRound\(", "_R(", s)
    s = re.sub(r"\bABS\(|\bAbs\(", "_A(", s)
    if "TotalTriple" in s or "[" in s:
        return None, refs, conhash
    try:
        return compile(s, "<regla>", "eval"), refs, conhash
    except SyntaxError:
        return None, refs, conhash


_COMP = [(r, *_compilar(r["f"])) for r in REGLAS if r.get("vig")]


def reglas_sistema(o):
    """Reglas del sistema que falla la observación grabada. Solo se evalúan si todos sus elementos están en la observación."""
    claves = {(el.lower(), c.lower()) for el, cs in o.items() if el != "_qa" for c in cs}
    sinDato = {(el.lower(), c.lower()) for el, cs in o.items() if el != "_qa" for c, x in cs.items() if x == SD}
    def G(el, c):
        x = (o.get(el) or {}).get(c)
        if x is None:
            for e2, cs in o.items():
                if e2 != "_qa" and e2.lower() == el.lower():
                    for c2, val in cs.items():
                        if c2.lower() == c.lower():
                            x = val
        return _V(None if x == SD else x)
    def S(el, c):
        for e2, cs in o.items():
            if e2 != "_qa" and e2.lower() == el.lower():
                for c2, val in cs.items():
                    if c2.lower() == c.lower():
                        return val == SD
        return False
    env = {"_G": G, "_S": S, "_EN": _en, "_R": _round, "_A": _abs}
    out = []
    for r, code, refs, conhash in _COMP:
        if code is None or not refs or not all((e.lower(), c.lower()) in claves for e, c in refs):
            continue
        # si la regla no contempla "Sin Dato" (#) en un campo que está Sin Dato, no se aplica
        if any((e.lower(), c.lower()) in sinDato and (e.lower(), c.lower()) not in conhash for e, c in refs):
            continue
        try:
            ok = bool(eval(code, {"__builtins__": {}}, env))
            if not ok:                    # se confirma también como lo evalúa el sistema (dato faltante = null)
                _V.JS = True
                ok = bool(eval(code, {"__builtins__": {}}, env))
            if not ok:                    # y que falle sea cual sea el valor de los campos Sin Dato
                _V.JS, _V.COMODIN = False, True
                ok = bool(eval(code, {"__builtins__": {}}, env))
        except Exception:
            continue
        finally:
            _V.JS = _V.COMODIN = False
        if not ok:
            out.append(("sistema", r["id"], 2 if r.get("obl") else 1, r["m"].replace("ERROR :", "").strip()))
    return out


# ======================================================================= utilidades de clave
def categoria_W(ww):
    """Cifra de tiempo pasado (W) que corresponde a un ww del período."""
    if ww is None:
        return None
    if ww >= 95 or ww in (17, 29, 91, 92, 93, 94):
        return 9
    if 80 <= ww <= 90 or ww in (25, 26, 27):
        return 8
    if 70 <= ww <= 79 or ww in (22, 23):
        return 7
    if 60 <= ww <= 69 or ww == 21:
        return 6
    if 50 <= ww <= 59 or ww in (20, 24):      # 24 engelante: W 5 o 6 (se usa la cota inferior)
        return 5
    if 40 <= ww <= 49 or ww == 28:
        return 4
    if 30 <= ww <= 39:
        return 3
    return None


# fenómenos METAR en SACLIM (WWMETAR FEN1..FEN3x): código → sigla (vistos en el servicio)
FEN_METAR = {1: "DZ", 2: "RA", 9: "BR", 10: "FG", 15: "HZ"}
FEN_W = {"DZ": 5, "RA": 6, "FG": 4}                     # categoría de tiempo pasado (W) que respalda cada fenómeno


CL_CONV = (1, 2, 3, 8, 9)      # CL con cúmulos o cumulonimbos
NOM_C = {0: "Ci", 1: "Cc", 2: "Cs", 3: "Ac", 4: "As", 5: "Ns", 6: "Sc", 7: "St", 8: "Cu", 9: "Cb", 10: "TCu"}
PIE = 3.281


def fen_metar(o):
    """Siglas de los fenómenos METAR ingresados en esa hora."""
    out = []
    for k in ("FEN1", "FEN12", "FEN13", "FEN2", "FEN22", "FEN23", "FEN3", "FEN32", "FEN33"):
        x = v(o, "WWMETAR", k)
        if x is not None:
            out.append(FEN_METAR.get(int(x), f"código {int(x)}"))
    return out


PRECIP = set(range(50, 100)) - {76, 77, 78}           # precipitación en la estación (ww 76 cristales: no siempre se mide)
VIS_SYNOP = set(range(0, 5001, 100)) | set(range(6000, 30001, 1000)) | set(range(35000, 70001, 5000)) | {70000, 75000, 80000, 90000}


# ======================================================================= codificación (una hora)
def _es(T): return 6.112 * math.exp(17.62 * T / (243.12 + T))
def hr_de(T, Td): return 100 * _es(Td) / _es(T)
def td_de(T, HR):
    g = math.log(max(HR, 0.1) / 100) + 17.62 * T / (243.12 + T)
    return 243.12 * g / (17.62 - g)


def codificacion(o):
    out = []
    add = lambda cod, niv, msg: out.append(("codificacion", cod, niv, msg))
    ww, VV, N = v(o, "WWSINOP", "ww"), v(o, "VVSINOP", "VV"), v(o, "N")
    CL, CM, CH, Nh = v(o, "Nubes", "Cl"), v(o, "Nubes", "Cm"), v(o, "Nubes", "Ch"), v(o, "Nubes", "Nh")
    HR, Ts, Td = v(o, "HR"), v(o, "Ts"), v(o, "Td")
    if VV is not None and ww is not None:
        if 42 <= ww <= 49 and VV >= 1000:
            add("C01", 2, f"niebla en la estación (ww {ww}) con visibilidad de {VV} m: la niebla exige menos de 1000 m")
        if ww == 10 and VV < 1000:
            add("C02", 2, f"neblina (ww 10) con visibilidad de {VV} m: con menos de 1000 m es niebla")
        if ww == 10 and VV > 5000:
            add("C02", 1, f"neblina (ww 10) con visibilidad de {VV} m: la neblina se informa hasta 5000 m")
        if ww in (4, 5) and VV > 5000:
            add("C03", 1, f"humo o calima (ww {ww:02d}) con visibilidad de {VV} m: se informa con 5000 m o menos")
        if ww in (11, 12) and VV < 1000:
            add("C04", 1, f"niebla baja (ww {ww}) con visibilidad de {VV} m: si la visibilidad es menor de 1000 m es niebla (40–49)")
        if VV < 1000 and ww < 40 and ww not in PRECIP and ww not in (4, 6, 7, 8, 9, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39):
            add("C05", 1, f"visibilidad de {VV} m sin un fenómeno que la explique (ww {ww:02d})")
    if VV is not None and ww is not None and 1000 <= VV < 5000 and ww <= 3:
        sug = "neblina (10)" if (HR or 0) >= 80 else "bruma o calima (05)"
        add("C33", 2, f"visibilidad de {VV} m con ww {ww:02d} (sin fenómeno): con menos de 5000 m debe informarse lo que la reduce, p. ej. {sug} o precipitación")
    fm = fen_metar(o)
    if ww is not None and fm:
        if ("DZ" in fm or "RA" in fm) and not (ww in PRECIP or 20 <= ww <= 29 or 13 <= ww <= 16):
            add("C34", 2, f"el METAR informa {'/'.join(f for f in fm if f in ('DZ', 'RA'))} y el SYNOP ww {ww:02d} no tiene precipitación")
        if "BR" in fm and ww not in (10,) and ww < 10:
            add("C35", 1, f"el METAR informa BR (neblina) y el SYNOP ww {ww:02d}: correspondería ww 10 si no hay otro fenómeno más importante")
        if "FG" in fm and not 40 <= ww <= 49 and ww not in (11, 12, 28):
            add("C36", 2, f"el METAR informa FG (niebla) y el SYNOP ww {ww:02d} no es niebla (40–49)")
        if "HZ" in fm and ww < 4:
            add("C37", 1, f"el METAR informa HZ (calima) y el SYNOP ww {ww:02d}: correspondería ww 05")
    if VV is not None and VV not in VIS_SYNOP:
        add("C06", 1, f"visibilidad {VV} m no se puede cifrar en SYNOP (pasos de 100 m hasta 5 km y de 1 km hasta 30 km)")
    if ww == 10 and HR is not None and HR < 60:
        add("C07", 1, f"neblina (ww 10) con humedad de {HR} %: la neblina es con aire húmedo")
    if ww == 5 and HR is not None and HR >= 90:
        add("C08", 1, f"calima (ww 05) con humedad de {HR} %: con aire tan húmedo es neblina")
    if ww is not None and CL is not None and N not in (9, None):
        if 50 <= ww <= 59 and CL in (1, 2, 3, 9):
            add("C09", 1, f"llovizna (ww {ww}) con nubes bajas cumuliformes (CL {CL}): la llovizna cae de St o Sc")
        if 80 <= ww <= 90 and CL not in (2, 3, 8, 9):
            add("C10", 1, f"chubasco (ww {ww}) sin cúmulos de desarrollo ni cumulonimbos (CL {CL})")
        if (ww >= 95 or ww == 17) and CL not in (3, 9):
            add("C11", 1, f"tormenta (ww {ww}) sin cumulonimbo (CL {CL})")
        if ww in (61, 63, 65, 71, 73, 75) and N is not None and N < 7:
            add("C12", 1, f"precipitación continua (ww {ww}) con N {N}: la precipitación continua es con cielo cubierto")
    if ww is not None and Ts is not None:
        if 50 <= ww <= 69 and ww not in (56, 57, 66, 67) and Ts < -3:
            add("C13", 1, f"llovizna o lluvia líquida (ww {ww}) con {Ts} °C: correspondería engelante o nieve")
    # nubosidad
    capas = [(v(o, "CapaNube", f"Ns{s}"), v(o, "CapaNube", f"C{s}"), v(o, "CapaNube", f"hshshs{s}")) for s in ("", "2", "3", "4", "5", "6")]
    capas = [c for c in capas if c[0] is not None]
    if N == 0 and capas:
        add("C14", 2, "N 0 (despejado) con capas de nubes ingresadas")
    if N is not None and N not in (9,) and capas and max(c[0] for c in capas) > N:
        add("C15", 2, f"una capa tiene más octas ({max(c[0] for c in capas)}) que la nubosidad total N {N}")
    if N is not None and 0 < N <= 8 and not capas and not es_sd(o, "CapaNube", "Ns"):
        add("C16", 1, f"N {N} sin capas de nubes ingresadas")
    hs = [c[2] for c in capas if c[2] is not None]
    if hs != sorted(hs):
        add("C17", 1, "capas de nubes no ordenadas de la más baja a la más alta")
    # C18: con superposición, N no puede superar la suma de las capas (sí puede ser menor, porque las capas se tapan)
    suma = sum(c[0] for c in capas if c[0] is not None)
    if N is not None and N not in (9,) and capas and N > suma:
        add("C18", 1, f"N {N} mayor que la suma de las capas ({suma} octas): falta una capa o la cantidad de alguna")
    i8 = next((i for i, c in enumerate(capas) if c[0] == 8), None)
    if i8 is not None and i8 < len(capas) - 1:
        add("C19", 1, "hay capas por encima de una capa de 8 octas: con 8 octas no se ven las nubes superiores")
    # altura de las capas en pies en vez de metros (el nefobasímetro/cielómetro entrega pies; hshshs va en metros)
    for Ns_, C_, h_ in capas:
        if h_ is None or C_ is None:
            continue
        if C_ == 7 and h_ > 900:
            add("C38", 1, f"St con base a {h_:g} m: el estrato rara vez pasa de 600 m. Si el dato viene del cielómetro (en pies) serían {h_ / 3.281:.0f} m")
        elif C_ in (5, 6, 8, 9, 10) and h_ > 3000:
            add("C39", 1, f"{NOM_C.get(C_, C_)} con base a {h_:g} m: muy alta para una nube baja. Si el dato viene del cielómetro (en pies) serían {h_ / 3.281:.0f} m")
    # coherencia Ts–Td–HR (fórmula de Magnus, la que usan las estaciones)
    if Ts is not None and Td is not None:
        if Td > Ts + 0.05:
            add("C41", 2, f"Td {Td} °C mayor que Ts {Ts} °C: el punto de rocío no puede superar a la temperatura")
        elif HR is not None:
            hc = hr_de(Ts, Td)
            if abs(hc - HR) > 3:
                add("C41", 2 if abs(hc - HR) > 10 else 1, f"HR {HR:g} %: con Ts {Ts} °C y Td {Td} °C corresponde {hc:.0f} %. "
                    f"Si la HR es correcta, el Td sería {td_de(Ts, HR):.1f} °C; si el Td es correcto, debería ir HR {hc:.0f} %")
    if Nh is not None and N is not None and N != 9 and Nh > N:
        add("C20", 2, f"Nh {Nh} mayor que N {N}")
    # CL con Cu o Cb (1, 2, 3, 8, 9) pero ningún grupo 8NsChshs con C = 8 (Cu) o 9 (Cb)
    if CL in CL_CONV and (capas or (N or 0) > 0) and not any(c[1] in (8, 9) for c in capas):
        add("C40", 1, "El CL indica Cu/Cb pero falta su capa en los grupos 8")
    if CL in (3, 9) and capas and not any(c[1] == 9 for c in capas):
        add("C21", 1, f"CL {CL} (cumulonimbo) sin una capa de Cb")
    if any(c[1] == 9 for c in capas) and CL not in (3, 9):
        add("C22", 1, f"capa de Cb con CL {CL}: con cumulonimbo CL es 3 o 9")
    # tipo de nube frente al fenómeno (capas: 4 As, 5 Ns, 6 Sc, 7 St, 8 Cu, 9 Cb, 10 TCu)
    tipos = {c[1] for c in capas if c[1] is not None}
    if ww is not None and tipos:
        if 80 <= ww <= 90 and CL not in CL_CONV and not tipos & {8, 9, 10}:
            add("C28", 1, f"chubasco (ww {ww}) sin capa de Cu, TCu o Cb: los chubascos caen de nubes convectivas")
        if (ww >= 95 or ww == 17) and 9 not in tipos:
            add("C29", 1, f"tormenta (ww {ww}) sin capa de Cb")
        if (60 <= ww <= 69 or 70 <= ww <= 75) and tipos <= {8, 9, 10} and CM in (0, None):
            add("C30", 1, f"precipitación no chubascosa (ww {ww}) con solo nubes cumuliformes y sin As/Ns: correspondería chubasco (80–86)")
        if 50 <= ww <= 59 and tipos <= {8, 9, 10}:
            add("C31", 1, f"llovizna (ww {ww}) con solo nubes cumuliformes en las capas: la llovizna cae de St o Sc")
    if 10 in tipos and CL not in (2, 3, 9, None):
        add("C32", 1, f"capa de TCu con CL {CL}: el Cu congestus es CL 2 (o 3/9 si hay Cb)")
    for d, nube, nom in (("Dl", CL, "bajas"), ("Dm", CM, "medias"), ("Dh", CH, "altas")):
        dv = v(o, "DirNubes", d)
        if dv not in (None, 0, 9) and nube == 0:
            add("C23", 1, f"dirección de nubes {nom} ({d} {dv}) sin nubes {nom}")
    # viento
    dd, ff, vrb = v(o, "VTO", "dd"), v(o, "VTO", "ff"), v(o, "VTO", "VRB")
    if ff == 0 and dd not in (None, 0):
        add("C24", 2, f"calma (ff 0) con dirección {dd}°: en calma la dirección es 0")
    if ff not in (None, 0) and dd == 0 and vrb != 1:
        add("C25", 2, f"viento de {ff} kt con dirección 0")
    if dd is not None and dd > 360:
        add("C26", 2, f"dirección del viento {dd}°")
    # tiempo pasado
    W1, W2 = v(o, "W1W2", "W1"), v(o, "W1W2", "W2")
    if W1 is not None and W2 is not None and W1 < W2:
        add("C27", 2, f"W1 {W1} menor que W2 {W2}")
    return out


# ======================================================================= valores inusuales (con o sin observador)
LIMITES = {"Ts": (-40, 45, "°C"), "Td": (-50, 35, "°C"), "HR": (1, 100, "%"), "QFE": (500, 1080, "hPa"), "QFF": (900, 1080, "hPa"),
           "QNH": (900, 1080, "hPa")}
SALTO = {"Ts": 6, "Td": 8, "HR": 30, "QFE": 3, "QFF": 3, "QNH": 3}       # cambio en 1 h que, si se devuelve a la hora siguiente, es un pico aislado


def inusuales(t, o, hist, A=None):
    """Valores fuera de lo físicamente posible o picos aislados entre horas. Se aplica a todas las observaciones,
    también a las importadas (ahí no se exige coherencia con ww, pero un valor imposible o un pico sí se avisa)."""
    out = []
    add = lambda cod, niv, msg: out.append(("evolucion", cod, niv, msg))
    for el, (lo, hi, u) in LIMITES.items():
        x = v(o, el)
        if x is not None and not (lo <= x <= hi):
            add("E19", 2, f"{el} {x} {u}: fuera de lo posible ({lo} a {hi} {u})")
    for el in ("RRR6", "RRR1h"):
        x = v(o, el)
        if x is not None and (x < 0 or x > (150 if el == "RRR6" else 60)):
            add("E19", 2, f"{el} {x} mm: valor inusual para {'6 horas' if el == 'RRR6' else 'una hora'}")
    ant, sig = hist.get(t - pd.Timedelta(hours=1)), hist.get(t + pd.Timedelta(hours=1))
    for el, lim in SALTO.items():
        x, xa = v(o, el), v(ant, el) if ant else None
        if x is None or xa is None:
            continue
        xs = v(sig, el) if sig else None
        if abs(x - xa) > lim and xs is None:          # con la hora siguiente disponible, lo revisa digitacion() con toda la secuencia
            add("E19", 1, f"{el} {x}: pasó de {xa} a {x} en una hora")
    return out + digitacion(t, o, hist, A)


# ======================================================================= errores de digitación (secuencia de ±10 h)
DIG_EL = {"Ts": ("Ts", None, 3, "°C"), "Td": ("Td", None, 4, "°C"), "HR": ("HR", None, 15, "%"), "QFE": ("QFE", None, 2, "hPa"),
          "QFF": ("QFF", None, 2, "hPa"), "QNH": ("QNH", None, 2, "hPa"), "ff": ("VTO", "ff", 10, "kt")}


def _variantes(x):
    """Valores que resultan de los errores de tecla típicos sobre lo anotado: un dígito cambiado, dos dígitos vecinos invertidos,
    coma corrida y signo cambiado."""
    dec = 0 if float(x).is_integer() and abs(x) >= 100 or (float(x).is_integer() and "." not in repr(x)) else 1
    txt = f"{abs(x):.{dec}f}"
    neg = x < 0
    out = []
    dig = [i for i, c in enumerate(txt) if c.isdigit()]
    for i in dig:                                         # un dígito cambiado
        for d in "0123456789":
            if d != txt[i]:
                out.append((txt[:i] + d + txt[i + 1:], "un dígito cambiado"))
    for a_, b_ in zip(dig, dig[1:]):                       # dígitos vecinos invertidos (saltando la coma)
        if txt[a_] != txt[b_]:
            l = list(txt); l[a_], l[b_] = l[b_], l[a_]
            out.append(("".join(l), "dígitos invertidos"))
    res = []
    for t_, tipo in out:
        try:
            y = float(t_)
        except ValueError:
            continue
        res.append((-y if neg else y, tipo))
    res += [(x * 10, "coma corrida"), (x / 10, "coma corrida"), (-x, "signo cambiado")]
    return res


COL_SENSOR = {"Ts": "T", "Td": "Td", "HR": "HR", "QFE": "P_est", "QFF": "P_mar", "QNH": "P_std", "ff": "ff10"}


def digitacion(t, o, hist, A=None):
    out = []
    W = A[(A["momento"] > t - pd.Timedelta(minutes=20)) & (A["momento"] <= t)] if A is not None and len(A) else None
    add = lambda cod, niv, msg: out.append(("evolucion", cod, niv, msg))
    for el, (e1, e2, lim, u) in DIG_EL.items():
        x = v(o, e1, e2)
        if x is None:
            continue
        pts = [((k - t) / pd.Timedelta(hours=1), v(h, e1, e2)) for k, h in hist.items() if k != t and abs(k - t) <= pd.Timedelta(hours=10)]
        pts = [(a_, b_) for a_, b_ in pts if b_ is not None]
        antes, desp = [p for p in pts if p[0] < 0], [p for p in pts if p[0] > 0]
        if len(pts) < 5 or not antes or not desp:          # hace falta secuencia a los dos lados
            continue
        X = np.array([p[0] for p in pts]); Y = np.array([p[1] for p in pts])
        grado = 2 if len(pts) >= 7 else 1
        c = np.polyfit(X, Y, grado)
        res = Y - np.polyval(c, X)
        sd = float(np.sqrt(np.mean(res ** 2))) if len(res) > grado + 1 else 0.0
        esp = float(np.polyval(c, 0))
        # interpolación con las horas más cercanas (más fiel que el ajuste si hay un cambio brusco real)
        pa, ps = max(antes), min(desp)
        lin = pa[1] + (ps[1] - pa[1]) * (0 - pa[0]) / (ps[0] - pa[0])
        dev = min(abs(x - esp), abs(x - lin))
        umbral = max(lim, 4 * sd)
        if dev <= umbral:
            continue
        col = COL_SENSOR.get(el)
        if W is not None and col in W and W[col].notna().any():   # si la estación automática marcó ese valor, fue real
            if (W[col] - x).abs().min() <= lim / 3 or (el in ("QFE", "QFF", "QNH") and abs(x - float(W[col].median())) <= 1.5):
                continue
        ref = esp if abs(x - esp) < abs(x - lin) else lin
        tol = max(lim / 2, 2 * sd)
        cand = [(abs(y - ref), y, tipo) for y, tipo in _variantes(x) if abs(y - ref) <= tol]
        orden = {"dígitos invertidos": 0, "signo cambiado": 1, "coma corrida": 2, "un dígito cambiado": 3}
        fmt = (lambda y: f"{y:.0f}") if el in ("HR", "ff") else (lambda y: f"{y:.1f}")
        if cand:
            cand.sort(key=lambda c_: (round(c_[0] / max(tol, 1e-9), 1), orden[c_[2]]))
            _, y, tipo = cand[0]
            add("E20", 2, f"{el} {x} {u}: la secuencia de las horas vecinas esperaba ~{fmt(ref)} {u}. Parece {tipo} "
                f"({fmt(x)} en vez de {fmt(y)}). Debería ir: {fmt(y)} {u}")
        elif dev > 2 * umbral:
            add("E20", 1, f"{el} {x} {u}: se sale de la secuencia de las horas vecinas (esperado ~{fmt(ref)} {u}, "
                f"{len(antes)} horas antes y {len(desp)} después); no lo explica un error de tecla simple")
    return out


# ======================================================================= evolución (con las horas anteriores)
def evolucion(t, o, hist, A=None):
    """hist: {momento: obs} de la misma estación (incluye t)."""
    out = inusuales(t, o, hist, A)
    add = lambda cod, niv, msg: out.append(("evolucion", cod, niv, msg))
    ant = hist.get(t - pd.Timedelta(hours=1))
    ww, N, VV = v(o, "WWSINOP", "ww"), v(o, "N"), v(o, "VVSINOP", "VV")
    if ant:
        wa, Na, VVa = v(ant, "WWSINOP", "ww"), v(ant, "N"), v(ant, "VVSINOP", "VV")
        if wa is not None and ww is not None:
            if wa in PRECIP and ww < 20 and ww not in (17,):
                add("E01", 1, f"a la hora anterior había precipitación (ww {wa}) y ahora ww {ww:02d}: si terminó en la última hora corresponde ww 20–27")
            cla, cl = v(ant, "Nubes", "Cl"), v(o, "Nubes", "Cl")
            if 50 <= wa <= 59 and 80 <= ww <= 90 and cla == cl and cl not in (2, 3, 9):
                add("E03", 1, f"pasó de llovizna (ww {wa}) a chubasco (ww {ww}) con las mismas nubes bajas (CL {cl}) y sin cúmulos de desarrollo")
            if 80 <= wa <= 90 and ww in (61, 63, 65) and cla == cl and cl in (1, 2, 3, 9):
                add("E04", 1, f"pasó de chubasco (ww {wa}) a lluvia continua (ww {ww}) sin cambiar las nubes bajas (CL {cl})")
            if 42 <= ww <= 47 and VV is not None and VVa is not None and VVa > 0:
                cambio = (VV - VVa) / VVa
                if ww in (42, 43) and cambio < -0.2:
                    add("E05", 1, f"ww {ww} (la niebla se adelgazó) pero la visibilidad bajó de {VVa} a {VV} m")
                if ww in (46, 47) and cambio > 0.2:
                    add("E06", 1, f"ww {ww} (la niebla se espesó) pero la visibilidad subió de {VVa} a {VV} m")
        if ww in (1, 3) and N is not None and Na is not None:
            if ww == 1 and N > Na:
                add("E07", 1, f"ww 01 (las nubes se disuelven) pero N subió de {Na} a {N}")
            if ww == 3 and N < Na:
                add("E08", 1, f"ww 03 (las nubes se forman) pero N bajó de {Na} a {N}")
        qa, qn = v(ant, "QFE"), v(o, "QFE")       # QFE: en estaciones altas el QFF depende de la temperatura
        if qa is not None and qn is not None and abs(qn - qa) > 2.5:
            add("E09", 1, f"QFE cambió {qn - qa:+.1f} hPa en una hora")
    # capa más baja que se multiplica por ~3,3 respecto de la hora anterior (y vuelve a la siguiente, si ya está): pies en vez de metros
    sig = hist.get(t + pd.Timedelta(hours=1))
    C0, h0 = v(o, "CapaNube", "C"), v(o, "CapaNube", "hshshs")
    if ant and C0 is not None and h0:
        Ca, ha = v(ant, "CapaNube", "C"), v(ant, "CapaNube", "hshshs")
        Cs_, hs_ = (v(sig, "CapaNube", "C"), v(sig, "CapaNube", "hshshs")) if sig else (None, None)
        sube = Ca == C0 and ha and 2.7 <= h0 / ha <= 4.0
        vuelve = not sig or (Cs_ == C0 and hs_ and 2.7 <= h0 / hs_ <= 4.0)
        if sube and vuelve and h0 >= 300:
            add("E18", 1, f"la base de {NOM_C.get(C0, C0)} pasó de {ha:g} m a {h0:g} m (×{h0 / ha:.1f})" + (f" y a la hora siguiente volvió a {hs_:g} m" if sig else "")
                + f": parece anotada en pies (en metros serían {h0 / PIE:.0f} m)")
    # período de tiempo pasado
    per = 6 if t.hour % 6 == 0 else 3
    horas = [hist.get(t - pd.Timedelta(hours=k)) for k in range(1, per)]
    disponibles = [h for h in horas if h]
    W1, W2 = v(o, "W1W2", "W1"), v(o, "W1W2", "W2")
    if W1 is not None and len(disponibles) >= per - 2:
        # categorías W de lo informado en el período, con su origen (ww de cada hora o fenómeno de los METAR)
        fuentes = []
        for k in range(0, per):
            tk = t - pd.Timedelta(hours=k); hk = o if k == 0 else hist.get(tk)
            if not hk:
                continue
            wk = v(hk, "WWSINOP", "ww"); ck = categoria_W(wk)
            if ck is not None:
                fuentes.append((ck, f"ww {wk:02d} a las {tk:%H} UTC"))
            for f in fen_metar(hk):
                if f in FEN_W:
                    fuentes.append((FEN_W[f], f"{f} en el METAR de las {tk:%H} UTC"))
        cats = [c_ for c_, _ in fuentes]
        dist = sorted(set(cats), reverse=True)      # categorías distintas, de mayor a menor
        mx = dist[0] if dist else None
        NOMW = {3: "ventisca/tempestad de polvo", 4: "niebla", 5: "llovizna", 6: "lluvia", 7: "nieve o lluvia y nieve", 8: "chubascos", 9: "tormenta"}
        de = lambda c_: ", ".join(sorted({d_ for cc, d_ in fuentes if cc == c_})[:3])
        if mx is not None and W1 < mx:
            add("E10", 2, f"tiempo pasado: en el período de {per} h hubo {NOMW.get(mx, mx)} ({de(mx)}), que corresponde a W {mx}, pero W1 es {W1}. "
                f"W1 debe ser la categoría más alta del período. Debería ir: W1 {mx}" + (f", W2 {W1}" if W1 > (W2 or 0) and W1 in dist else ""))
        elif W2 is not None and len(dist) >= 2 and W2 < dist[1] and W1 != dist[1]:
            add("E10", 2, f"tiempo pasado: en el período de {per} h hubo {NOMW.get(dist[0], dist[0])} ({de(dist[0])}) y {NOMW.get(dist[1], dist[1])} ({de(dist[1])}), "
                f"pero W2 es {W2}. W2 debe ser la segunda categoría más alta. Debería ir: W1 {dist[0]}, W2 {dist[1]}")
        if W1 >= 5 and (mx is None or mx < 5):
            add("E11", 1, f"W1 {W1} (precipitación o tormenta en el período de {per} h) sin ningún ww ni METAR horario que lo respalde")
    rr6, tz = v(o, "RRR6", "RRR6"), v(o, "RRR6", "Traza")
    if t.hour % 6 == 0 and rr6 == 0 and not tz and not importada(o) and ((W1 or 0) in (5, 6, 7, 8) or (W2 or 0) in (5, 6, 7, 8) or (ww is not None and 50 <= ww <= 90)):
        add("E17", 1, f"precipitación informada (W1 {W1}, W2 {W2}, ww {ww}) y RRR6 0 sin traza: si llovió o lloviznó debe ir al menos traza")
    # precipitación del período
    rr, traza = v(o, "RRR6", "RRR6"), v(o, "RRR6", "Traza")
    if ingresado(o, "RRR6", "RRR6") and len(disponibles) >= 4:
        hubo = any(v(h, "WWSINOP", "ww") in PRECIP or 20 <= (v(h, "WWSINOP", "ww") or 0) <= 27 for h in disponibles) or (ww in PRECIP)
        if hubo and not ((rr or 0) > 0 or traza == 1):
            add("E12", 2, "en las últimas 6 h se informó precipitación y RRR6 es 0 sin traza")
        hubo_w = any((v(h, "W1W2", "W1") or 0) >= 5 or (v(h, "W1W2", "W2") or 0) >= 5 for h in [o] + disponibles) or \
                 any(f in FEN_W and FEN_W[f] >= 5 for h in [o] + disponibles for f in fen_metar(h))
        # solo se omite en observaciones importadas; si un observador no ingresó tiempo presente/pasado, igual se avisa
        if (rr or 0) > 0 and not hubo and not hubo_w:
            if not importada(o):
                # con el pluviómetro automático se sabe cuál de los dos está mal
                w6 = A[(A["momento"] > t - pd.Timedelta(hours=6)) & (A["momento"] <= t)] if A is not None and not A.empty and "rr1m" in A else None
                suma = round(float(w6["rr1m"].sum()), 1) if w6 is not None and len(w6) >= 300 else None
                sin_ww = all(v(h, "WWSINOP", "ww") is None for h in [o] + disponibles)
                if suma is None:
                    add("E13", 1, f"RRR6 {rr} mm sin ninguna hora con precipitación informada en el período")
                elif suma == 0:
                    add("E13", 2, f"RRR6 {rr} mm sin ninguna hora con precipitación informada en el período, y el pluviómetro automático tampoco marcó nada en las 6 h: "
                        f"el RRR6 está mal. Debería ir: RRR6 0")
                elif not sin_ww:     # estación que hace SYNOP: llovió y no quedó en ww ni W1W2
                    add("E13", 1, f"RRR6 {rr} mm y el pluviómetro automático marcó {suma:.1f} mm en las 6 h, pero ninguna hora informó precipitación (ww, W1W2 ni METAR): "
                        f"faltó informar el tiempo presente o reciente")
                # estación sin SYNOP (solo METAR): la lluvia que paró antes de la hora no queda en el METAR que entrega SACLIM; el pluviómetro la confirma
    # tendencia barométrica
    a, ppp = v(o, "a", "a"), v(o, "a", "ppp")
    h3 = hist.get(t - pd.Timedelta(hours=3))
    if a is not None and h3 is not None and v(h3, "QFE") is not None and v(o, "QFE") is not None:
        d = round(v(o, "QFE") - v(h3, "QFE"), 1)
        if ppp is not None and abs(abs(d) - ppp) > 0.5:
            add("E14", 2 if abs(abs(d) - ppp) > 1.0 else 1, f"ppp {ppp} hPa, pero el QFE anotado cambió {d:+.1f} hPa en 3 horas")
        if d >= 0.5 and a >= 5:
            add("E15", 2, f"característica a {a} (presión que baja) con QFE que subió {d:+.1f} hPa")
        if d <= -0.5 and a <= 3:
            add("E16", 2, f"característica a {a} (presión que sube) con QFE que bajó {d:+.1f} hPa")
    # observación repetida
    seq = [hist.get(t - pd.Timedelta(hours=k)) for k in range(0, 6)]
    if all(seq):
        firma = lambda h: (v(h, "N"), v(h, "Nubes", "Cl"), v(h, "Nubes", "Cm"), v(h, "Nubes", "Ch"), v(h, "VVSINOP", "VV"), v(h, "WWSINOP", "ww"),
                           v(h, "CapaNube", "Ns"), v(h, "CapaNube", "hshshs"))
        ts = [v(h, "Ts") for h in seq]
        if len({firma(h) for h in seq}) == 1 and N not in (0, None) and None not in ts and max(ts) - min(ts) >= 4:
            add("E17", 1, "nubosidad, visibilidad y tiempo presente idénticos durante 6 horas mientras la temperatura cambió más de 4 °C (posible observación repetida)")
    return out


# ======================================================================= frente a la estación automática
SENSOR = (("Ts", "T", 1.5, 3, "°C"), ("Td", "Td", 2.5, 5, "°C"), ("HR", "HR", 12, 25, "%"), ("QFE", "P_est", 0.8, 2, "hPa"), ("QFF", "P_mar", 1.5, 3, "hPa"), ("QNH", "P_std", 1.5, 3, "hPa"))
PRES = ("QFE", "QFF", "QNH")
TOL_SIN_SESGO = 2.0                # presión sin horas suficientes del observador para conocer su diferencia habitual


VENTANA_RACHA = 20                 # minutos antes de la hora en que el observador pudo hacer la observación (racha)
VENTANA = 15                       # minutos antes de la hora en que el observador pudo leer los instrumentos
TOL_PANTALLA = {"Ts": 0.1, "Td": 0.1, "HR": 1, "QFE": 0.2, "QFF": 0.2, "QNH": 0.2}   # solo el redondeo de lo que muestra la estación


def _auto(t, A):
    g = A[(A["momento"] <= t) & (A["momento"] > t - pd.Timedelta(minutes=10))].sort_values("momento")
    if not g.empty:
        return g.iloc[-1]
    g = A[(A["momento"] - t).abs() <= pd.Timedelta(minutes=30)]       # respaldo: el dato más cercano a la hora (±30 min)
    return None if g.empty else g.loc[(g["momento"] - t).abs().idxmin()]


def sesgos(obs, A):
    """Diferencia típica observador − automática de cada variable (mediana de las horas disponibles, mínimo 4).
    Una diferencia constante es de instrumento o de altura del sensor, no un error de la observación."""
    if A is None or A.empty:
        return {}
    dif = {el: [] for el, *_ in SENSOR}
    for t, o in obs.items():
        if importada(o):              # las horas importadas son copia del sensor: no dicen nada de lo que lee el observador
            continue
        r = _auto(t, A)
        if r is None:
            continue
        for el, col, *_ in SENSOR:
            x, y = v(o, el), r.get(col)
            if x is not None and y is not None and pd.notna(y):
                dif[el].append(x - y)
    return {el: float(np.median(d)) for el, d in dif.items() if len(d) >= 3}


def frente_sensor(t, o, A, sesgo=None):
    """A: DataFrame minutario de la estación automática del mismo código."""
    out = []
    sesgo = sesgo or {}
    if A is None or A.empty:
        return out
    r = _auto(t, A)
    if r is None:
        return out
    add = lambda cod, niv, msg: out.append(("sensor", cod, niv, msg))
    # El observador toma los datos de la propia estación automática (no hay instrumentos convencionales) en los minutos previos a
    # la hora, y SACLIM no guarda la hora de ingreso. Por eso lo anotado debe estar entre lo que marcó la automática de HH−15 a
    # HH:00, con una tolerancia que solo cubre el redondeo de la pantalla (sin descontar sesgos). Si además el valor no existió
    # en toda la hora previa, no salió de la estación (error de digitación, dato copiado o inventado): nivel alto.
    W = A[(A["momento"] > t - pd.Timedelta(minutes=VENTANA)) & (A["momento"] <= t)]
    WH = A[(A["momento"] > t - pd.Timedelta(minutes=60)) & (A["momento"] <= t)]
    for el, col, s1, s2, u in SENSOR:
        x, y = v(o, el), r.get(col)
        if x is None or y is None or pd.isna(y):
            continue
        serie = W[col].dropna() if col in W else pd.Series(dtype=float)
        if len(serie) >= 2:
            tol = TOL_PANTALLA[el]
            # presión: el QFE/QFF que muestra la estación puede estar referido a otra altura (umbral de pista) que la presión
            # que guarda el minutario; esa diferencia constante de cada estación se descuenta. En temperatura y humedad no.
            b = sesgo.get(el, 0.0) if el in PRES and abs(sesgo.get(el, 0.0)) >= 0.3 else 0.0
            lo, hi = float(serie.min()) + b, float(serie.max()) + b
            if el in PRES and el not in sesgo:   # aún sin diferencia habitual (inicio del turno): se aceptan hasta 2 hPa
                tol = TOL_SIN_SESGO
            if el in PRES and float(x).is_integer():   # presión ingresada en hPa enteros: vale truncada o redondeada
                lo, hi = math.floor(lo), math.ceil(hi)
            d = 0.0 if lo <= x <= hi else min(abs(x - lo), abs(x - hi))
            if d > tol + 1e-9:
                sh = WH[col].dropna()
                hlo, hhi = (float(sh.min()) + b, float(sh.max()) + b) if len(sh) else (lo, hi)
                nunca = not (hlo - tol <= x <= hhi + tol)
                rango_txt = (f"entre {lo:g} y {hi:g} {u}" if hi > lo else f"{lo:g} {u}") + f" de {(t - pd.Timedelta(minutes=VENTANA)):%H:%M} a {t:%H:%M}"
                if nunca:
                    add("S" + el, 2, f"{el} anotado {x} {u}: la estación automática nunca marcó ese valor en toda la hora previa "
                        f"(estuvo entre {hlo:g} y {hhi:g} {u}; de {(t - pd.Timedelta(minutes=VENTANA)):%H:%M} a {t:%H:%M}, {('entre ' + f'{lo:g} y {hi:g}') if hi > lo else f'{lo:g}'} {u}). "
                        f"El dato no proviene de la estación (diferencia {d:.1f} {u}" + (f"; descontada la diferencia habitual de la estación, {b:+.1f}" if b else "") + ")")
                else:
                    add("S" + el, 1, f"{el} anotado {x} {u} y la estación automática marcó {rango_txt} (diferencia {d:.1f} {u}); "
                        f"ese valor sí aparece antes en la hora, pero no en los minutos en que se observa")
        else:
            # sin minutario en la ventana: se compara con el dato único más cercano, con los umbrales amplios de antes
            b = sesgo.get(el, 0.0) if el in PRES and abs(sesgo.get(el, 0.0)) >= 0.3 else 0.0
            d = abs(x - float(y) - b)
            if d > s1:
                add("S" + el, 2 if d > s2 else 1, f"{el} anotado {x} {u} y la estación automática marcó {float(y):g} {u} "
                    f"(sin minutario en la ventana: dato único de las {r['momento']:%H:%M}; diferencia {d:.1f})")
    ff = v(o, "VTO", "ff")
    sff = W["ff10"].dropna() if "ff10" in W else pd.Series(dtype=float)
    if not len(sff) and pd.notna(r.get("ff10")):
        sff = pd.Series([float(r.get("ff10"))])
    if ff is not None and len(sff):
        lo, hi = float(sff.min()), float(sff.max())
        d = 0 if lo <= ff <= hi else min(abs(ff - lo), abs(ff - hi))
        kmh = ff / 1.852
        if ff >= 6 and not (lo - 1 <= ff <= hi + 1) and lo - 1.5 <= kmh <= hi + 1.5:
            add("Sffkmh", 2, f"viento anotado {ff} kt y la estación automática marcó " + (f"entre {lo:.0f} y {hi:.0f} kt" if round(hi) > round(lo) else f"{lo:.0f} kt")
                + f": {ff} km/h son {kmh:.0f} kt, justo lo de la estación. Parece anotado en km/h en vez de nudos (correspondería {round(kmh)} kt)")
        elif d > 6:
            add("Sff", 1, f"viento anotado {ff} kt y la estación automática marcó " + (f"entre {lo:.0f} y {hi:.0f} kt en los {VENTANA} min previos" if hi > lo else f"{lo:.0f} kt"))
    ffa = r.get("ff10")
    dd, dda = v(o, "VTO", "dd"), r.get("dd10")
    if dd and dda is not None and pd.notna(dda) and (ff or 0) >= 6 and (ffa or 0) >= 6:
        dif = abs((dd - dda + 180) % 360 - 180)
        if dif > 60:
            add("Sdd", 1, f"dirección anotada {dd}° y la estación automática marca {dda:.0f}° (diferencia {dif:.0f}°)")
    # racha (norma: «durante el período de diez minutos que precede a la observación, si la racha máxima excede a la velocidad
    # media en 10 kt o más, se informa»). SACLIM no da la hora exacta en que se observó, así que se prueban todas las ventanas de
    # 10 min que terminan entre HH:50 y HH:00; en cada una se compara la racha máxima con el viento medio de esa misma ventana.
    # Solo se alerta si lo informado no calza con NINGUNA de esas ventanas.
    _rng = lambda c: (lambda a, b: f"{a}" if a == b else f"{a} a {b}")(round(min(q["fx"] for q in c)), round(max(q["fx"] for q in c)))
    rach = (o.get("Racha") or {}).get("fmfm")
    rach = rach if isinstance(rach, (int, float)) else None
    if "fx10" in A and (ingresado(o, "VTO", "ff") or ff is not None):
        vent = []
        for k in range(0, VENTANA_RACHA + 1):       # posibles horas de observación (cada minuto de la ventana)
            fin = t - pd.Timedelta(minutes=k)
            # fx10 y ff10 de cada minuto ya son la racha máxima (3 s) y el viento medio de los 10 min que terminan en ese minuto
            fila = A.loc[A["momento"] == fin]
            if len(fila) and pd.notna(fila["fx10"].iloc[0]) and pd.notna(fila["ff10"].iloc[0]):
                vent.append(dict(fin=fin, fx=float(fila["fx10"].iloc[0]), tfx=fin, med=float(fila["ff10"].iloc[0])))
        if len(vent) >= 10:
            con = [x for x in vent if x["fx"] - x["med"] >= 10]
            rango = f"{vent[-1]['fin']:%H:%M}–{vent[0]['fin']:%H:%M}"
            if rach is None and len(con) == len(vent):
                x = max(con, key=lambda q: q["fx"])
                add("Sracha", 1, f"sin racha informada y la estación automática marcó racha de {x['fx']:.0f} kt en los 10 min que terminan a las {x['tfx']:%H:%M}, sobre un medio de {x['med']:.0f} kt; "
                    f"en todas las ventanas de 10 min que terminan entre {rango} la racha superó al medio en 10 kt o más: correspondía informar racha de {_rng(con)} kt")
            elif rach is not None and not con:
                mx = max(vent, key=lambda q: q["fx"] - q["med"])
                add("Sracha", 1, f"racha informada {rach} kt, pero en ninguna ventana de 10 min que termina entre {rango} la racha superó al medio en 10 kt "
                    f"(lo más cerca: {mx['fx']:.0f} kt sobre {mx['med']:.0f} kt): no correspondía informar racha")
            elif rach is not None and con and min(abs(rach - q["fx"]) for q in con) >= 5:
                add("Sracha", 1, f"racha informada {rach} kt y la racha de la estación automática en las ventanas posibles ({rango}) fue de "
                    f"{_rng(con)} kt: no calza con ningún momento posible")
    rr = v(o, "RRR6", "RRR6")
    if ingresado(o, "RRR6", "RRR6"):
        w = A[(A["momento"] > t - pd.Timedelta(hours=6)) & (A["momento"] <= t)]
        if len(w) >= 300:                         # al menos 5 h de datos minutarios
            suma = round(float(w["rr1m"].sum()), 1)
            r6 = rr or 0
            traza = v(o, "RRR6", "Traza") == 1
            d = round(abs(suma - r6), 1)
            if traza:
                if suma >= 0.2:
                    add("SRRR6", 1, f"RRR6 anotado como traza y el pluviómetro automático sumó {suma:.1f} mm en 6 h")
            elif d >= 0.1:
                add("SRRR6", 2 if d > max(1.0, 0.3 * max(suma, r6)) else 1,
                    f"RRR6 anotado {r6:g} mm y el pluviómetro automático sumó {suma:.1f} mm en las 6 h cerradas a las {t:%H}:00 (diferencia {d:.1f} mm; la precipitación debe calzar exacta)")
    out += precipitacion_hora(t, o, A)
    return out


VENTANA_PRESENTE = 20              # minutos antes de la hora: la lluvia en ese lapso es tiempo presente; antes, en la hora, tiempo reciente


def precipitacion_hora(t, o, A):
    """Lluvia del pluviómetro automático en la última hora frente al tiempo presente (ww y METAR) que informó el observador."""
    out = []
    if importada(o) or "rr1m" not in A:
        return out
    ww, fm = v(o, "WWSINOP", "ww"), fen_metar(o)
    if ww is None and not ingresado(o, "WWMETAR", "FEN1"):
        return out                                 # la hora no trae tiempo presente que revisar
    H = A[(A["momento"] > t - pd.Timedelta(minutes=60)) & (A["momento"] <= t)].dropna(subset=["rr1m"])
    if len(H) < 45:
        return out
    add = lambda cod, niv, msg: out.append(("sensor", cod, niv, msg))
    corte = t - pd.Timedelta(minutes=VENTANA_PRESENTE)
    P, R = H[H["momento"] > corte], H[H["momento"] <= corte]
    llueve_m = "RA" in fm or "DZ" in fm
    pres = (ww is not None and ww in PRECIP) or llueve_m
    rec = ww is not None and 20 <= ww <= 27
    tramo = lambda X: (lambda Y: f"{Y['momento'].min():%H:%M}" + (f"–{Y['momento'].max():%H:%M}" if len(Y) > 1 else ""))(X[X["rr1m"] > 0])
    ww_txt = f"ww {ww}" if ww is not None else "sin ww"
    m_txt = ("METAR " + " ".join(fm)) if fm else "METAR sin fenómenos"
    sp, sr = round(float(P["rr1m"].sum()), 1), round(float(R["rr1m"].sum()), 1)
    debe_p = ("tiempo presente de precipitación (ww 50–69 u 80–82; RA, DZ o SHRA en el METAR)" if ww is not None
              else "precipitación en el METAR (RA, DZ o SHRA)")       # estación o hora sin SYNOP: solo el METAR
    niebla = any(f in ("BR", "FG") for f in fm)
    if sp >= 0.2 and not pres:
        add("SPRE", 2, f"el pluviómetro automático marcó {sp:.1f} mm a las {tramo(P)} (en los {VENTANA_PRESENTE} min previos a la observación) y se informó {ww_txt}, {m_txt}: "
            f"llovía al observar. Debería ir: {debe_p}")
    elif sp > 0 and not pres:            # un solo pulso de 0.1 mm: puede ser goteo de niebla o rocío en el embudo
        add("SPRE", 1, f"el pluviómetro automático marcó solo {sp:.1f} mm a las {tramo(P)} (en los {VENTANA_PRESENTE} min previos a la observación) y se informó {ww_txt}, {m_txt}. "
            + ("Con neblina o niebla puede ser goteo en el embudo y no precipitación; revisar si hubo llovizna" if niebla else f"Revisar si hubo llovizna; si la hubo, debería ir: {debe_p}"))
    elif sp == 0 and sr >= 0.2 and ww is not None and not pres and not rec:   # el tiempo reciente solo se ve en el ww (SACLIM no entrega el RE del METAR)
        add("SPRE", 1, f"el pluviómetro automático marcó {sr:.1f} mm a las {tramo(R)} y paró antes de la observación, pero se informó {ww_txt}, {m_txt}. "
            f"Debería ir: tiempo reciente (ww 20 llovizna, 21 lluvia, 25 chubasco; RERA o REDZ en el METAR)")
    elif sp == 0 and sr == 0 and pres and not (ww is not None and (68 <= ww <= 79 or 83 <= ww <= 90)):   # nieve o granizo: el pluviómetro puede no marcar
        add("SPRE", 1, f"se informó precipitación ({ww_txt}, {m_txt}) y el pluviómetro automático no marcó nada en la última hora "
            f"(una llovizna débil puede no alcanzar 0.2 mm; revisar si de verdad hubo)")
    return out


# ======================================================================= extremas del observador frente al minutario
# TnAM/TxAM (se ingresan con la observación de las 12 UTC: período 00–12 UTC) y TnPM/TxPM (con la de las 00 UTC: 12–00 UTC).
# Cada una trae su valor y su FechaHora en hora local. Se compara con el minutario de la estación automática, de la que el
# observador toma el dato: el valor debe ser el mínimo/máximo real del período y, a la hora indicada, la estación debe haber
# marcado ese valor. Si el valor se repitió en otros momentos, se mencionan todos.
ZONA_EST = {"270001": "Pacific/Easter", "510005": "America/Punta_Arenas", "520006": "America/Punta_Arenas",
            "530005": "America/Punta_Arenas", "550001": "America/Punta_Arenas", "950001": "America/Punta_Arenas"}
EXTREMAS = (("TnAM", "mínima", True), ("TxAM", "máxima", False), ("TnPM", "mínima", True), ("TxPM", "máxima", False))
TOL_EXT = 0.2                     # frente a la extrema de la estación (se ven diferencias de 0,1–0,2 por redondeo de pantalla)


def extremas(t, o, A, codigo, hist=None):
    out = []
    if A is None or A.empty or "T" not in A:
        return out
    add = lambda cod, niv, msg: out.append(("sensor", cod, niv, msg))
    from zoneinfo import ZoneInfo
    Z = ZoneInfo(ZONA_EST.get(str(codigo), "America/Santiago"))
    a_loc = lambda x: x.tz_localize("UTC").tz_convert(Z).tz_localize(None)
    a_utc = lambda x: pd.Timestamp(x).tz_localize(Z, ambiguous="NaT", nonexistent="shift_forward").tz_convert("UTC").tz_localize(None)
    W = A[(A["momento"] > t - pd.Timedelta(hours=12)) & (A["momento"] <= t)].dropna(subset=["T"]).sort_values("momento")
    if len(W) < 2:
        return out
    paso = W["momento"].diff().median() / pd.Timedelta(minutes=1)
    if len(W) * paso < 0.8 * 720:                 # menos del 80 % del período con datos: no se puede afirmar nada
        return out
    # La estación calcula sus extremas con muestras de segundos, por eso pueden quedar hasta ~1 °C más allá del mínimo/máximo de
    # los valores por minuto (es lo que ve el observador en pantalla). Tn12/Tx12 del minutario se usan solo si son plausibles
    # (más extremos que el valor por minuto, a menos de 1 °C): según la estación cambian a las 10 o a las 12 UTC y en la fila de
    # las 12:00 pueden traer todavía la extrema de ayer, así que se buscan en las 2 h previas y los 20 min siguientes.
    cerca_t = A[(A["momento"] > t - pd.Timedelta(hours=2)) & (A["momento"] <= t + pd.Timedelta(minutes=20))]
    for el, nom, minimo in EXTREMAS:
        x = v(o, el)
        fh = ((o.get(el) or {}).get("FechaHora"))
        if x is None:
            continue
        ser = float(W["T"].min() if minimo else W["T"].max())
        col = "Tn12" if minimo else "Tx12"
        ofi = None
        if (el, t.hour) in (("TnAM", 12), ("TxPM", 0)) and col in cerca_t:
            cand = [float(c) for c in cerca_t[col].dropna().unique() if (ser - 1.0 <= c <= ser + 0.05) if minimo] if minimo else \
                   [float(c) for c in cerca_t[col].dropna().unique() if ser - 0.05 <= c <= ser + 1.0]
            if cand:
                ofi = min(cand, key=lambda c: abs(c - x))   # la que calza mejor con lo anotado (si hay varias plausibles)
        real = ofi if ofi is not None else ser
        # tolerancia: exacta frente a la extrema oficial; sin ella, unas décimas hacia afuera por las muestras de segundos
        if ofi is not None:
            ok = abs(round(x - real, 1)) <= TOL_EXT
        else:
            ok = (round(ser - 0.6, 1) <= x <= round(ser + 0.3, 1)) if minimo else (round(ser - 0.3, 1) <= x <= round(ser + 0.6, 1))
        fuente = "según la extrema de la estación" if ofi is not None else "según el minutario"
        cerca_real = W.loc[(W["T"] - real).abs() <= max(0.05, abs(real - ser) + 0.05), "momento"]
        horas_real = ", ".join(f"{a_loc(m):%H:%M}" for m in _agrupar(cerca_real))
        periodo = f"{a_loc(t - pd.Timedelta(hours=12)):%H:%M}–{a_loc(t):%H:%M}"
        d = round(x - real, 1)
        # 1) valor
        if not ok:
            nunca = (minimo and x < round(ser - 1.0, 1)) or (not minimo and x > round(ser + 1.0, 1))   # ni con muestras de segundos
            # ¿es la extrema del período anterior (la otra casilla) repetida? p. ej. la TxPM de ayer ingresada también como TxAM
            Wp = A[(A["momento"] > t - pd.Timedelta(hours=24)) & (A["momento"] <= t - pd.Timedelta(hours=12))].dropna(subset=["T"])
            otra = {"TnAM": "TnPM", "TxAM": "TxPM", "TnPM": "TnAM", "TxPM": "TxAM"}[el]
            rep = len(Wp) > 0 and abs(x - float(Wp["T"].min() if minimo else Wp["T"].max())) <= 0.6 and \
                  (x <= float(Wp["T"].min()) + 0.05 if minimo else x >= float(Wp["T"].max()) - 0.05)
            nota_rep = (f"Parece la {nom} del período anterior ({otra}) repetida en la {el}. ") if rep else ""
            add("SEXT", 2 if nunca or abs(d) > 0.5 else 1,
                (f"{el} {x} °C: la estación automática nunca {'bajó' if minimo else 'subió'} a ese valor en el período ({periodo} local); " if nunca
                 else f"{el} {x} °C, pero ") + f"la {nom} real fue {real:.1f} °C ({fuente}), cerca de las {horas_real}. " + nota_rep +
                f"Debería ir: {real:.1f} °C a las {horas_real.split(', ')[0]}")
        # 2) hora
        if not isinstance(fh, str) or not re.match(r"\d{4}-\d\d-\d\d \d\d:\d\d", fh):
            continue
        tu = a_utc(fh[:16])
        if pd.isna(tu):
            continue
        if not (t - pd.Timedelta(hours=12) <= tu <= t):
            if str(codigo) != "270001":            # Isla de Pascua: el huso que usa el observador no es seguro
                add("SEXH", 1, f"{el} con hora {fh[11:16]} del {fh[8:10]}/{fh[5:7]}: queda fuera del período de la {nom} ({periodo} local). "
                    f"La {nom} real fue {real:.1f} °C cerca de las {horas_real}. Debería ir: {horas_real.split(', ')[0]}")
            continue
        # ±1 min: la hora de la extrema que muestra la estación (de sus muestras de segundos) puede caer en el minuto siguiente
        # o anterior al registro por minuto; esa diferencia no es un error
        cerca = W[(W["momento"] - tu).abs() <= pd.Timedelta(minutes=1)]
        if cerca.empty or not ok:                  # si el valor ya está mal, la alerta de valor trae la hora que corresponde
            continue
        en_hora = float(cerca["T"].iloc[int((cerca["T"] - x).abs().values.argmin())])   # el más parecido de esos minutos
        if abs(en_hora - x) > 0.5:
            donde = W.loc[(W["T"] - x).abs() <= 0.15, "momento"]
            otras = ", ".join(f"{a_loc(m):%H:%M}" for m in _agrupar(donde))
            add("SEXH", 2 if abs(en_hora - x) > 2 else 1, f"{el} {x} °C a las {fh[11:16]}: a esa hora la estación automática marcaba {en_hora:.1f} °C. "
                + (f"El valor {x} °C se registró a las {otras}. Debería ir: {otras.split(', ')[0]}" if otras
                   else f"La {nom} real fue {real:.1f} °C cerca de las {horas_real}. Debería ir: {horas_real.split(', ')[0]}"))
    # 3) extrema fuera del bloque habitual sin ingresar. TxAM y TnPM no son obligatorias: solo corresponden cuando el extremo
    # del día ocurrió en ese período. Se evalúa con la observación de las 00 UTC, cuando ya están los dos bloques del día local
    # (mañana 00–12 UTC = 21:00–09:00 y tarde 12–00 UTC = 09:00–21:00 en verano).
    if t.hour == 0 and hist is not None:
        Wm = A[(A["momento"] > t - pd.Timedelta(hours=24)) & (A["momento"] <= t - pd.Timedelta(hours=12))].dropna(subset=["T"])
        cub = lambda w: len(w) > 1 and len(w) * (w["momento"].diff().median() / pd.Timedelta(minutes=1)) >= 0.8 * 720
        if cub(Wm) and cub(W):
            o12 = hist.get(t - pd.Timedelta(hours=12)) or {}
            mx_m, mx_t = float(Wm["T"].max()), float(W["T"].max())
            if mx_m > mx_t + 0.2 and v(o12, "TxAM") is None:
                tm = Wm["momento"].iloc[int(Wm["T"].values.argmax())]
                add("SEXF", 1, f"La máxima del día se dio en la mañana: {mx_m:.1f} °C a las {a_loc(tm):%H:%M}, más alta que la de la tarde ({mx_t:.1f} °C). "
                    f"Correspondía ingresar la TxAM en la observación de las 12 UTC. Debería ir: TxAM {mx_m:.1f} °C a las {a_loc(tm):%H:%M}")
            mn_m, mn_t = float(Wm["T"].min()), float(W["T"].min())
            if mn_t < mn_m - 0.2 and v(o, "TnPM") is None:
                tn = W["momento"].iloc[int(W["T"].values.argmin())]
                add("SEXF", 1, f"La mínima del día se dio en la tarde: {mn_t:.1f} °C a las {a_loc(tn):%H:%M}, más baja que la de la mañana ({mn_m:.1f} °C). "
                    f"Correspondía ingresar la TnPM. Debería ir: TnPM {mn_t:.1f} °C a las {a_loc(tn):%H:%M}")
    return out


def _agrupar(momentos, salto=10):
    """De una lista de minutos en que se repite un valor, deja el primero de cada racha (separadas por más de «salto» min)."""
    res, ant = [], None
    for m in sorted(momentos):
        if ant is None or (m - ant) > pd.Timedelta(minutes=salto):
            res.append(m)
        ant = m
    return res[:4]


# ======================================================================= ciclo
EXT_PP = {"SEXT", "SEXH", "SEXF", "SRRR6", "SPRE", "E12", "E13", "E17"}     # extremas y precipitación


def revisar(codigo, obs, A=None, horas=None, sat=None, horas_ext=None):
    """Revisa las horas indicadas (por defecto la última) de una estación. Devuelve lista de hallazgos.
    horas_ext: horas (contadas desde la última) en que se revisan además las extremas y la precipitación, más atrás de «horas»
    (para no perder lo de un fin de semana largo)."""
    if not obs:
        return []
    ts = sorted(obs)
    sel = ts[-(horas or 1):]
    ext = [t for t in ts if t not in set(sel) and horas_ext and t > ts[-1] - pd.Timedelta(hours=horas_ext)]
    out = []
    from satelite import sensorial as satelital
    sg = sesgos(obs, A)
    for el, col, s1, s2, u in SENSOR:            # diferencia constante con la automática: se informa una vez (última hora)
        if abs(sg.get(el, 0)) > s1:
            out.append(dict(codigo=str(codigo), hora=str(ts[-1]), tipo="sensor", regla="SB" + el, nivel=1, revisado="no",
                            msg=f"{el} del observador difiere en forma constante {sg[el]:+.1f} {u} de la estación automática (revisar calibración o altura del sensor)"))
    for t in sel:
        o = obs[t]
        for tipo, cod, niv, msg in reglas_sistema(o) + codificacion(o) + evolucion(t, o, obs, A) + frente_sensor(t, o, A, sg) + extremas(t, o, A, codigo, obs) + satelital(t, o, sat):
            out.append(dict(codigo=str(codigo), hora=str(t), tipo=tipo, regla=cod, nivel=niv, msg=msg, revisado="si" if o.get("_qa") else "no"))
    for t in ext:
        o = obs[t]
        for tipo, cod, niv, msg in evolucion(t, o, obs, A) + frente_sensor(t, o, A, sg) + extremas(t, o, A, codigo, obs):
            if cod in EXT_PP:
                out.append(dict(codigo=str(codigo), hora=str(t), tipo=tipo, regla=cod, nivel=niv, msg=msg, revisado="si" if o.get("_qa") else "no"))
    return out
