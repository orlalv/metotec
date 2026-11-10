"""Revisión de un período pasado de una estación con observador, a partir de los mensajes METAR y SYNOP que codificó SACLIM
(portal de climatología, «historialDeCodificacion», público). Los mensajes se decodifican a la misma forma que entrega
getRecientesSaclim y se pasan por las mismas reglas de sensorial.py, más:
  CMS   coherencia METAR–SYNOP de la misma hora
  FALTA hora del programa de la estación sin mensaje
Lo que no viaja en los mensajes (HR, hora de las extremas, TxAM/TnPM, ww 00–03) no se revisa."""
import html, json, re, sys, time
from pathlib import Path
import pandas as pd, requests
sys.path.insert(0, str(Path(__file__).parent))
import sensorial as SEN

URL = "https://climatologia.meteochile.gob.cl/application/control/historialDeCodificacion/{cod}/{a}/{m}/{d}"
FEN_COD = {v: k for k, v in SEN.FEN_METAR.items()}            # sigla METAR → código SACLIM (DZ 1, RA 2, BR 9, FG 10, HZ 15)
PRECIP_M = ("DZ", "RA", "SN", "SG", "PL", "GR", "GS", "UP")


# ---------------------------------------------------------------- descarga
def descargar_dia(cod, dia, timeout=60):
    """Devuelve {'metar': [(hora 'HH:MM', texto)], 'synop': [...]} del día (UTC)."""
    r = requests.get(URL.format(cod=cod, a=dia.year, m=dia.month, d=dia.day), timeout=timeout,
                     headers={"User-Agent": "METOTEC control de calidad (DMC)"})
    r.raise_for_status()
    return leer_html(r.text)


def leer_html(t):
    out = {"metar": [], "synop": []}
    for fila in re.findall(r"<tr>(.*?)</tr>", t, flags=re.S):
        celdas = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", fila, flags=re.S)]
        if len(celdas) < 2 or not re.match(r"^\d\d:\d\d$", celdas[0]):
            continue
        msg = celdas[-1]
        if msg.startswith(("METAR", "SPECI")):
            out["metar"].append((celdas[0], msg))
        elif msg.startswith("AAXX"):
            out["synop"].append((celdas[0], msg))
    return out


# ---------------------------------------------------------------- SYNOP
def _vv(x):
    x = int(x)
    if x <= 50: return x * 100
    if 56 <= x <= 80: return (x - 50) * 1000
    if 81 <= x <= 88: return (30 + (x - 80) * 5) * 1000
    return 75000 if x == 89 else None


def _hs(x):
    x = int(x)
    if x <= 50: return x * 30
    if 56 <= x <= 80: return (x - 50) * 300
    if 81 <= x <= 88: return 10500 + (x - 80) * 1500
    return None


def _t(g):          # 1sTTT / 2sTdTdTd
    if "/" in g[1:]: return None
    v = int(g[2:]) / 10
    return -v if g[1] == "1" else v


def _p(g):          # 3PPPP / 4PPPP
    if "/" in g[1:]: return None
    v = int(g[1:]) / 10
    return v + 1000 if v < 100 else v


def _rrr(g):        # 6RRRtR → (mm, traza, tR)
    if "/" in g[1:4]: return None, None, None
    r = int(g[1:4]); tr = g[4]
    if r == 990: return 0.0, 1, tr
    if r > 990: return (r - 990) / 10, 0, tr
    return float(r), 0, tr


def decodificar_synop(msg):
    """Elementos SACLIM que viajan en el SYNOP. Devuelve dict {Elemento: {comp: valor}}."""
    g = msg.replace("=", "").split()
    o = {}
    if len(g) < 5 or g[0] != "AAXX":
        return o
    iw = g[1][4]
    sec1, sec3, en3 = [], [], False
    for x in g[3:]:
        if x == "333": en3 = True; continue
        if x in ("444", "555"): break
        (sec3 if en3 else sec1).append(x)
    if not sec1:
        return o
    ir, ix, h, vv = sec1[0][0], sec1[0][1], sec1[0][2], sec1[0][3:5]
    if vv.isdigit() and _vv(vv) is not None: o["VVSINOP"] = {"VV": _vv(vv)}
    o["_ix"] = ix
    if len(sec1) > 1 and "/" not in sec1[1][:1]:
        n, dd, ff = sec1[1][0], sec1[1][1:3], sec1[1][3:5]
        if n.isdigit(): o["N"] = {"N": int(n)}
        if dd.isdigit() and ff.isdigit():
            ffv = int(ff) if iw in ("3", "4") else round(int(ff) * 1.944)
            o["VTO"] = {"dd": 0 if dd == "00" else (int(dd) * 10 if dd != "99" else 0), "ff": ffv, "VRB": 1 if dd == "99" else 0}
    nubes_sec1 = False
    for x in sec1[2:]:
        k = x[0]
        if k == "0":       # 00fff viento > 99
            continue
        if k == "1": t_ = _t(x); t_ is not None and o.setdefault("Ts", {"Ts": t_})
        elif k == "2" and x[1] in "01": t_ = _t(x); t_ is not None and o.setdefault("Td", {"Td": t_})
        elif k == "3": p_ = _p(x); p_ is not None and o.setdefault("QFE", {"QFE": p_})
        elif k == "4": p_ = _p(x); p_ is not None and o.setdefault("QFF", {"QFF": p_})
        elif k == "5" and x[1:].isdigit(): o["a"] = {"a": int(x[1]), "ppp": int(x[2:]) / 10}
        elif k == "6":
            r, tz, tr = _rrr(x)
            if r is not None and tr in ("1", "/"): o["RRR6"] = {"RRR6": r, "Traza": tz}
        elif k == "7" and x[1:3].isdigit():
            o["WWSINOP"] = {"ww": int(x[1:3])}
            if x[3:5].isdigit(): o["W1W2"] = {"W1": int(x[3]), "W2": int(x[4])}
        elif k == "8" and not nubes_sec1:
            nubes_sec1 = True
            c = lambda y: SEN.SD if y == "/" else int(y)          # «/»: no se ve (cubierto por la capa inferior)
            o["Nubes"] = {"Nh": c(x[1]), "Cl": c(x[2]), "Cm": c(x[3]), "Ch": c(x[4])}
    capas = []
    for x in sec3:
        k = x[0]
        if k == "1": t_ = _t(x); t_ is not None and o.setdefault("_Tx", t_)
        elif k == "2": t_ = _t(x); t_ is not None and o.setdefault("_Tn", t_)
        elif k == "7" and x[1:].isdigit(): o["RRR24"] = {"RRR24": int(x[1:]) / 10}
        elif k == "8" and x[1].isdigit() and x[3:5].isdigit():
            capas.append((int(x[1]), None if x[2] == "/" else int(x[2]), _hs(x[3:5])))
        elif x.startswith("910") and x[3:].isdigit(): o["Racha"] = {"fmfm": int(x[3:])}
    if capas:
        cn = {}
        for i, (ns, c_, hs) in enumerate(capas[:6]):
            suf = "" if i == 0 else str(i + 1)
            cn["Ns" + suf], cn["C" + suf], cn["hshshs" + suf] = ns, c_, hs
        o["CapaNube"] = cn
    return o


# ---------------------------------------------------------------- METAR
RX_WX = re.compile(r"^(\+|-|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+)$")


def decodificar_metar(msg):
    g = msg.replace("=", "").split()
    m = {"fen": [], "re": [], "nubes": [], "auto": "AUTO" in g}
    for x in g[2:]:
        if re.match(r"^\d{6}Z$", x): continue
        w = re.match(r"^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$", x)
        if w:
            m["dd"] = 0 if w.group(1) == "VRB" else int(w.group(1)); m["vrb"] = w.group(1) == "VRB"; m["ff"] = int(w.group(2))
            m["fx"] = int(w.group(3)) if w.group(3) else None
            continue
        if re.match(r"^\d{3}V\d{3}$", x): m["dn"], m["dx"] = int(x[:3]), int(x[4:]); continue
        if x == "CAVOK": m["vis"] = 10000; continue
        if re.match(r"^\d{4}$", x) and "vis" not in m: m["vis"] = 10000 if x == "9999" else int(x); continue
        if x.startswith("RE") and RX_WX.match(x[2:]): m["re"].append(x); continue
        wx = RX_WX.match(x)
        if wx:
            m["fen"].append(x); continue
        c = re.match(r"^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$", x)
        if c: m["nubes"].append((c.group(1), int(c.group(2)) * 100, c.group(3))); continue
        t = re.match(r"^(M?\d{2})/(M?\d{2})?$", x)
        if t:
            f = lambda s: -int(s[1:]) if s.startswith("M") else int(s)
            m["T"] = f(t.group(1)); m["Td"] = f(t.group(2)) if t.group(2) else None
            continue
        q = re.match(r"^Q(\d{4})$", x)
        if q: m["Q"] = int(q.group(1))
    return m


def _fen_saclim(fen):
    """Fenómenos METAR → componentes WWMETAR de SACLIM (solo los códigos conocidos; el resto queda fuera)."""
    out, i = {}, 0
    for x in fen:
        for sig in re.findall(r"DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS", x):
            if sig in FEN_COD and i < 3:
                out[("FEN1", "FEN2", "FEN3")[i]] = FEN_COD[sig]; i += 1
    return out


# ---------------------------------------------------------------- observación de cada hora
def armar(dias):
    """dias: {date: {'metar': [...], 'synop': [...]}} → (obs {Timestamp: obs SACLIM}, mensajes {Timestamp: {'metar','synop'}})."""
    obs, msj = {}, {}
    for dia, M in dias.items():
        for tipo in ("metar", "synop"):
            for hh, txt in M[tipo]:
                t = pd.Timestamp(f"{dia} {hh}")
                if t.minute:            # SPECI u horas no redondas
                    continue
                msj.setdefault(t, {})[tipo] = txt
    for t, mm in sorted(msj.items()):
        o = {"_obs": True}
        mt = decodificar_metar(mm["metar"]) if "metar" in mm else None
        if mt:
            if mt.get("auto"): o["_obs"] = False
            if "dd" in mt: o["VTO"] = {"dd": mt["dd"], "ff": mt["ff"], "VRB": int(mt["vrb"])}
            if mt.get("fx"): o["Racha"] = {"fmfm": mt["fx"]}
            if "dn" in mt: o["VarDirVto"] = {"dndndn": mt["dn"], "dxdxdx": mt["dx"]}
            if "vis" in mt: o["VVMETAR"] = {"Reinante": mt["vis"]}
            if "Q" in mt: o["QNH"] = {"QNH": mt["Q"]}
            w = _fen_saclim(mt["fen"])
            o["WWMETAR"] = {k: w.get(k, SEN.SD) for k in ("FEN1", "FEN12", "FEN13", "FEN2", "FEN22", "FEN23", "FEN3", "FEN32", "FEN33")}
            o["WWMETAR"].update({k: v for k, v in w.items()})
            o["reWW"] = {"reWW": 1 if mt["re"] else SEN.SD}
            o["_9999"] = mt.get("vis") == 10000
        if "synop" in mm:
            s = decodificar_synop(mm["synop"])
            for k, val in s.items():
                if not k.startswith("_"): o[k] = val          # el SYNOP manda (Ts y Td con décimas, viento del observador)
            if "_Tx" in s and t.hour == 0: o["TxPM"] = {"TxPM": s["_Tx"]}
            if "_Tn" in s and t.hour == 12: o["TnAM"] = {"TnAM": s["_Tn"]}
            if o.get("_9999") and "VVSINOP" in o and "VVMETAR" in o:     # 9999 es «10 km o más»: no contradice un VV mayor
                o["VVMETAR"]["Reinante"] = max(10000, o["VVSINOP"]["VV"])
            if s.get("_ix") == "2" and "WWSINOP" not in o:
                o["_sin7"] = True               # «nada que informar»: ww 00–03 y W1W2 0–2 no viajan
        obs[t] = o
    return obs, msj


# ---------------------------------------------------------------- reglas propias del período
def coherencia(t, mm):
    """METAR y SYNOP de la misma hora deben decir lo mismo."""
    out = []
    if not ("metar" in mm and "synop" in mm):
        return out
    m, s = decodificar_metar(mm["metar"]), decodificar_synop(mm["synop"])
    add = lambda niv, msg: out.append(("mensajes", "CMS", niv, msg))
    rnd = lambda x: int(x + 0.5) if x >= 0 else -int(-x + 0.5)
    for el, km in (("Ts", "T"), ("Td", "Td")):
        a, b = (s.get(el) or {}).get(el), m.get(km)
        if a is not None and b is not None and abs(rnd(a) - b) >= 1:
            add(2, f"{el} {a:g} °C en el SYNOP y {b} °C en el METAR (redondeado debería ir {rnd(a)})")
    vs, ff_m = s.get("VTO"), m.get("ff")
    if vs and ff_m is not None:
        if abs(vs["ff"] - ff_m) >= 3:
            add(1, f"viento {vs['ff']} kt en el SYNOP y {ff_m} kt en el METAR")
        elif vs["ff"] >= 6 and ff_m >= 6 and not vs["VRB"] and not m.get("vrb"):
            d = abs(vs["dd"] - m["dd"]) % 360; d = min(d, 360 - d)
            if d > 30:
                add(1, f"dirección del viento {vs['dd']}° en el SYNOP y {m['dd']}° en el METAR")
    ww = (s.get("WWSINOP") or {}).get("ww")
    pm = any(p in x for x in m["fen"] for p in PRECIP_M)
    if ww is not None:
        if (ww in SEN.PRECIP) != pm:
            add(1, f"ww {ww} en el SYNOP y METAR con {' '.join(m['fen']) or 'sin fenómenos'}: uno informa precipitación y el otro no")
    elif pm:
        add(1, f"METAR con {' '.join(m['fen'])} y el SYNOP sin grupo 7wwW1W2: con precipitación el grupo 7 es obligatorio")
    return out


def faltantes(msj, desde, hasta):
    """Horas del programa (las que la estación cubre al menos la mitad de los días) sin mensaje."""
    out = []
    dias = pd.date_range(desde, hasta, freq="D")
    if len(dias) < 2:
        return out
    for tipo, paso in (("metar", 1), ("synop", 3)):
        horas = {}
        for t, mm in msj.items():
            if tipo in mm: horas.setdefault(t.hour, set()).add(t.normalize())
        prog = sorted(h for h, ds in horas.items() if len(ds) >= len(dias) / 2)
        for d in dias:
            for h in prog:
                t = d + pd.Timedelta(hours=h)
                if tipo not in msj.get(t, {}):
                    out.append(dict(hora=str(t), tipo="mensajes", regla="FALTA", nivel=1, revisado="no",
                                    msg=f"falta el {tipo.upper()} de las {h:02d} UTC (la estación lo emite en {len(horas[h])} de {len(dias)} días)"))
    return out


# ---------------------------------------------------------------- revisión
def revisar(cod, desde, hasta, A=None, pausa=0.4, log=print):
    desde, hasta = pd.Timestamp(desde).normalize(), pd.Timestamp(hasta).normalize()
    dias, fallas = {}, []
    for d in pd.date_range(desde, hasta, freq="D"):
        try:
            dias[d.date()] = descargar_dia(cod, d)
        except Exception as e:
            fallas.append(f"{d:%d-%m-%Y}: {e}")
        time.sleep(pausa)
    obs, msj = armar(dias)
    if A is None:
        A = pd.DataFrame(columns=["codigo", "momento"])
    hall = SEN.revisar(cod, obs, A, horas=len(obs)) if obs else []
    for t, mm in msj.items():
        for tipo, regla, niv, msg in coherencia(t, mm):
            hall.append(dict(codigo=str(cod), hora=str(t), tipo=tipo, regla=regla, nivel=niv, msg=msg, revisado="no"))
    for h in faltantes(msj, desde, hasta):
        h["codigo"] = str(cod); hall.append(h)
    hall.sort(key=lambda h: (h["hora"], -h["nivel"]))
    n_m = sum(1 for mm in msj.values() if "metar" in mm); n_s = sum(1 for mm in msj.values() if "synop" in mm)
    con_ema = A is not None and len(A) > 0
    return dict(codigo=str(cod), desde=str(desde.date()), hasta=str(hasta.date()), dias=len(dias), metar=n_m, synop=n_s,
                con_ema=bool(con_ema), fallas=fallas, hallazgos=hall,
                mensajes={str(t): mm for t, mm in sorted(msj.items())})
