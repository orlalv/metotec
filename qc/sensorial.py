"""Control de las observaciones de las estaciones con observador (servicio getRecientesSaclim).

Tres niveles:
  sistema      las reglas de control del sistema de ingreso (reglas_sistema.json), evaluadas sobre lo grabado
  codificacion reglas de codificación (OMM / manual) que el sistema no exige
  evolucion    coherencia con las horas anteriores (W1W2, RRR6, tendencia, niebla, nubosidad, precipitación)
  sensor       lo anotado frente a la estación automática del mismo lugar

No se guarda ni se muestra el identificador del observador.
"""
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
def codificacion(o):
    out = []
    add = lambda cod, niv, msg: out.append(("codificacion", cod, niv, msg))
    ww, VV, N = v(o, "WWSINOP", "ww"), v(o, "VVSINOP", "VV"), v(o, "N")
    CL, CM, CH, Nh = v(o, "Nubes", "Cl"), v(o, "Nubes", "Cm"), v(o, "Nubes", "Ch"), v(o, "Nubes", "Nh")
    HR, Ts = v(o, "HR"), v(o, "Ts")
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


# ======================================================================= evolución (con las horas anteriores)
def evolucion(t, o, hist):
    """hist: {momento: obs} de la misma estación (incluye t)."""
    out = []
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
        cats = [categoria_W(v(h, "WWSINOP", "ww")) for h in disponibles] + [categoria_W(ww)]
        cats += [FEN_W[f] for h in disponibles + [o] for f in fen_metar(h) if f in FEN_W]     # también lo informado en los METAR
        dist = sorted({c for c in cats if c is not None}, reverse=True)      # categorías distintas, de mayor a menor
        mx = dist[0] if dist else None
        if mx is not None and W1 < mx:
            add("E10", 2, f"en el período de {per} h se informó un fenómeno de categoría W {mx}, pero W1 es {W1}: W1 debe ser la categoría más alta")
        elif W2 is not None and len(dist) >= 2 and W2 < dist[1]:
            add("E10", 2, f"en el período de {per} h se informaron fenómenos de categoría W {dist[0]} y {dist[1]}, pero W2 es {W2}: W2 debe ser la segunda categoría más alta")
        if W1 >= 5 and (mx is None or mx < 5):
            add("E11", 1, f"W1 {W1} (precipitación o tormenta en el período de {per} h) sin ningún ww ni METAR horario que lo respalde")
    rr6, tz = v(o, "RRR6", "RRR6"), v(o, "RRR6", "Traza")
    if t.hour % 6 == 0 and rr6 == 0 and not tz and ((W1 or 0) in (5, 6, 7, 8) or (W2 or 0) in (5, 6, 7, 8) or (ww is not None and 50 <= ww <= 90)):
        add("E17", 1, f"precipitación informada (W1 {W1}, W2 {W2}, ww {ww}) y RRR6 0 sin traza: si llovió o lloviznó debe ir al menos traza")
    # precipitación del período
    rr, traza = v(o, "RRR6", "RRR6"), v(o, "RRR6", "Traza")
    if ingresado(o, "RRR6", "RRR6") and len(disponibles) >= 4:
        hubo = any(v(h, "WWSINOP", "ww") in PRECIP or 20 <= (v(h, "WWSINOP", "ww") or 0) <= 27 for h in disponibles) or (ww in PRECIP)
        if hubo and not ((rr or 0) > 0 or traza == 1):
            add("E12", 2, "en las últimas 6 h se informó precipitación y RRR6 es 0 sin traza")
        if (rr or 0) > 0 and not hubo:
            add("E13", 1, f"RRR6 {rr} mm sin ninguna hora con precipitación informada en el período")
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
SENSOR = (("Ts", "T", 1.5, 3, "°C"), ("Td", "Td", 2.5, 5, "°C"), ("HR", "HR", 12, 25, "%"), ("QFE", "P_est", 0.8, 2, "hPa"), ("QFF", "P_mar", 1.5, 3, "hPa"))


VENTANA = 15                       # minutos antes de la hora en que el observador pudo leer los instrumentos


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
        r = _auto(t, A)
        if r is None:
            continue
        for el, col, *_ in SENSOR:
            x, y = v(o, el), r.get(col)
            if x is not None and y is not None and pd.notna(y):
                dif[el].append(x - y)
    return {el: float(np.median(d)) for el, d in dif.items() if len(d) >= 4}


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
    # El observador lee los instrumentos en los minutos previos a la hora (p. ej. a las 12:51 para la de las 13:00) y SACLIM
    # no guarda la hora de ingreso: se compara con TODO lo que marcó la automática entre HH−15 y HH:00 y solo se alerta si el
    # valor anotado no calza con ninguno de esos minutos (queda fuera del rango mín–máx más la tolerancia).
    W = A[(A["momento"] > t - pd.Timedelta(minutes=VENTANA)) & (A["momento"] <= t)]
    for el, col, s1, s2, u in SENSOR:
        x, y = v(o, el), r.get(col)
        if x is None or y is None or pd.isna(y):
            continue
        b = sesgo.get(el, 0.0)
        b = b if abs(b) > s1 / 2 else 0.0                 # solo se descuenta una diferencia constante apreciable
        serie = W[col].dropna() if col in W else pd.Series(dtype=float)
        # con 2 o más minutos en la ventana se usa el rango; si no hay minutario, se compara con el dato único más cercano (como antes)
        lo, hi = (float(serie.min()), float(serie.max())) if len(serie) >= 2 else (float(y), float(y))
        xc = x - b
        d = 0.0 if lo <= xc <= hi else min(abs(xc - lo), abs(xc - hi))
        if d > s1:
            extra = f"; descontada la diferencia habitual de {b:+.1f}" if b else ""
            rango_txt = (f"entre {lo:g} y {hi:g} {u} de {(t - pd.Timedelta(minutes=VENTANA)):%H:%M} a {t:%H:%M}" if hi > lo
                         else f"{lo:g} {u}" + ("" if len(serie) >= 2 else f" (sin minutario en la ventana: dato único de las {r['momento']:%H:%M})"))
            add("S" + el, 2 if d > s2 else 1, f"{el} anotado {x} {u} y la estación automática marcó {rango_txt} (diferencia {d:.1f}{extra})")
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
    return out


# ======================================================================= ciclo
def revisar(codigo, obs, A=None, horas=None, sat=None):
    """Revisa las horas indicadas (por defecto la última) de una estación. Devuelve lista de hallazgos."""
    if not obs:
        return []
    ts = sorted(obs)
    sel = ts[-(horas or 1):]
    out = []
    from satelite import sensorial as satelital
    sg = sesgos(obs, A)
    for el, col, s1, s2, u in SENSOR:            # diferencia constante con la automática: se informa una vez (última hora)
        if abs(sg.get(el, 0)) > s1:
            out.append(dict(codigo=str(codigo), hora=str(ts[-1]), tipo="sensor", regla="SB" + el, nivel=1, revisado="no",
                            msg=f"{el} del observador difiere en forma constante {sg[el]:+.1f} {u} de la estación automática (revisar calibración o altura del sensor)"))
    for t in sel:
        o = obs[t]
        for tipo, cod, niv, msg in reglas_sistema(o) + codificacion(o) + evolucion(t, o, obs) + frente_sensor(t, o, A, sg) + satelital(t, o, sat):
            out.append(dict(codigo=str(codigo), hora=str(t), tipo=tipo, regla=cod, nivel=niv, msg=msg, revisado="si" if o.get("_qa") else "no"))
    return out
