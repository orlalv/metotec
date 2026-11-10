"""Revisión inmediata de las observaciones de una o más estaciones (pedida con el botón «Revisar ahora» de la página).
Vuelve a leer SACLIM, aplica todas las reglas y reemplaza esas estaciones en qc/sensorial (KV); además actualiza el historial
(si la alerta ya no está, queda como «corregido»)."""
import argparse, json, os, sys
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd, requests
sys.path.insert(0, str(Path(__file__).parent))
import dmc, sensorial as SEN, historial as HIS
from correr import leer_archivo, subir_kv


def kv_get(clave):
    acc, tok, ns = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN"), os.environ.get("KV_ID")
    r = requests.get(f"https://api.cloudflare.com/client/v4/accounts/{acc}/storage/kv/namespaces/{ns}/values/{clave}",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=60)
    return r.json() if r.ok else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cods", required=True)
    ap.add_argument("--datos", default="datos")
    a = ap.parse_args()
    cods = [c for c in a.cods.split(",") if c.strip()]
    S = kv_get("qc/sensorial") or {"estaciones": []}
    por = {e["codigo"]: e for e in S.get("estaciones", [])}
    A_todo = leer_archivo(a.datos, pd.Timestamp.utcnow().tz_localize(None), horas=26)
    ahora = datetime.now(timezone.utc)
    hechos, revisadas, res = {}, {}, []
    for cod in cods:
        obs = SEN.leer(dmc.descargar(f"getRecientesSaclim/{cod}", timeout=90))
        A = A_todo[A_todo["codigo"] == cod] if len(A_todo) else A_todo
        hall = SEN.revisar(cod, obs, A, horas=12)
        e = por.get(cod, {"codigo": cod})
        e.update(ultima=str(max(obs)) if obs else None, horas=len(obs), hallazgos=hall, nivel=max([h["nivel"] for h in hall], default=0))
        por[cod] = e; res.append(e)
        revisadas[cod] = [str(t) for t in sorted(obs)[-12:]]
        hechos[cod] = dict(hora=ahora.isoformat(timespec="seconds"), hallazgos=len(hall))
        print(cod, len(obs), "observaciones,", len(hall), "hallazgos")
    S["estaciones"] = list(por.values())
    print("kv sensorial:", subir_kv("qc/sensorial", json.dumps(S, ensure_ascii=False, default=str)))
    prev = kv_get("qc/revisado_ahora") or {}
    prev.update(hechos)
    subir_kv("qc/revisado_ahora", json.dumps(prev))
    try:
        dias = HIS.actualizar(a.datos, ahora, res, revisadas, [], {})
        for d, t in (dias or {}).items():
            subir_kv(f"qc/hist/{d}", t)
    except Exception as ex:
        print("historial:", ex)


if __name__ == "__main__":
    main()
