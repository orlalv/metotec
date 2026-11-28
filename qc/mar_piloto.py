"""Piloto «aire vs mar» (idea de Orlando Álvarez Bustamante, metotec).

¿Sigue la anomalía mensual de la temperatura del aire de las estaciones costeras del norte a la anomalía de la
temperatura del mar (NOAA OISST v2.1, celda 0,25° ~40 km mar adentro)? Si es así, el mar sirve como «vecina» que
confirma extremos reales (El Niño 2026 en Chacalluta) en vez de marcarlos como sospechosos.

Uso:
  python qc/mar_piloto.py probar                        # datos ficticios
  python qc/mar_piloto.py correr --datos <rama datos> --sst <carpeta con OISST_<cod>.csv> --salida mar_piloto.csv [--graficos <carpeta>]

Aire: datos/saclim/<cod>/<año>/Temperatura.csv.gz (CodigoNacional;Instante;Ts, horaria UTC) → media diaria con ≥ 18 h.
Mar: CSV de ERDDAP (time, zlev, latitude, longitude, sst; 2 filas de encabezado).
Mensual con ≥ 20 días; anomalía de cada serie frente a su propio promedio 2011–2025 por mes.
Por estación: r aire–mar (2011–2025), pendiente b, residuo = aire − (a + b·mar), z del residuo, meses |z| > 2 y meses de 2026.
"""
import argparse, csv, gzip, io, math, statistics, sys
from pathlib import Path

ESTACIONES = {"180005": ("Chacalluta, Arica", -18.375, -70.625), "200006": ("Diego Aracena, Iquique", -20.625, -70.625),
              "230001": ("Cerro Moreno, Antofagasta", -23.375, -70.875), "290004": ("La Florida, La Serena", -29.875, -71.625)}
REF = (2011, 2025)
URL = ("https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdc_oisst_v2_avhrr_by_time_zlev_lat_lon.csv?"
       "sst%5B(2011-01-01):1:(last)%5D%5B(0.0)%5D%5B({lat})%5D%5B({lon})%5D")


PSL = ("https://psl.noaa.gov/thredds/ncss/Datasets/noaa.oisst.v2.highres/sst.day.mean.{y}.nc?var=sst"
       "&latitude={lat}&longitude={lon}&time_start={y}-01-01T00:00:00Z&time_end={y}-12-31T23:59:59Z&accept=csv")


def bajar_psl(carpeta, hasta=2026):
    import urllib.request, time
    Path(carpeta).mkdir(parents=True, exist_ok=True)
    for cod, (_, la, lo) in ESTACIONES.items():
        partes = []
        for y in range(REF[0], hasta + 1):
            for i in range(5):
                try:
                    t = urllib.request.urlopen(PSL.format(y=y, lat=la, lon=lo + 360), timeout=120).read().decode()
                    break
                except Exception as e:
                    print(cod, y, "reintento", e); time.sleep(15)
            else:
                continue
            l = t.strip().splitlines(); partes += l if not partes else l[1:]
        Path(carpeta, f"OISST_{cod}.csv").write_text("\n".join(partes)); print(cod, len(partes) - 1, "días")


def url_sst(cod):
    _, la, lo = ESTACIONES[cod]
    return URL.format(lat=la, lon=lo + 360)


# ---------------------------------------------------------------- lectura
def aire_diario(raiz, cod):
    horas = {}
    for f in sorted((Path(raiz) / "saclim" / cod).glob("*/Temperatura.csv.gz")):
        for l in gzip.decompress(f.read_bytes()).decode("utf-8", "replace").splitlines()[1:]:
            p = l.split(";")
            if len(p) < 3 or not p[2].strip():
                continue
            try:
                horas.setdefault(p[1][:10], []).append(float(p[2].replace(",", ".")))
            except ValueError:
                pass
    return {d: statistics.fmean(v) for d, v in horas.items() if len(v) >= 18}


def mar_diario(archivo):
    out = {}
    filas = list(csv.reader(io.StringIO(Path(archivo).read_text(encoding="utf-8", errors="replace"))))
    if not filas:
        return out
    cab = [c.split("[")[0].strip() for c in filas[0]]; it, isst = cab.index("time"), cab.index("sst")
    for r in filas[1:]:
        try:
            out[r[it][:10]] = float(r[isst])
        except (ValueError, IndexError):
            pass
    return out


# ---------------------------------------------------------------- cálculo
def mensual(diario, min_dias=20):
    m = {}
    for d, v in diario.items():
        m.setdefault(d[:7], []).append(v)
    return {k: statistics.fmean(v) for k, v in m.items() if len(v) >= min_dias}


def anomalias(mens):
    clim = {}
    for k, v in mens.items():
        if REF[0] <= int(k[:4]) <= REF[1]:
            clim.setdefault(k[5:], []).append(v)
    clim = {m: statistics.fmean(v) for m, v in clim.items()}
    return {k: v - clim[k[5:]] for k, v in mens.items() if k[5:] in clim}


def analizar(aire_d, mar_d):
    A, M = anomalias(mensual(aire_d)), anomalias(mensual(mar_d))
    comunes = sorted(set(A) & set(M))
    ref = [k for k in comunes if REF[0] <= int(k[:4]) <= REF[1]]
    if len(ref) < 24:
        return None
    x, y = [M[k] for k in ref], [A[k] for k in ref]
    mx, my = statistics.fmean(x), statistics.fmean(y)
    sxx = sum((v - mx) ** 2 for v in x); syy = sum((v - my) ** 2 for v in y); sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    r = sxy / math.sqrt(sxx * syy) if sxx and syy else float("nan")
    b = sxy / sxx if sxx else float("nan"); a = my - b * mx
    res_ref = [y[i] - (a + b * x[i]) for i in range(len(ref))]
    sd = statistics.pstdev(res_ref) or float("nan")
    filas = []
    for k in comunes:
        res = A[k] - (a + b * M[k])
        filas.append(dict(mes=k, aire=round(A[k], 2), mar=round(M[k], 2), esperado=round(a + b * M[k], 2), residuo=round(res, 2), z=round(res / sd, 2)))
    return dict(r=round(r, 3), a=round(a, 3), b=round(b, 3), sd=round(sd, 3), n=len(ref), filas=filas)


def categoria(r):
    return "buena" if r > 0.6 else "regular" if r >= 0.4 else "mala"


# ---------------------------------------------------------------- salidas
def informe(res, salida, graficos=None):
    with open(salida, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["codigo", "estacion", "mes", "anom_aire", "anom_mar", "aire_esperado", "residuo", "z"])
        for cod, R in res.items():
            for fl in R["filas"]:
                w.writerow([cod, ESTACIONES[cod][0], fl["mes"], fl["aire"], fl["mar"], fl["esperado"], fl["residuo"], fl["z"]])
    for cod, R in res.items():
        z2 = [f for f in R["filas"] if abs(f["z"]) > 2 and int(f["mes"][:4]) <= REF[1]]
        print(f"\n{cod} {ESTACIONES[cod][0]}: r = {R['r']} ({categoria(R['r'])}) · pendiente b = {R['b']} · σ residuo = {R['sd']} °C · {R['n']} meses")
        print(f"  |z| > 2 en 2011–2025 ({len(z2)}): " + ", ".join(f"{f['mes']} ({f['z']:+.1f})" for f in z2))
        print("  2026: " + " · ".join(f"{f['mes'][5:]} aire {f['aire']:+.1f} mar {f['mar']:+.1f} res {f['residuo']:+.1f} z {f['z']:+.1f}" for f in R["filas"] if f["mes"].startswith("2026")))
    if graficos:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
        Path(graficos).mkdir(parents=True, exist_ok=True)
        for cod, R in res.items():
            from datetime import date
            t = [date(int(f["mes"][:4]), int(f["mes"][5:]), 15) for f in R["filas"]]
            fig, (a1, a2) = plt.subplots(2, 1, figsize=(11, 5.6), sharex=True, gridspec_kw={"height_ratios": [3, 1.3]})
            a1.plot(t, [f["mar"] for f in R["filas"]], color="#1f77b4", lw=1.6, label="Mar (OISST)")
            a1.plot(t, [f["aire"] for f in R["filas"]], color="#d62728", lw=1.6, label="Aire (estación)")
            a1.axhline(0, color="#888", lw=.8); a1.set_ylabel("Anomalía (°C)"); a1.legend(loc="upper left", frameon=False)
            a1.set_title(f"{ESTACIONES[cod][0]} ({cod}) · anomalía mensual aire vs mar · r = {R['r']}")
            a2.bar(t, [f["z"] for f in R["filas"]], width=25, color=["#d62728" if abs(f["z"]) > 2 else "#999" for f in R["filas"]])
            a2.axhline(2, color="#d62728", lw=.7, ls="--"); a2.axhline(-2, color="#d62728", lw=.7, ls="--"); a2.set_ylabel("z residuo")
            for a in (a1, a2):
                a.grid(alpha=.25); a.spines[["top", "right"]].set_visible(False)
            fig.tight_layout(); fig.savefig(Path(graficos) / f"mar_{cod}.png", dpi=110); plt.close(fig)


def correr(o):
    res = {}
    for cod in ESTACIONES:
        f = Path(o.sst) / f"OISST_{cod}.csv"
        if not f.exists():
            print(cod, "sin archivo OISST"); continue
        R = analizar(aire_diario(o.datos, cod), mar_diario(f))
        if R:
            res[cod] = R
        else:
            print(cod, "sin meses suficientes")
    informe(res, o.salida, o.graficos)


def probar():
    import random
    from datetime import date, timedelta
    random.seed(1); aire, mar = {}, {}; d = date(2011, 1, 1)
    while d <= date(2026, 11, 20):
        k = (d - date(2011, 1, 1)).days; ciclo = 3 * math.cos(2 * math.pi * (d.timetuple().tm_yday - 40) / 365)
        anom = 0.8 * math.sin(k / 300) + (3.5 * (k - 5500) / 1300 if k > 5500 else 0)
        mar[d.isoformat()] = 18 + ciclo + anom + random.gauss(0, .2)
        aire[d.isoformat()] = 19 + 1.2 * ciclo + 0.9 * anom + random.gauss(0, .6) + (4 if d.year == 2019 and d.month == 3 else 0)
        d += timedelta(days=1)
    R = analizar(aire, mar)
    assert R["r"] > 0.6, R["r"]
    assert any(f["mes"] == "2019-03" and f["z"] > 2 for f in R["filas"])
    assert all(abs(f["z"]) < 2 for f in R["filas"] if f["mes"] >= "2026-08")
    print("prueba ficticia OK · r =", R["r"], "· b =", R["b"])


if __name__ == "__main__":
    a = argparse.ArgumentParser(); s = a.add_subparsers(dest="cmd")
    s.add_parser("probar")
    c = s.add_parser("correr"); c.add_argument("--datos", required=True); c.add_argument("--sst", required=True)
    c.add_argument("--salida", default="mar_piloto.csv"); c.add_argument("--graficos", default="")
    s.add_parser("urls"); b = s.add_parser("bajar"); b.add_argument("--sst", required=True)
    o = a.parse_args()
    if o.cmd == "probar":
        probar()
    elif o.cmd == "correr":
        correr(o)
    elif o.cmd == "bajar":
        bajar_psl(o.sst)
    elif o.cmd == "urls":
        for cod in ESTACIONES:
            print(cod, url_sst(cod))
    else:
        a.print_help()
