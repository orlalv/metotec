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

RANGO_T = (-30.0, 45.0)    # rango físico para estas regiones (Coquimbo a Los Lagos, valle y costa; incluye cordillera media)
RANGO_PP = (0.0, 300.0)    # mm/día
PP_DUDOSO = 150.0          # mm/día: entra al ranking, pero marcado ⚠ y listado en Calidad
MEDIA_TOL = 0.25           # |media − (mín+máx)/2| > tol → la fila es incoherente (dudosa)
ANOM_REG = 12.0            # °C: diferencia con la mediana de la región ese día → dudoso (no entra al ranking; queda en Calidad)


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
                est.setdefault(f["cod"], dict(cod=f["cod"], nombre=f["nombre"], comuna=f["comuna"], prop=f["prop"], reg=reg))
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
                est.setdefault(f["cod"], dict(cod=f["cod"], nombre=f["nombre"], comuna=f["comuna"], prop=f["prop"], reg=reg))
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
        if r["estado"] != "error":                                 # en lluvia, los dudosos (≥ 150 mm) sí cuentan, marcados
            acum[r["cod"]] = round(acum.get(r["cod"], 0) + r["valor"], 1); ndias[r["cod"]] = ndias.get(r["cod"], 0) + 1
    for r in P:
        r["acum"] = acum.get(r["cod"]); r["ndias"] = ndias.get(r["cod"], 0)

    ok = lambda L: [r for r in L if r["estado"] == "ok"]          # errores y dudosos no entran al ranking (quedan en Calidad)
    tmax = sorted(ok([r for r in T if r["vk"] == "tmax"]), key=lambda r: -r["valor"])
    tmin = sorted(ok([r for r in T if r["vk"] == "tmin"]), key=lambda r: r["valor"])
    ppd = sorted([r for r in P if r["estado"] != "error" and r["valor"] > 0], key=lambda r: (-r["valor"], -(r["acum"] or 0)))
    pps = sorted([dict(cod=c, reg=est[c]["reg"], vk="pp24", valor=v, acum=v, ndias=ndias[c], dia=None, fecha=None, estado="ok", motivo="")
                  for c, v in acum.items() if v > 0], key=lambda r: -r["valor"])
    ranking = dict(tmax=tmax[:TOP_GUARDA], tmin=tmin[:TOP_GUARDA], pp=(ppd if PP_RANKING == "diario" else pps)[:TOP_GUARDA], pp_semanal=pps[:TOP_GUARDA])
    por_dia = [dict(dia=k, fecha=d.isoformat(),
                    tmax=[r for r in tmax if r["dia"] == k][:TOP_DIA], tmin=[r for r in tmin if r["dia"] == k][:TOP_DIA], pp=[r for r in ppd if r["dia"] == k][:TOP_DIA])
               for k, d in enumerate(dias)]
    por_region = [dict(reg=g, nombre=REGIONES[g],
                       tmax=[r for r in tmax if r["reg"] == g][:TOP_DIA], tmin=[r for r in tmin if r["reg"] == g][:TOP_DIA], pp=[r for r in ppd if r["reg"] == g][:TOP_DIA])
                  for g in REGIONES]
    usados = {r["cod"] for L in (T, P, cal) for r in L}
    return dict(semana=jueves.isoformat(), dias=[d.isoformat() for d in dias], generado=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                parametros=dict(anom_reg=ANOM_REG, dia=DIA, pp_ranking=PP_RANKING, enviar_estaciones=ENVIAR_ESTACIONES, rango_t=RANGO_T, rango_pp=RANGO_PP, pp_dudoso=PP_DUDOSO, media_tol=MEDIA_TOL),
                notas=dict(t="Mínima y máxima entre ~21:01 del día anterior y 21:00 del día (hora local), según el boletín.",
                           pp="Total diario entre ~8:00 del día y 8:00 del día siguiente (hora local), según el boletín.",
                           sp="«s/p» se interpreta como sin precipitación (0 mm).",
                           qc="Los boletines no han pasado control de calidad; se excluyen mínima > máxima y valores fuera de rango físico. Tampoco entran, y quedan en Calidad como dudosos, los valores a más de 12 °C de la mediana regional del día y las filas con media incoherente."),
                regiones=REGIONES, estaciones={c: e for c, e in est.items() if c in usados},
                ranking=ranking, por_dia=por_dia, por_region=por_region, calidad=cal, cobertura=estado)


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
