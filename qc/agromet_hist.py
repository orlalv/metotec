"""Historia diaria de agrometeorologia.cl (Red Agroclimática Nacional: INIA, CEAZA, ARAUCO, SERVIMET, DMC…) para valores esperados y umbrales.
Usa la consulta pública en vista «tabla» (no la exportación con verificación), a ritmo de usuario: grupos de estaciones, un año por consulta,
una variable por consulta (la tabla muestra solo la primera variable pedida) y PAUSA segundos entre consultas.

Uso:  python qc/agromet_hist.py --datos datos --anio 2024
Salida: datos/agromet/<VAR>/<AAAA>.json.gz  = {id: {"AAAA-MM-DD": [valor, %datos]}}   y  datos/agromet/estaciones.json
Las fechas son las del sitio (día en UTC−4 fijo)."""
import argparse, gzip, json, re, time
from pathlib import Path
import requests

B = "https://agrometeorologia.cl/"
H = {"User-Agent": "Mozilla/5.0 (metotec; contacto.metotec@gmail.com)"}
VARS = ["TA_MIN", "TA_MAX", "PP_SUM"]
GRUPO = 20          # estaciones por consulta
PAUSA = 6.0         # segundos entre consultas
ESPERA_VACIO = 90   # si un grupo entero vuelve vacío (el sitio corta cuando se le pide mucho seguido), esperar y reintentar


def limpia(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip()


def estaciones(s):
    h = s.get(B, headers=H, timeout=60).text
    seg = h[h.find('id="estaciones"'):h.find('id="variables"')]
    out = []
    for v, n in re.findall(r'<option value="([^"]+)"[^>]*>([^<]*)</option>', seg):
        p = [x.strip() for x in n.split(",")]
        out.append(dict(id=v, nombre=", ".join(p[:-2]) if len(p) >= 3 else p[0], comuna=p[-2] if len(p) >= 3 else "", red=p[-1] if len(p) >= 2 else ""))
    return out


def num(x):
    x = x.replace(",", ".").replace("%", "").strip()
    return float(x) if re.fullmatch(r"-?\d+(\.\d+)?", x) else None


def consulta(s, ids, var, anio):
    d = [("estaciones[]", i) for i in ids] + [("variables[]", var), ("intervalo", "day"), ("desde", f"01-01-{anio}"), ("hasta", f"31-12-{anio}"),
                                              ("vista[]", "tabla"), ("consultar", ""), ("website", "")]
    for k in range(4):
        try:
            r = s.post(B, data=d, headers=H, timeout=180)
            if r.status_code == 200 and "<table" in r.text:
                return r.text
        except requests.RequestException:
            pass
        time.sleep(15 * (k + 1))
    return None


def parsear(t, ids, nombres):
    tab = re.search(r"<table.*?</table>", t, re.S)
    if not tab:
        return {}
    filas = [[limpia(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, re.S)] for r in re.findall(r"<tr[^>]*>(.*?)</tr>", tab.group(0), re.S)]
    cab = next((f for f in filas if f and f[0].startswith("Tiempo")), None)
    if not cab:
        return {}
    n = (len(cab) - 1) // 2
    cols = cab[1:1 + n]
    # columna → id: por nombre (en el orden pedido); si un nombre se repite, por posición
    pend = list(zip(ids, nombres)); mapa = []
    for c in cols:
        j = next((k for k, (_, nm) in enumerate(pend) if nm == c), 0 if pend else None)
        mapa.append(pend.pop(j)[0] if j is not None else None)
    out = {}
    for f in filas:
        m = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", f[0] if f else "")
        if not m or len(f) < 1 + 2 * n:
            continue
        fecha = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        for k, i in enumerate(mapa):
            v, p = num(f[1 + k]), num(f[1 + n + k])
            if i and v is not None:
                out.setdefault(i, {})[fecha] = [v, p]
    return out


def main():
    a = argparse.ArgumentParser(); a.add_argument("--datos", default="datos"); a.add_argument("--anio", type=int, required=True); o = a.parse_args()
    raiz = Path(o.datos) / "agromet"; raiz.mkdir(parents=True, exist_ok=True)
    s = requests.Session(); E = estaciones(s)
    (raiz / "estaciones.json").write_text(json.dumps(E, ensure_ascii=False, indent=0), encoding="utf-8")
    nom = {e["id"]: e["nombre"] for e in E}; ids = [e["id"] for e in E]
    print(len(ids), "estaciones ·", o.anio, flush=True)
    for var in VARS:
        f = raiz / var / f"{o.anio}.json.gz"
        D = json.loads(gzip.decompress(f.read_bytes())) if f.exists() else {}
        for g in range(0, len(ids), GRUPO):
            G = ids[g:g + GRUPO]
            if all(D.get(i) for i in G) or all(i in D for i in G) and any(D.get(i) for i in G):   # reanudable: el grupo ya tiene datos
                continue
            if not G:
                continue
            R = {}
            for k in range(3):
                t = consulta(s, G, var, o.anio)
                R = parsear(t, G, [nom[i] for i in G]) if t else {}
                if R:
                    break
                if t and k == 0:
                    (raiz / "ultima_vacia.html").write_text(t[-20000:], encoding="utf-8")
                time.sleep(ESPERA_VACIO * (k + 1))
            D.update(R)
            if R:
                for i in G:
                    D.setdefault(i, {})                             # consultada: sin datos ese año
            # si el grupo quedó vacío no se marca: la próxima ejecución lo vuelve a pedir
            print(var, o.anio, g, "→", sum(1 for i in G if D.get(i)), "con datos", "" if t else "(falló)", flush=True)
            f.parent.mkdir(parents=True, exist_ok=True); f.write_bytes(gzip.compress(json.dumps(D, separators=(",", ":")).encode()))
            time.sleep(PAUSA)
        print(var, o.anio, "listo:", sum(1 for v in D.values() if v), "estaciones con datos", flush=True)


if __name__ == "__main__":
    main()
