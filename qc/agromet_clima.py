"""Valor esperado y desviación estándar por estación y mes, con la historia diaria de agrometeorologia.cl (qc/agromet_hist.py).

Temperatura (TA_MIN, TA_MAX): media y σ por mes, solo días con ≥ 80 % de datos, Tmín ≤ Tmáx, dentro de rango físico,
  y depurando iterativamente lo que esté a más de 5σ (para que los errores de la propia serie no inflen σ). Mínimo 60 días por mes.
Precipitación (PP_SUM): no es normal; se guardan los percentiles 99 y 99,9 de los días con lluvia y el máximo, por mes.

Uso: python qc/agromet_clima.py --datos datos   →  datos/agromet/clima.json
     {id: {"nombre", "comuna", "red", "TA_MIN": {"1": [media, σ, n], …}, "TA_MAX": {…}, "PP_SUM": {"1": [p99, p999, máx, n_lluvia], …}}}
"""
import argparse, gzip, json, statistics
from pathlib import Path

RANGO = (-30.0, 48.0)
MIN_PCT = 80.0
MIN_N = 60


def leer(raiz, var):
    D = {}
    for f in sorted((raiz / var).glob("*.json.gz")):
        for i, serie in json.loads(gzip.decompress(f.read_bytes())).items():
            D.setdefault(i, {}).update(serie)
    return D


def media_sd(x):
    x = list(x)
    for _ in range(4):
        if len(x) < MIN_N:
            return None
        m, s = statistics.fmean(x), statistics.pstdev(x)
        y = [v for v in x if abs(v - m) <= 5 * s] if s > 0 else x
        if len(y) == len(x):
            break
        x = y
    return [round(m, 2), round(s, 2), len(x)]


def pctl(x, p):
    x = sorted(x)
    return x[min(len(x) - 1, int(round(p * (len(x) - 1))))]


def main():
    a = argparse.ArgumentParser(); a.add_argument("--datos", default="datos"); o = a.parse_args()
    raiz = Path(o.datos) / "agromet"
    E = {e["id"]: e for e in json.loads((raiz / "estaciones.json").read_text(encoding="utf-8"))}
    tn, tx, pp = leer(raiz, "TA_MIN"), leer(raiz, "TA_MAX"), leer(raiz, "PP_SUM")
    out = {}
    for i in set(tn) | set(tx) | set(pp):
        r = {"nombre": E.get(i, {}).get("nombre", ""), "comuna": E.get(i, {}).get("comuna", ""), "red": E.get(i, {}).get("red", "")}
        a_n, a_x = tn.get(i, {}), tx.get(i, {})
        for var, S in (("TA_MIN", a_n), ("TA_MAX", a_x)):
            por = {}
            for d, (v, p) in S.items():
                if p is not None and p < MIN_PCT or not RANGO[0] <= v <= RANGO[1]:
                    continue
                n, x = a_n.get(d), a_x.get(d)
                if n and x and n[0] > x[0]:
                    continue
                por.setdefault(int(d[5:7]), []).append(v)
            m = {str(k): ms for k, L in por.items() if (ms := media_sd(L))}
            if m:
                r[var] = m
        por = {}
        for d, (v, p) in pp.get(i, {}).items():
            if (p is None or p >= MIN_PCT) and 0 <= v <= 400:
                por.setdefault(int(d[5:7]), []).append(v)
        m = {}
        for k, L in por.items():
            ll = [v for v in L if v >= 0.2]
            if len(L) >= MIN_N and len(ll) >= 10:
                m[str(k)] = [round(pctl(ll, .99), 1), round(pctl(ll, .999), 1), max(ll), len(ll)]
        if m:
            r["PP_SUM"] = m
        if len(r) > 3:
            out[i] = r
    (raiz / "clima.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("clima:", len(out), "estaciones ·", sum("TA_MAX" in r for r in out.values()), "con temperatura ·", sum("PP_SUM" in r for r in out.values()), "con lluvia")


if __name__ == "__main__":
    main()
