"""Ciclo de control de calidad: descarga → archivo → pruebas → resultados.

Uso:
  python qc/correr.py --datos ../datos            (descarga del portal; necesita DMC_USUARIO y DMC_TOKEN)
  python qc/correr.py --datos ../datos --json muestra.json --sin-modelo   (prueba local)

Archivo: <datos>/ema/AAAA/MM/DD/HH.csv.gz (hora UTC de inicio), una fila por estación y minuto.
Resultados: qc_ultimo.json; si hay credenciales de Cloudflare se suben al KV (clave "qc/ultimo").
"""
import argparse, json, os, sys, traceback
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent))
import dmc, pruebas as P, modelo as MO, wrf as WRF

VERSION = "0.1"


def archivar(D, raiz):
    raiz = Path(raiz) / "ema"
    n = 0
    for hora, g in D.groupby(D["momento"].dt.floor("h")):
        f = raiz / hora.strftime("%Y/%m/%d/%H.csv.gz")
        f.parent.mkdir(parents=True, exist_ok=True)
        if f.exists():
            g = pd.concat([pd.read_csv(f, parse_dates=["momento"], dtype={"codigo": str}), g])
        g = g.drop_duplicates(["codigo", "momento"], keep="last").sort_values(["codigo", "momento"])
        g.to_csv(f, index=False, float_format="%.6g", compression={"method": "gzip", "mtime": 0})
        n += 1
    return n


def leer_archivo(raiz, fin, horas=6):
    raiz = Path(raiz) / "ema"
    partes = []
    for k in range(horas + 1):
        h = (fin - pd.Timedelta(hours=k)).floor("h")
        f = raiz / h.strftime("%Y/%m/%d/%H.csv.gz")
        if f.exists():
            partes.append(pd.read_csv(f, parse_dates=["momento"], dtype={"codigo": str}))
    return pd.concat(partes, ignore_index=True).drop_duplicates(["codigo", "momento"]) if partes else pd.DataFrame(columns=dmc.COLS)


def leer_clusters(ruta):
    p = Path(ruta)
    if not p.exists():
        return None
    C = pd.read_csv(p, dtype=str)
    return dict(zip(C.iloc[:, 0].str.strip(), C.iloc[:, 1].str.strip()))


def subir_kv(clave, texto):
    acc, tok, ns = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN"), os.environ.get("KV_ID")
    if not (acc and tok and ns):
        return "sin credenciales"
    u = f"https://api.cloudflare.com/client/v4/accounts/{acc}/storage/kv/namespaces/{ns}/values/{clave}"
    r = requests.put(u, headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, data=texto.encode("utf-8"), timeout=60)
    return f"{r.status_code}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datos", default="datos")
    ap.add_argument("--json")
    ap.add_argument("--sin-modelo", action="store_true")
    ap.add_argument("--salida", default="qc_ultimo.json")
    a = ap.parse_args()
    estado = {"version": VERSION, "inicio": datetime.now(timezone.utc).isoformat(timespec="seconds"), "errores": []}

    js = json.load(open(a.json, encoding="utf-8")) if a.json else dmc.descargar()
    E, D = dmc.leer(js)
    estado.update(estaciones=len(E), con_datos=int(D["codigo"].nunique()) if len(D) else 0, registros=len(D),
                  desde=str(D["momento"].min()) if len(D) else None, hasta=str(D["momento"].max()) if len(D) else None)
    Path(a.datos).mkdir(parents=True, exist_ok=True)
    E.to_json(Path(a.datos) / "estaciones.json", orient="records", force_ascii=False, indent=0)
    estado["horas_archivadas"] = archivar(D, a.datos) if len(D) else 0

    fin = D["momento"].max() if len(D) else pd.Timestamp.utcnow().tz_localize(None)
    A = leer_archivo(a.datos, fin, horas=6)
    H = P.horario(A)

    M = None
    if not a.sin_modelo:
        try:
            M = MO.obtener(E)
            estado["modelo"] = len(M)
        except Exception as e:
            estado["errores"].append(f"modelo: {e}")

    W = None
    if not a.sin_modelo:
        try:
            estado.update(WRF.sincronizar(E, a.datos))
        except Exception as e:
            estado["errores"].append(f"wrf: {e}")
        try:
            W = WRF.referencia(a.datos, fin - pd.Timedelta(hours=6), fin)
            estado["wrf_ref"] = len(W)
        except Exception as e:
            estado["errores"].append(f"wrf_ref: {e}")

    clusters = leer_clusters(Path(__file__).parent / "clusters.csv")
    V = P.vecinas_de(E, clusters=clusters)
    aisladas = {c for c, L in V.items() if len(L) < 3}

    alertas = []
    for nombre, f in [("rango", lambda: P.rango(A)), ("salto", lambda: P.saltos(A)), ("pegado", lambda: P.pegados(A)),
                      ("coherencia", lambda: P.coherencia(H.groupby("codigo").tail(1), E)), ("vecinas", lambda: P.vecinas(H, E, V)),
                      ("modelo", lambda: P.modelo(H, M, aisladas)), ("wrf", lambda: P.modelo_dmc(H, W, aisladas)), ("lluvia", lambda: P.lluvia(H, M, V))]:
        try:
            alertas += f()
        except Exception:
            estado["errores"].append(f"{nombre}: {traceback.format_exc(limit=2)}")
    comp_al, comp = P.completitud(A, E)
    alertas += comp_al

    # resumen por estación
    ult = H.sort_values("momento").groupby("codigo").tail(1).set_index("codigo") if len(H) else pd.DataFrame()
    mod_ult = {}
    if M is not None and len(H):
        X = H.merge(M, on=["codigo", "momento"], suffixes=("", "_m")).sort_values("momento").groupby("codigo").tail(1).set_index("codigo")
        mod_ult = {c: {v: (None if pd.isna(X.at[c, v + "_m"]) else round(float(X.at[c, v + "_m"]), 1)) for v in ("T", "Td", "HR", "P_mar")} for c in X.index}
    if W is not None and len(W) and len(H):
        Y = H.merge(W, on=["codigo", "momento"]).sort_values("momento").groupby("codigo").tail(1).set_index("codigo")
        for cc in Y.index:
            d = mod_ult.setdefault(cc, {})
            for v in ("T", "HR", "ff10"):
                x = Y.at[cc, v + "_w"]
                d[v + "_wrf"] = None if pd.isna(x) else round(float(x), 1)
            d["n_wrf"] = int(Y.at[cc, "n_w"])
    por = {}
    for al in alertas:
        por.setdefault(al["codigo"], []).append(al)
    est = []
    for r in E.to_dict("records"):
        c = r["codigo"]
        al = por.get(c, [])
        u = ult.loc[c] if c in getattr(ult, "index", []) else None
        val = {} if u is None else {v: (None if pd.isna(u[v]) else round(float(u[v]), 1)) for v in ("T", "Td", "HR", "P_mar", "ff10", "dd10", "rr1h") if v in u}
        nivel = max([x["nivel"] for x in al], default=0)
        if c not in set(A["codigo"]):
            nivel, estado_txt = 3, "sin datos"
        else:
            estado_txt = ["bien", "sospechoso", "erróneo"][nivel]
        est.append(dict(codigo=c, nombre=r["nombre"], oaci=r["oaci"], lat=r["lat"], lon=r["lon"], alt=r["alt"], nivel=nivel, estado=estado_txt,
                        aislada=c in aisladas, vecinas=V.get(c, [])[:6], completitud=comp.get(c), hora=None if u is None else str(u["momento"]),
                        valores=val, modelo=mod_ult.get(c, {}), alertas=al))
    res = dict(generado=datetime.now(timezone.utc).isoformat(timespec="seconds"), datos_hasta=estado["hasta"], version=VERSION,
               fuentes={"estaciones": "DMC, red automática", "modelo": " + ".join(x for x in ["WRF-DMC" if W is not None and len(W) else "", "Open-Meteo" if M is not None else ""] if x) or None, "satelite": None},
               resumen={k: sum(1 for e in est if e["estado"] == k) for k in ("bien", "sospechoso", "erróneo", "sin datos")},
               estaciones=est)
    txt = json.dumps(res, ensure_ascii=False, default=str)
    Path(a.salida).write_text(txt, encoding="utf-8")
    estado["kv"] = subir_kv("qc/ultimo", txt)
    estado["alertas"] = len(alertas)
    estado["resumen"] = res["resumen"]
    estado["fin"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (Path(a.datos) / "estado.json").write_text(json.dumps(estado, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(estado, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
