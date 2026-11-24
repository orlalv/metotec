"""Sondeo temporal 2: consulta en vista «tabla» (sin exportar) de agrometeorologia.cl para una estación y un mes."""
import json, pathlib, re, sys, requests
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
H = {"User-Agent": "Mozilla/5.0 (metotec; contacto.metotec@gmail.com)"}
B = "https://agrometeorologia.cl/"
s = requests.Session(); h = s.get(B, headers=H, timeout=60).text
ops = re.findall(r'<option value="([^"]+)"[^>]*>([^<]*)</option>', h[h.find('id="estaciones"'):h.find('id="variables"')])
print("estaciones en el formulario:", len(ops), ops[:8])
(out / "estaciones_form.json").write_text(json.dumps(ops, ensure_ascii=False))
cand = [v for v, n in ops if re.search(r"calle larga|san felipe|la platina", n, re.I)][:2] or [ops[0][0]]
for intervalo, desde, hasta in [("day", "01-10-2025", "31-10-2025"), ("hour", "01-10-2025", "02-10-2025")]:
    d = [("estaciones[]", c) for c in cand] + [("variables[]", v) for v in ("TA_MIN", "TA_MAX", "PP_SUM")] + [("intervalo", intervalo), ("desde", desde), ("hasta", hasta), ("vista[]", "tabla"), ("consultar", ""), ("website", "")]
    r = s.post(B, data=d, headers=H, timeout=90)
    t = r.text; (out / f"tabla_{intervalo}.html").write_text(t)
    tab = re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S)
    print(intervalo, r.status_code, len(t), "filas tr:", len(tab), [re.sub(r"<[^>]+>|\s+", " ", x).strip()[:150] for x in tab[:4]])
    i = t.find("verificaci"); print("  verificación en respuesta:", i >= 0, re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t[i:i+300])) if i >= 0 else "")
