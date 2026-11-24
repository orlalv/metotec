"""Compendio Agro: top nacional semanal (jueves a miércoles) de Tmax, Tmin y precipitación, armado con los boletines
regionales de climatología de la DMC (uno por región y por día). Corre en GitHub Actions (el sitio no es accesible desde fuera).

Fuentes (un día por página):
  Temperaturas: .../diariob/boletinTemperaturaAutomaticoRegional/{REG}/{AAAA}/{MM}/{DD}
      Nota técnica de la página: mínima y máxima entre ~21:01 del día anterior y 21:00 del día (hora local); media = (mín + máx) / 2.
  Precipitación: .../diario/boletinPluviometricoAutomaticoRegional/{REG}/{AAAA}/{MM}/{DD}
      Nota técnica: total diario entre ~8:00 del día y 8:00 del día siguiente (hora local). Por eso el miércoles se completa el jueves 8:00.
Símbolos: «.» = sin dato. «s/p» = sin precipitación (0 mm): la página no lo define, pero en la semana de prueba (12–18 nov 2026)
  Quinta Normal marca «s/p» todos los días secos y 1.2 el único día con lluvia; se cuenta como 0 mm (día con dato).

Uso:  python qc/agro_boletin.py --datos datos [--semana AAAA-MM-DD (jueves)]
Salida: datos/agro/<jueves>.json, y en el KV «qc/agro_bol/<jueves>» y «qc/agro_bol/ult».
"""
import argparse, html as HT, json, os, re, sys, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import requests

sys.path.insert(0, str(Path(__file__).parent))

CL = ZoneInfo("America/Santiago")
H = {"User-Agent": "Mozilla/5.0 (metotec; contacto.metotec@gmail.com)"}
URL_T = "https://climatologia.meteochile.gob.cl/application/diariob/boletinTemperaturaAutomaticoRegional/{reg}/{d:%Y/%m/%d}"
URL_P = "https://climatologia.meteochile.gob.cl/application/diario/boletinPluviometricoAutomaticoRegional/{reg}/{d:%Y/%m/%d}"

# ------------------------------------------------------------------ parámetros (fáciles de cambiar; pendientes con el jefe de agro)
REGIONES = {"04": "Coquimbo", "05": "Valparaíso", "13": "Metropolitana", "06": "O'Higgins", "07": "Maule",
            "16": "Ñuble", "08": "Biobío", "09": "La Araucanía", "14": "Los Ríos", "10": "Los Lagos"}
DIA = "boletin"            # (a) "boletin": el día tal como lo publica la DMC (T 21:01–21:00, PP 8:00–8:00 local). "utc" requeriría minutarios.
PP_RANKING = "diario"      # (b) "diario": mayores valores diarios · "semanal": mayores acumulados de la semana
ENVIAR_ESTACIONES = True   # (c) incluir estación y valores en el compendio exportado
TOP_GUARDA = 30            # se guardan más de 10 por ranking: al sacar uno, sube el siguiente
TOP_DIA = 5                # candidatos guardados por día y por región
PAUSA = 1.0                # segundos entre páginas (no saturar el sitio)

RANGO_T = (-20.0, 45.0)    # rango físico para estas regiones en la temporada (Coquimbo a Los Lagos); ajustar en invierno
RANGO_PP = (0.0, 300.0)    # mm/día
PP_DUDOSO = 150.0          # mm/día: marcado ⚠ y listado en Calidad
MEDIA_TOL = 0.25           # |media − (mín+máx)/2| > tol → la fila es incoherente (dudosa)
ANOM_REG = 12.0            # °C: diferencia con la mediana de la región ese día → dudoso (marcado; se saca a mano)


def txt(s):
    return re.sub(r"\s+", " ", HT.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def bajar(url, intentos=4):
    for i in range(intentos):
        try:
            r = requests.get(url, headers=H, timeout=60)
            if r.status_code == 200:
                return r.content.decode("utf-8", "replace")
            if r.status_code == 404:
                return None
        except requests.RequestException:
            pass
        time.sleep(3 * (i + 1))
    return None


def parsear(html, ncols_val):
    """Filas de la única tabla del boletín: (cod, nombre, provincia, comuna, propietario, [valores…]). Tolera <th> mezclados con <td>."""
    if not html or "<table" not in html:
        return [], None
    m = re.search(r"Integración de Estaciones Automáticas\s*(.*?)\s*(\d{1,2} de \w+ de \d{4})", txt(html[:html.find("<table")]))
    titulo = (m.group(1).strip(), m.group(2)) if m else None
    tab = html[html.find("<table"):html.find("</table>")]
    filas = []
    for tr in re.findall(r"<tr>(.*?)</tr>", tab, re.S):
        celdas = [txt(c) for c in re.findall(r"<t[dh][^>]*>(.*?)(?=<t[dh][\s>]|</tr>|$)", tr, re.S)]
        if len(celdas) < 5 + ncols_val or not re.fullmatch(r"\d{4,8}", celdas[0] or ""):
            continue
        filas.append(dict(cod=celdas[0], nombre=celdas[1], provincia=celdas[2], comuna=celdas[3], prop=celdas[4], v=celdas[5:5 + ncols_val]))
    return filas, titulo


def valor(s):
    s = (s or "").strip()
    if re.fullmatch(r"-?\d+(\.\d+)?", s):
        return float(s), None
    if s.lower() == "s/p":
        return 0.0, "s/p"
    return None, None          # «.», «—» o vacío: sin dato


def semana_por_defecto(hoy=None):
    """Último periodo jueves–miércoles ya cerrado (el jueves corre la semana que terminó ayer)."""
    hoy = hoy or datetime.now(CL).date()
    atras = (hoy.weekday() - 3) % 7 or 7      # jueves = 3
    return hoy - timedelta(days=atras)


def descargar(jueves):
    dias = [jueves + timedelta(days=k) for k in range(7)]
    crudo, estado = {}, {}
    for reg in REGIONES:
        for d in dias:
            for tipo, url, n in (("t", URL_T, 3), ("p", URL_P, 1)):
                h = bajar(url.format(reg=reg, d=d))
                filas, tit = parsear(h, n)
                crudo.setdefault(reg, {}).setdefault(d.isoformat(), {})[tipo] = filas
                estado.setdefault(reg, {}).setdefault(d.isoformat(), {})[tipo] = dict(n=len(filas), titulo=tit and tit[0], fecha=tit and tit[1], ok=h is not None)
                time.sleep(PAUSA)
    return dias, crudo, estado


def armar(jueves, dias, crudo, estado):
    T, P, cal, est = [], [], [], {}
    for reg, porDia in crudo.items():
        for k, d in enumerate(dias):
            iso = d.isoformat()
            for f in porDia.get(iso, {}).get("t", []):
                est.setdefault(f["cod"], dict(cod=f["cod"], nombre=f["nombre"], prov=f["provincia"], comuna=f["comuna"], prop=f["prop"], reg=reg))
                me, _ = valor(f["v"][0]); mn, _ = valor(f["v"][1]); mx, _ = valor(f["v"][2])
                base = dict(cod=f["cod"], reg=reg, dia=k, fecha=iso)
                motivos = []
                if mn is not None and mx is not None and mn > mx:
                    motivos.append(f"mínima {mn} mayor que máxima {mx}")
                dud = f"media {me} distinta de (mín+máx)/2 = {(mn + mx) / 2:.1f}" if (mn is not None and mx is not None and me is not None and abs(me - (mn + mx) / 2) > MEDIA_TOL) else ""
                for vk, x in (("tmax", mx), ("tmin", mn)):
                    if x is None:
                        continue
                    m2 = list(motivos)
                    if not RANGO_T[0] <= x <= RANGO_T[1]:
                        m2.append(f"{x} °C fuera de rango físico {RANGO_T}")
                    r = dict(base, vk=vk, valor=x, estado="error" if m2 else ("dudoso" if dud else "ok"), motivo="; ".join(m2) or dud)
                    T.append(r)
                    if r["estado"] != "ok":
                        cal.append(r)
            for f in porDia.get(iso, {}).get("p", []):
                est.setdefault(f["cod"], dict(cod=f["cod"], nombre=f["nombre"], prov=f["provincia"], comuna=f["comuna"], prop=f["prop"], reg=reg))
                x, simb = valor(f["v"][0])
                base = dict(cod=f["cod"], reg=reg, dia=k, fecha=iso, vk="pp24")
                if x is None:
                    continue
                if not RANGO_PP[0] <= x <= RANGO_PP[1]:
                    r = dict(base, valor=x, estado="error", motivo=f"{x} mm fuera de rango físico")
                elif x >= PP_DUDOSO:
                    r = dict(base, valor=x, estado="dudoso", motivo=f"{x} mm ≥ {PP_DUDOSO} mm en un día")
                else:
                    r = dict(base, valor=x, estado="ok", motivo="")
                P.append(r)
                if r["estado"] != "ok":
                    cal.append(r)
    # dudosos: 0,0 exacto repetido en la semana (valor de relleno) o 0,0 muy lejos de la región
    ceros = {}
    for r in T:
        if r["estado"] == "ok" and r["valor"] == 0.0:
            ceros.setdefault((r["cod"], r["vk"]), []).append(r)
    for (cod, vk), L in ceros.items():
        if len(L) >= 2:
            for r in L:
                r.update(estado="dudoso", motivo=f"{'Tmin' if vk == 'tmin' else 'Tmax'} exactamente 0,0 °C en {len(L)} días de la semana (posible valor de relleno)"); cal.append(r)
    # dudosos: muy lejos de la mediana regional del mismo día (p. ej. Tmax 4 °C con la región en 25 °C)
    import statistics
    grupos = {}
    for r in T:
        if r["estado"] == "ok":
            grupos.setdefault((r["reg"], r["dia"], r["vk"]), []).append(r["valor"])
    for r in T:
        g = grupos.get((r["reg"], r["dia"], r["vk"]), [])
        if r["estado"] == "ok" and len(g) >= 5:
            med = statistics.median(g)
            if abs(r["valor"] - med) > ANOM_REG:
                r.update(estado="dudoso", motivo=f"{r['valor']} °C a {abs(r['valor'] - med):.1f} °C de la mediana regional del día ({med:.1f} °C)")
                cal.append(r)
    for r in [x for x in T if x["estado"] == "dudoso" and "mediana" in x["motivo"]]:     # si la máxima o la mínima es dudosa, la fila entera lo es
        for o in T:
            if o is not r and o["cod"] == r["cod"] and o["dia"] == r["dia"] and o["estado"] == "ok":
                o.update(estado="dudoso", motivo=f"misma fila que {'Tmax' if r['vk'] == 'tmax' else 'Tmin'} dudosa ({r['motivo']})"); cal.append(o)
    # acumulado semanal (solo valores válidos) y días con dato
    acum, ndias = {}, {}
    for r in P:
        if r["estado"] != "error":                                 # acumulado sin los errores groseros
            acum[r["cod"]] = round(acum.get(r["cod"], 0) + r["valor"], 1); ndias[r["cod"]] = ndias.get(r["cod"], 0) + 1
    for r in P:
        r["acum"] = acum.get(r["cod"]); r["ndias"] = ndias.get(r["cod"], 0)

    ok = lambda L: [r for r in L if r["estado"] != "error"]   # errores groseros (mín > máx, fuera de rango) fuera; dudosos entran marcados ⚠ y se sacan a mano
    tmax = sorted(ok([r for r in T if r["vk"] == "tmax"]), key=lambda r: -r["valor"])
    tmin = sorted(ok([r for r in T if r["vk"] == "tmin"]), key=lambda r: r["valor"])
    ppd = sorted([r for r in P if r["estado"] != "error" and r["valor"] > 0], key=lambda r: (-r["valor"], -(r["acum"] or 0)))
    pps = sorted([dict(cod=c, reg=est[c]["reg"], vk="pp24", valor=v, acum=v, ndias=ndias[c], dia=None, fecha=None, estado="ok", motivo="")
                  for c, v in acum.items() if v > 0], key=lambda r: -r["valor"])
    def corta(L, n=TOP_GUARDA):      # hasta juntar n datos «ok» (los marcados van intercalados, para sacarlos a mano)
        out, k = [], 0
        for r in L:
            out.append(r); k += r["estado"] == "ok"
            if k >= n:
                break
        return out
    ranking = dict(tmax=corta(tmax), tmin=corta(tmin), pp=corta(ppd if PP_RANKING == "diario" else pps), pp_semanal=corta(pps))
    por_dia = [dict(dia=k, fecha=d.isoformat(),
                    tmax=corta([r for r in tmax if r["dia"] == k], TOP_DIA), tmin=corta([r for r in tmin if r["dia"] == k], TOP_DIA), pp=corta([r for r in ppd if r["dia"] == k], TOP_DIA))
               for k, d in enumerate(dias)]
    por_region = [dict(reg=g, nombre=REGIONES[g],
                       tmax=corta([r for r in tmax if r["reg"] == g], TOP_DIA), tmin=corta([r for r in tmin if r["reg"] == g], TOP_DIA), pp=corta([r for r in ppd if r["reg"] == g], TOP_DIA))
                  for g in REGIONES]
    # serie de la semana de TODAS las estaciones [tmin, tmax, pp] por día: para la ventana de vecinas (misma provincia o región)
    serie = {}
    for r in T + P:
        v = serie.setdefault(r["cod"], [[None, None, None] for _ in dias])
        v[r["dia"]][{"tmin": 0, "tmax": 1, "pp24": 2}[r["vk"]]] = r["valor"]
    usados = set(serie) | {r["cod"] for r in cal}
    return dict(semana=jueves.isoformat(), dias=[d.isoformat() for d in dias], generado=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                parametros=dict(anom_reg=ANOM_REG, dia=DIA, pp_ranking=PP_RANKING, enviar_estaciones=ENVIAR_ESTACIONES, rango_t=RANGO_T, rango_pp=RANGO_PP, pp_dudoso=PP_DUDOSO, media_tol=MEDIA_TOL),
                notas=dict(t="Mínima y máxima entre ~21:01 del día anterior y 21:00 del día (hora local), según el boletín.",
                           pp="Total diario entre ~8:00 del día y 8:00 del día siguiente (hora local), según el boletín.",
                           sp="«s/p» se interpreta como sin precipitación (0 mm).",
                           qc="Los boletines no han pasado control de calidad. Los errores groseros (mínima > máxima, fuera de rango físico) quedan fuera del ranking y se listan en Calidad, donde se pueden devolver. Los dudosos (media incoherente, lejos de la mediana regional, 0,0 repetido) entran marcados ⚠ y se sacan a mano."),
                regiones=REGIONES, estaciones={c: e for c, e in est.items() if c in usados},
                serie=serie, ranking=ranking, por_dia=por_dia, por_region=por_region, calidad=cal, cobertura=estado)


# ------------------------------------------------------------------ ubicación: DMC por código (catálogo METOTEC), externas por nombre
import unicodedata
_RUIDO = {"inia", "i", "n", "a", "fdf", "dmc", "ad", "ap", "de", "del", "la", "el", "los", "las", "y", "estacion", "reg", "agricola", "esc"}
def _tok(s):
    s = unicodedata.normalize("NFD", str(s or "").lower()); s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return {t for t in re.split(r"[^a-z0-9]+", s) if len(t) > 1 and t not in _RUIDO}


def ubicar(est, raiz):
    """Agrega lat, lon, alt (y ext = id de la externa) a cada estación del compendio. Devuelve (n_dmc, n_ext, sin)."""
    dmc = {}
    try:
        dmc = {str(e["codigo"]): e for e in json.loads((Path(raiz) / "estaciones.json").read_text(encoding="utf-8"))}
    except Exception:
        pass
    cat = []
    try:
        import correr
        c = correr.leer_kv("qc/externas/cat") or {}
        cat = [x for x in c.get("estaciones", []) if x.get("lat") is not None]
    except Exception:
        pass
    toks = [(_tok(x.get("nombre")), x) for x in cat]
    nd = ne = 0; sin = []
    for cod, e in est.items():
        d = dmc.get(cod)
        if d and d.get("lat") is not None:
            e.update(lat=d["lat"], lon=d["lon"], alt=d.get("alt")); nd += 1; continue
        t = _tok(e["nombre"]) | _tok(e.get("comuna"))
        mejor, bs = None, 0.0
        for tk, x in toks:
            if not tk:
                continue
            sc = len(t & tk) / len(tk)
            if sc > bs:
                mejor, bs = x, sc
        if mejor and bs >= 0.6:
            e.update(lat=mejor["lat"], lon=mejor["lon"], alt=mejor.get("alt"), ext=mejor["id"], ext_nombre=mejor.get("nombre")); ne += 1
        else:
            sin.append(f"{cod} {e['nombre']}")
    return nd, ne, sin


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--datos", default="datos")
    a.add_argument("--semana", default="")   # vacío = semana por defecto
    a.add_argument("--sin-kv", action="store_true")
    o = a.parse_args()
    jueves = date.fromisoformat(o.semana) if o.semana else semana_por_defecto()
    if jueves.weekday() != 3:
        raise SystemExit(f"{jueves} no es jueves")
    dias, crudo, estado = descargar(jueves)
    C = armar(jueves, dias, crudo, estado)
    nd, ne, sin = ubicar(C["estaciones"], o.datos)
    print(f"ubicadas: {nd} DMC por código, {ne} externas por nombre, {len(sin)} sin ubicar:", "; ".join(sin[:60]))
    out = Path(o.datos) / "agro" / f"{jueves.isoformat()}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    txt_c = json.dumps(C, ensure_ascii=False, separators=(",", ":"))
    out.write_text(txt_c, encoding="utf-8")
    (Path(o.datos) / "agro" / f"{jueves.isoformat()}_crudo.json").write_text(json.dumps(crudo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for reg, ds in estado.items():
        print(reg, REGIONES[reg], "|", " ".join(f"{d[5:]}:T{v['t']['n']}/P{v['p']['n']}" for d, v in ds.items()), "|", next(iter(ds.values()))["t"]["titulo"])
    print("tmax", [(r["cod"], r["valor"]) for r in C["ranking"]["tmax"][:5]])
    print("tmin", [(r["cod"], r["valor"]) for r in C["ranking"]["tmin"][:5]])
    print("pp", [(r["cod"], r["valor"], r["acum"]) for r in C["ranking"]["pp"][:5]])
    print("calidad", len(C["calidad"]), "·", len(txt_c) // 1024, "kB")
    if not o.sin_kv:
        import correr
        print("kv:", correr.subir_kv(f"qc/agro_bol/{jueves.isoformat()}", txt_c), correr.subir_kv("qc/agro_bol/ult", txt_c))


if __name__ == "__main__":
    main()
