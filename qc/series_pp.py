"""Agua caída diaria histórica (30 años) de las estaciones con observador: serviciosb/getAguaCaidaDiaria/{cod} de la DMC.
Guarda  series/pp/{cod}.json  →  {"cod", "desde", "hasta", "n", "dias": [[AAAA-MM-DD, total_mm, traza], …]}
y una muestra de la respuesta original en muestras/pp_crudo_{cod}.json (para revisar el formato del servicio).
El lector es tolerante, igual que functions/api/_aguacaida.js: toma como «día» cualquier objeto con parcial, total o traza y saca
la fecha de las claves del camino (año → mes → día) o de campos propios."""
import json, os, re, sys, time, unicodedata
from datetime import date
from pathlib import Path
import requests

BASE = "https://climatologia.meteochile.gob.cl/application/serviciosb/getAguaCaidaDiaria/"
MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9,
         "octubre": 10, "noviembre": 11, "diciembre": 12, "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8,
         "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dic": 12}


def _sin(s):
    return unicodedata.normalize("NFD", str(s).lower()).encode("ascii", "ignore").decode().strip()


def numero(v):
    if v is None or isinstance(v, (bool, dict, list)):
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 1) if v >= 0 else None
    m = re.search(r"-?\d+(?:[.,]\d+)?", str(v).strip())
    if not m:
        return None
    x = float(m.group().replace(",", "."))
    return round(x, 1) if x >= 0 else None


def traza(v):
    if v is True:
        return 1
    if v is None or v is False:
        return 0
    if isinstance(v, (int, float)):
        return 1 if v > 0 else 0
    return 1 if re.fullmatch(r"(1|t|true|si|x|traza|inap.*)", _sin(v)) else 0


def _campo(o, *nombres):
    for k in o:
        if _sin(k) in nombres:
            return o[k]
    return None


def _asignar(ctx, k, por_indice):
    s = _sin(k)
    if re.fullmatch(r"(19|20)\d\d", s) and ctx.get("a") is None:
        return {**ctx, "a": int(s)}
    if ctx.get("m") is None and ctx.get("a") is not None and s in MESES:
        return {**ctx, "m": MESES[s]}
    if re.fullmatch(r"\d+", s) and ctx.get("a") is not None:
        n = int(s) + (1 if por_indice else 0)
        if ctx.get("m") is None and 1 <= n <= 12:
            return {**ctx, "m": n}
        if ctx.get("m") is not None and ctx.get("d") is None and 1 <= n <= 31:
            return {**ctx, "d": n}
    return ctx


def _propios(o, ctx):
    c = dict(ctx)
    f = _campo(o, "fecha", "date")
    if isinstance(f, str):
        x = re.match(r"(\d{4})-(\d\d)-(\d\d)", f)
        if x:
            c = {"a": int(x[1]), "m": int(x[2]), "d": int(x[3])}
        else:
            x = re.match(r"(\d\d?)[-/](\d\d?)[-/](\d{4})", f)
            if x:
                c = {"a": int(x[3]), "m": int(x[2]), "d": int(x[1])}
    a, m, d = _campo(o, "ano", "anio", "year"), _campo(o, "mes", "month"), _campo(o, "dia", "day")
    if a is not None and not isinstance(a, (dict, list)) and re.fullmatch(r"\d{4}", str(a)):
        c["a"] = int(a)
    if m is not None and not isinstance(m, (dict, list)):
        n = MESES.get(_sin(m)) or (int(m) if re.fullmatch(r"\d+", str(m)) else None)
        if n and 1 <= n <= 12:
            c["m"] = n
    if d is not None and not isinstance(d, (dict, list)) and re.fullmatch(r"\d+", str(d)) and 1 <= int(d) <= 31:
        c["d"] = int(d)
    return c


def normalizar(js):
    out, info = {}, {"hojas": 0, "sin_fecha": 0}

    def ir(nodo, ctx):
        if nodo is None or not isinstance(nodo, (dict, list)):
            return
        if isinstance(nodo, list):
            for i, x in enumerate(nodo):
                ir(x, _asignar(ctx, str(i), True))
            return
        ctx = _propios(nodo, ctx)
        P, T, Z = _campo(nodo, "parcial"), _campo(nodo, "total"), _campo(nodo, "traza")
        if P is not None or T is not None or Z is not None:
            info["hojas"] += 1
            a, m, d = ctx.get("a"), ctx.get("m"), ctx.get("d")
            if a and m and d:
                try:
                    date(a, m, d)
                except ValueError:
                    info["sin_fecha"] += 1
                    return
                f = f"{a}-{m:02d}-{d:02d}"
                fila = [f, numero(T) if numero(T) is not None else numero(P), traza(Z)]
                if f not in out or (fila[1] is not None and out[f][1] is None):
                    out[f] = fila
                return
            info["sin_fecha"] += 1
            return
        for k, x in nodo.items():
            ir(x, _asignar(ctx, k, False))

    ir(js, {})
    dias = sorted(out.values())
    return dias, info


def descargar(cod, timeout=120):
    r = requests.get(BASE + cod, params={"usuario": os.environ["DMC_USUARIO"], "token": os.environ["DMC_TOKEN"]}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def main():
    raiz = Path(sys.argv[1] if len(sys.argv) > 1 else "datos")
    sys.path.insert(0, str(Path(__file__).parent))
    from correr import ESTACIONES_OBS
    cods = [c for c in (sys.argv[2].split(",") if len(sys.argv) > 2 and sys.argv[2] else sorted(set(ESTACIONES_OBS) | {"330020", "340045", "380013"})) if c]
    (raiz / "series" / "pp").mkdir(parents=True, exist_ok=True)
    (raiz / "muestras").mkdir(parents=True, exist_ok=True)
    resumen = []
    for cod in cods:
        try:
            js = descargar(cod)
        except Exception as e:
            resumen.append((cod, f"error: {str(e)[:80]}"))
            continue
        if not (raiz / "muestras" / f"pp_crudo_{cod}.json").exists():
            (raiz / "muestras" / f"pp_crudo_{cod}.json").write_text(json.dumps(js, ensure_ascii=False)[:60000])
        dias, info = normalizar(js)
        if dias:
            (raiz / "series" / "pp" / f"{cod}.json").write_text(json.dumps(dict(cod=cod, desde=dias[0][0], hasta=dias[-1][0], n=len(dias), dias=dias), separators=(",", ":")))
        resumen.append((cod, f"{len(dias)} días {dias[0][0] if dias else ''} {dias[-1][0] if dias else ''} {info}"))
        time.sleep(0.5)
    for c, r in resumen:
        print(c, r)


if __name__ == "__main__":
    main()
