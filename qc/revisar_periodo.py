"""Atiende un pedido de «Revisar período»: baja los mensajes METAR/SYNOP de SACLIM de cada día, los revisa con las reglas de
sensorial.py (más coherencia METAR–SYNOP y horas faltantes) y sube el resultado al KV (qc/periodo/{id})."""
import argparse, json, sys
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
sys.path.insert(0, str(Path(__file__).parent))
import periodo as P
from correr import leer_archivo, subir_kv

INICIO_ARCHIVO = pd.Timestamp("2026-11-08 18:00")        # desde aquí METOTEC guarda el minutario de las EMA


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pedido", required=True, help="JSON {id, cod, desde, hasta}")
    ap.add_argument("--datos", default="datos")
    a = ap.parse_args()
    p = json.loads(a.pedido)
    clave = f"qc/periodo/{p['id']}"
    subir_kv(clave, json.dumps({**p, "estado": "revisando"}))
    try:
        desde, hasta = pd.Timestamp(p["desde"]), pd.Timestamp(p["hasta"])
        A = None
        fin = hasta + pd.Timedelta(hours=24)
        if fin > INICIO_ARCHIVO:
            horas = int((fin - max(desde - pd.Timedelta(hours=14), INICIO_ARCHIVO)) / pd.Timedelta(hours=1)) + 1
            A = leer_archivo(a.datos, fin, horas=horas)
            A = A[A["codigo"] == p["cod"]] if len(A) else None
        R = P.revisar(p["cod"], desde, hasta, A)
        try:
            E = {e["codigo"]: e for e in json.loads((Path(a.datos) / "estaciones.json").read_text())}
            R["nombre"] = E.get(p["cod"], {}).get("nombre")
        except Exception:
            pass
        R.update(id=p["id"], pedido=p.get("pedido"), estado="listo", generado=datetime.now(timezone.utc).isoformat(timespec="seconds"))
        txt = json.dumps(R, ensure_ascii=False, default=str)
        print(p["id"], R["metar"], "METAR,", R["synop"], "SYNOP,", len(R["hallazgos"]), "hallazgos,", len(txt) // 1024, "kB")
        print("kv:", subir_kv(clave, txt))
    except Exception as e:
        print("error:", e)
        subir_kv(clave, json.dumps({**p, "estado": "error", "error": str(e)}))
        raise


if __name__ == "__main__":
    main()
