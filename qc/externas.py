"""Estaciones externas (INIA, CEAZA, SERVIMET, ARAUCO…) desde la red agregada de agrometeorologia.cl.
Baja la lluvia horaria (≈42 h) y diaria (≈7 días) y la deja compacta en el KV  qc/externas_pp  (la sirve /api/externas).
Se omiten DMC y MMA-DMC (ya vienen por la DMC). Las horas vienen tal cual las da INIA (hora local de Chile, por confirmar)."""
import json, os, re, sys, time
import requests

H = {"User-Agent": "Mozilla/5.0 (metotec; contacto.metotec@gmail.com)"}
BASE = "https://agrometeorologia.cl/"
OMITIR = {"DMC", "MMA-DMC"}


def kv_put(clave, texto):
    acc, tok, ns = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN"), os.environ.get("KV_ID")
    if not (acc and tok and ns):
        return "sin credenciales"
    r = requests.put(f"https://api.cloudflare.com/client/v4/accounts/{acc}/storage/kv/namespaces/{ns}/values/{clave}",
                     headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, data=texto.encode("utf-8"), timeout=60)
    return str(r.status_code)


def num(v):
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return None


def main():
    h = requests.get(BASE + "PP", headers=H, timeout=60)
    h.raise_for_status()
    m = re.search(r"tmp\s*=\s*(tmp_\d+)", h.text)
    if not m:
        raise SystemExit("no encontré la carpeta tmp_… en /PP")
    tmp = m.group(1)
    r = requests.get(f"{BASE}json/{tmp}/items-pp.json", headers=H, timeout=120, params={"_": int(time.time() * 1000)})
    r.raise_for_status()
    D = r.json()
    out, horas = [], set()
    for e in D:
        sig = e.get("institucion_sigla")
        if not sig or sig in OMITIR:
            continue
        try:
            lat, lon = float(e["latitud"]), float(e["longitud"])
        except (KeyError, TypeError, ValueError):
            continue
        hr = {k: num(v.get("PP-SUM")) for k, v in (e.get("STACK-HOUR") or {}).items() if isinstance(v, dict)}
        dia = {k: num(v.get("PP-SUM")) for k, v in (e.get("STACK-DAY") or {}).items() if isinstance(v, dict) and re.match(r"\d{4}-", k)}
        horas.update(hr)
        out.append({"id": f"{sig}:{e.get('id')}", "nombre": e.get("nombre"), "inst": sig, "lat": lat, "lon": lon, "alt": num(e.get("elevacion")),
                    "estado": e.get("status_name"), "h": hr, "d": dia})
    ks = sorted(horas)
    doc = {"generado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "fuente": "agrometeorologia.cl", "tmp": tmp,
           "horas": [ks[0], ks[-1]] if ks else None, "n": len(out), "estaciones": out}
    txt = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(D)} estaciones en INIA, {len(out)} externas, horas {doc['horas']}, {len(txt) // 1024} kB")
    print("kv:", kv_put("qc/externas_pp", txt))


if __name__ == "__main__":
    main()
