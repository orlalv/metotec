"""Lluvia del modelo (Open-Meteo, pronósticos históricos) en el punto de cada estación, para validar SICCAP-DMC con fechas pasadas.
Guarda  datos/modelo_pt/{código}.json  →  {"cod", "dias": {"AAAA-MM-DD": [mm del día UTC, máx. mm en una hora]}}
Uso:  python qc/modelo_puntos.py <carpeta_datos> <desde AAAA-MM-DD> <hasta AAAA-MM-DD> [códigos separados por coma]
Se fusiona con lo ya guardado (se pueden pedir varias ventanas)."""
import json, sys, time
from pathlib import Path
import requests

URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
EXTRA = {"420014": (-(42 + 20 / 60 + 25 / 3600), -(73 + 42 / 60 + 57 / 3600))}   # Mocopulli (Dalcahue)


def main():
    raiz = Path(sys.argv[1]); desde, hasta = sys.argv[2], sys.argv[3]
    cods = [c for c in (sys.argv[4].split(",") if len(sys.argv) > 4 else []) if c]
    est = json.load(open(raiz / "estaciones.json", encoding="utf-8"))
    pos = {str(e["codigo"]): (float(e["lat"]), float(e["lon"])) for e in est if e.get("lat") is not None and e.get("lon") is not None}
    for c, p in EXTRA.items():
        pos.setdefault(c, p)
    if cods:
        pos = {c: p for c, p in pos.items() if c in cods}
    (raiz / "modelo_pt").mkdir(parents=True, exist_ok=True)
    ok = mal = 0
    for c, (la, lo) in sorted(pos.items()):
        r = None
        for intento in range(5):
            try:
                r = requests.get(URL, params={"latitude": round(la, 4), "longitude": round(lo, 4), "start_date": desde, "end_date": hasta,
                                              "hourly": "precipitation", "timezone": "UTC"}, timeout=60)
                if r.status_code == 429:
                    time.sleep(20 * (intento + 1)); continue
                break
            except requests.RequestException as e:
                print(c, "intento", intento + 1, type(e).__name__, flush=True); time.sleep(10 * (intento + 1)); r = None
        if r is None or r.status_code != 200:
            print(c, "error", None if r is None else r.status_code, flush=True); mal += 1; continue
        h = r.json()["hourly"]; dias = {}
        for t, v in zip(h["time"], h["precipitation"]):
            if v is None:
                continue
            d = t[:10]; s = dias.setdefault(d, [0.0, 0.0]); s[0] += v; s[1] = max(s[1], v)
        f = raiz / "modelo_pt" / f"{c}.json"
        ant = json.load(open(f))["dias"] if f.exists() else {}
        ant.update({d: [round(a, 2), round(b, 2)] for d, (a, b) in dias.items()})
        f.write_text(json.dumps(dict(cod=c, dias=dict(sorted(ant.items()))), separators=(",", ":")))
        ok += 1; time.sleep(0.4)
    print(f"listo: {ok} estaciones, {mal} con error")


if __name__ == "__main__":
    main()
