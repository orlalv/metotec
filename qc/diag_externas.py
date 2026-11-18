"""Diagnóstico: variables que publica agrometeorologia.cl (items-<var>.json) y sus claves."""
import re, requests, json
H = {"User-Agent": "Mozilla/5.0 (metotec)"}
B = "https://agrometeorologia.cl/"
for pag in ("PP", "TA", "HR", "VV", "RD", "PS", "TS00", "TS10", "TA_DIA_MIN", "TA_DIA_MAX", "VV_DIA", "PP_DIA"):
    try:
        h = requests.get(B + pag, headers=H, timeout=60).text
        tmp = re.search(r"tmp\s*=\s*(tmp_\d+)", h).group(1)
        jn = re.findall(r"json_name\s*=\s*['\"]([\w-]+)['\"]", h)
        print(f"\n== {pag}: tmp={tmp} json_name={jn[:2]}")
        for nom in set(jn[:1] + [pag.lower()]):
            r = requests.get(f"{B}json/{tmp}/items-{nom}.json", headers=H, timeout=120)
            print("  ", nom, r.status_code, len(r.content), "B")
            if r.ok:
                D = r.json(); e = next((x for x in D if x.get("STACK-HOUR")), D[0])
                print("   claves STACK-HOUR:", list(e.get("STACK-HOUR", {}).items())[-1:], "| STACK-DAY:", list(e.get("STACK-DAY", {}).items())[-1:], "| otras:", [k for k in e if k.startswith("STACK") or k.startswith("RESUMEN")][:8])
                break
    except Exception as ex:
        print(pag, "ERROR", type(ex).__name__, str(ex)[:100])
