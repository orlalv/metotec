"""Sondeo temporal: guarda HTML de boletines regionales para diseñar el parser del compendio Agro."""
import pathlib, sys, time, requests
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
H = {"User-Agent": "Mozilla/5.0 (metotec; contacto.metotec@gmail.com)"}
T = "https://climatologia.meteochile.gob.cl/application/diariob/boletinTemperaturaAutomaticoRegional/{}/2026/11/24"
P = "https://climatologia.meteochile.gob.cl/application/diario/boletinPluviometricoAutomaticoRegional/{}/2026/11/{}"
for nom, u in [("t04", T.format("04")), ("p04", P.format("04", "24")), ("p10_21", P.format("10", "21")), ("p08_21", P.format("08", "21")), ("t13", T.format("13"))]:
    try:
        r = requests.get(u, headers=H, timeout=60); (out / f"{nom}.html").write_bytes(r.content); print(nom, r.status_code, len(r.content))
    except Exception as e:
        print(nom, "ERR", e)
    time.sleep(2)
