"""Estaciones externas (INIA, CEAZA, SERVIMET, ARAUCO…) desde la red agregada de agrometeorologia.cl, con las variables instrumentales.
Cada hora deja en el KV:  qc/externas/cat  (catálogo)  y  qc/externas/<VAR>  (valores por hora, ≈42 h, en UTC) para PP, TA, HR, VV, RD, PS, TS00, TS10.
INIA publica las horas en hora local de Chile; aquí se pasan a UTC ("AAAA-MM-DDTHH"). Se omiten DMC y MMA-DMC (ya vienen por la DMC).
Valores: PP mm · TA °C · HR % · VV [media, ráfaga, dirección°] (unidad de viento por confirmar) · RD (radiación) · PS (presión de estación, hPa) · TS00/TS10 °C suelo."""
import json, os, re, sys, time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import requests

H = {"User-Agent": "Mozilla/5.0 (metotec; contacto.metotec@gmail.com)"}
BASE = "https://agrometeorologia.cl/"
OMITIR = {"DMC", "MMA-DMC"}
CL = ZoneInfo("America/Santiago")
VARS = {"PP": ["PP-SUM"], "TA": ["TA-AVG"], "HR": ["HR-AVG"], "VV": ["VV-AVG", "VV-MAX", "DV-AVG"], "RD": ["RD-AVG"], "PS": ["PS-AVG"], "TS00": ["TS00-AVG"], "TS10": ["TS10-AVG"]}


def kv_put(clave, texto):
    acc, tok, ns = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN"), os.environ.get("KV_ID")
    if not (acc and tok and ns):
        return "sin credenciales"
    r = requests.put(f"https://api.cloudflare.com/client/v4/accounts/{acc}/storage/kv/namespaces/{ns}/values/{clave}",
                     headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, data=texto.encode("utf-8"), timeout=90)
    return str(r.status_code)


def num(v):
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return None


def utc(h):
    try:
        return datetime.strptime(h, "%Y-%m-%d %H:%M").replace(tzinfo=CL).astimezone(timezone.utc).strftime("%Y-%m-%dT%H")
    except ValueError:
        return None


def main():
    tmp = None
    for p in ("PP", "TA", "HR"):
        m = re.search(r"tmp\s*=\s*(tmp_\d+)", requests.get(BASE + p, headers=H, timeout=60).text)
        if m:
            tmp = m.group(1)
            break
    if not tmp:
        raise SystemExit("no encontré la carpeta tmp_… en las páginas de INIA")
    ahora = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cat, res, errores = {}, {}, []
    for var, campos in VARS.items():
        try:
            r = requests.get(f"{BASE}json/{tmp}/items-{var.lower()}.json", headers=H, timeout=180, params={"_": int(time.time() * 1000)})
            r.raise_for_status()
            D = r.json()
        except Exception as e:
            errores.append(f"{var}: {type(e).__name__} {str(e)[:80]}")
            continue
        datos, horas = {}, set()
        for e in D:
            sig = e.get("institucion_sigla")
            if not sig or sig in OMITIR:
                continue
            try:
                lat, lon = float(e["latitud"]), float(e["longitud"])
            except (KeyError, TypeError, ValueError):
                continue
            ident = f"{sig}:{e.get('id')}"
            cat.setdefault(ident, {"id": ident, "nombre": e.get("nombre"), "inst": sig, "lat": lat, "lon": lon, "alt": num(e.get("elevacion")), "estado": e.get("status_name")})
            serie = {}
            for k, v in (e.get("STACK-HOUR") or {}).items():
                t = utc(k)
                if not t or not isinstance(v, dict):
                    continue
                vals = [num(v.get(c)) for c in campos]
                if any(x is not None for x in vals):
                    serie[t] = vals[0] if len(campos) == 1 else vals
                    horas.add(t)
            if serie:
                datos[ident] = serie
        hs = sorted(horas)
        txt = json.dumps({"generado": ahora, "var": var, "campos": campos, "horas": [hs[0], hs[-1]] if hs else None, "n": len(datos), "datos": datos}, ensure_ascii=False, separators=(",", ":"))
        res[var] = (len(datos), hs[-1] if hs else None, len(txt) // 1024, kv_put(f"qc/externas/{var}", txt))
        print(var, res[var], flush=True)
    txt = json.dumps({"generado": ahora, "fuente": "agrometeorologia.cl", "tmp": tmp, "n": len(cat), "estaciones": list(cat.values())}, ensure_ascii=False, separators=(",", ":"))
    print("cat", len(cat), len(txt) // 1024, "kB", kv_put("qc/externas/cat", txt))
    if errores:
        print("errores:", errores)
    if "PP" not in res:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
