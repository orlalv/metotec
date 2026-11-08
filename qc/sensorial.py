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
    def _c(self, o, f):
        a, b = self.x, (o.x if isinstance(o, _V) else o)
        return False if a is None or b is None or isinstance(a, str) or isinstance(b, str) else f(a, b)
    __eq__ = lambda s, o: s._c(o, lambda a, b: a == b)
    __ne__ = lambda s, o: s._c(o, lambda a, b: a != b)
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
            ok = eval(code, {"__builtins__": {}}, env)
        except Exception:
            continue
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
    if 70 <= ww <= 79 or ww in (22, 23, 24):
        return 7
    if 60 <= ww <= 69 or ww == 21:
        return 6
    if 50 <= ww <= 59 or ww == 20:
        return 5
    if 40 <= ww <= 49 or ww == 28:
        return 4
    if 30 <= ww <= 39:
        return 3
    return None


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
        if ww == 10 and not (1000 <= VV <= 5000):
            add("C02", 2, f"neblina (ww 10) con visibilidad de {VV} m: debe estar entre 1000 y 5000 m")
        if ww in (4, 5) and VV > 5000:
            add("C03", 1, f"humo o calima (ww {ww:02d}) con visibilidad de {VV} m: se informa con 5000 m o menos")
        if ww in (11, 12) and VV < 1000:
            add("C04", 1, f"niebla baja (ww {ww}) con visibilidad de {VV} m: si la visibilidad es menor de 1000 m es niebla (40–49)")
        if VV < 1000 and ww < 40 and ww not in PRECIP and ww not in (4, 6, 7, 8, 9, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39):
            add("C05", 1, f"visibilidad de {VV} m sin un fenómeno que la explique (ww {ww:02d})")
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
    for k, (ns, c, h) in enumerate(capas[1:], 2):
        minimo = {2: 3, 3: 5}.get(k, 0)
        if ns is not None and ns < minimo and c != 9:
            add("C18", 1, f"capa {k} con {ns} octas: la {'segunda' if k == 2 else 'tercera'} capa se informa con {minimo} octas o más (salvo Cb)")
            break
    if any(c[0] == 8 for c in capas[:-1]) and capas[-1][0] != 8 and capas.index(next(c for c in capas if c[0] == 8)) < len(capas) - 1:
        add("C19", 1, "hay capas por encima de una capa de 8 octas: con 8 octas no se ven las nubes superiores")
    if Nh is not None and N is not None and N != 9 and Nh > N:
        add("C20", 2, f"Nh {Nh} mayor que N {N}")
    if CL == 9 and not any(c[1] == 9 for c in capas):
        add("C21", 1, "CL 9 (cumulonimbo) sin una capa de Cb")
    if any(c[1] == 9 for c in capas) and CL not in (3, 9):
        add("C22", 1, f"capa de Cb con CL {CL}: con cumulonimbo CL es 3 o 9")
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
            if 20 <= ww <= 29 and categoria_W(wa) is None and wa < 20:
                add("E02", 1, f"ww {ww} (fenómeno terminado en la última hora) pero a la hora anterior se informó ww {wa:02d}")
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
        qa, qn = v(ant, "QFF"), v(o, "QFF")
        if qa is not None and qn is not None and abs(qn - qa) > 3:
            add("E09", 1, f"QFF cambió {qn - qa:+.1f} hPa en una hora")
    # período de tiempo pasado
    per = 6 if t.hour % 6 == 0 else 3
    horas = [hist.get(t - pd.Timedelta(hours=k)) for k in range(1, per)]
    disponibles = [h for h in horas if h]
    W1, W2 = v(o, "W1W2", "W1"), v(o, "W1W2", "W2")
    if W1 is not None and len(disponibles) >= per - 2:
        cats = [categoria_W(v(h, "WWSINOP", "ww")) for h in disponibles] + [categoria_W(ww)]
        mx = max([c for c in cats if c is not None], default=None)
        if mx is not None and W1 < mx:
            add("E10", 2, f"en el período de {per} h se informó un fenómeno de categoría W {mx}, pero W1 es {W1}")
        if W1 >= 5 and (mx is None or mx < 5):
            add("E11", 1, f"W1 {W1} (precipitación o tormenta en el período de {per} h) sin ningún ww horario que lo respalde")
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
        if ppp is not None and abs(abs(d) - ppp) > 0.3:
            add("E14", 2, f"ppp {ppp} hPa, pero el QFE cambió {d:+.1f} hPa en 3 horas")
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
def frente_sensor(t, o, A):
    """A: DataFrame minutario de la estación automática del mismo código."""
    out = []
    if A is None or A.empty:
        return out
    g = A[(A["momento"] <= t) & (A["momento"] > t - pd.Timedelta(minutes=10))].sort_values("momento")
    if g.empty:
        return out
    r = g.iloc[-1]
    add = lambda cod, niv, msg: out.append(("sensor", cod, niv, msg))
    for el, col, s1, s2, u in (("Ts", "T", 1.5, 3, "°C"), ("Td", "Td", 2.5, 5, "°C"), ("HR", "HR", 12, 25, "%"), ("QFE", "P_est", 0.8, 2, "hPa"), ("QFF", "P_mar", 1.5, 3, "hPa")):
        x, y = v(o, el), r.get(col)
        if x is None or y is None or pd.isna(y):
            continue
        d = abs(x - y)
        if d > s1:
            add("S" + el, 2 if d > s2 else 1, f"{el} anotado {x} {u} y la estación automática marca {y:g} {u} (diferencia {d:.1f})")
    ff, ffa = v(o, "VTO", "ff"), r.get("ff10")
    if ff is not None and ffa is not None and pd.notna(ffa) and abs(ff - ffa) > 6:
        add("Sff", 1, f"viento anotado {ff} kt y la estación automática marca {ffa:.0f} kt")
    dd, dda = v(o, "VTO", "dd"), r.get("dd10")
    if dd and dda is not None and pd.notna(dda) and (ff or 0) >= 6 and (ffa or 0) >= 6:
        dif = abs((dd - dda + 180) % 360 - 180)
        if dif > 60:
            add("Sdd", 1, f"dirección anotada {dd}° y la estación automática marca {dda:.0f}° (diferencia {dif:.0f}°)")
    rr = v(o, "RRR6", "RRR6")
    if ingresado(o, "RRR6", "RRR6"):
        w = A[(A["momento"] > t - pd.Timedelta(hours=6)) & (A["momento"] <= t)]
        if len(w) >= 300:                         # al menos 5 h de datos minutarios
            suma = w["rr1m"].sum()
            r6 = rr or 0
            if abs(suma - r6) > max(1.0, 0.3 * max(suma, r6)):
                add("SRRR6", 1, f"RRR6 anotado {r6} mm y el pluviómetro automático sumó {suma:.1f} mm en 6 h")
    return out


# ======================================================================= ciclo
def revisar(codigo, obs, A=None, horas=None):
    """Revisa las horas indicadas (por defecto la última) de una estación. Devuelve lista de hallazgos."""
    if not obs:
        return []
    ts = sorted(obs)
    sel = ts[-(horas or 1):]
    out = []
    for t in sel:
        o = obs[t]
        for tipo, cod, niv, msg in reglas_sistema(o) + codificacion(o) + evolucion(t, o, obs) + frente_sensor(t, o, A):
            out.append(dict(codigo=str(codigo), hora=str(t), tipo=tipo, regla=cod, nivel=niv, msg=msg, revisado="si" if o.get("_qa") else "no"))
    return out
