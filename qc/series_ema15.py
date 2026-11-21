"""Series históricas de las estaciones automáticas (EMA) cada 15 minutos, por mes.

Servicio de la DMC (con usuario y token):
  …/application/servicios/getDatosRecientesEma/{cod}/{año}/{mes}?usuario=…&token=…   → datos cada 15 min de ese año y mes.
Guarda en la rama datos:  ema15/{cod}/{año}/{mm}.csv.gz   (momento UTC, T, Td, HR, P_est, P_mar, dd10, ff10, fx10)
  o  {mm}.vacio  si el mes no trae datos. Cada estación terminada deja ema15/{cod}/.completo (para reanudar tandas).
Uso: python qc/series_ema15.py --datos datos --cods 330021,180018 --desde 2020 --hasta 2020
     python qc/series_ema15.py --datos datos --cods sinsaclim --desde 2011 --max 20 --minutos 270"""
import argparse, gzip, io, json, os, sys, time
from datetime import date
from pathlib import Path
import requests

sys.path.insert(0, str(Path(__file__).parent))
import dmc

URL = dmc.BASE + "getDatosRecientesEma/{cod}/{a}/{m:02d}"
CAMPOS = {"temperatura": "T", "puntoDeRocio": "Td", "humedadRelativa": "HR", "presionEstacion": "P_est", "presionNivelDelMar": "P_mar",
          "direccionDelVientoPromedio10Minutos": "dd10", "fuerzaDelVientoPromedio10Minutos": "ff10", "fuerzaDelViento10MinutosMax": "fx10"}
COLS = ["momento"] + list(CAMPOS.values())


def filas(js):
    """Datos de la respuesta (acepta datosEstaciones como diccionario de una estación o como lista)."""
    de = (js or {}).get("datosEstaciones") or {}
    est = de if isinstance(de, dict) and "datos" in de else None
    lista = [est] if est else (de if isinstance(de, list) else [])
    out = []
    for e in lista:
        for d in e.get("datos") or []:
            if not d.get("momento"):
                continue
            out.append([str(d["momento"])[:19]] + [dmc.numero(d.get(k)) for k in CAMPOS])
    return out


def descargar(cod, a, m, usuario, token, timeout=120):
    r = requests.get(URL.format(cod=cod, a=a, m=m), params={"usuario": usuario, "token": token}, timeout=timeout)
    r.raise_for_status()
    if not r.text.strip():
        return {}                 # respuesta vacía: el servicio no tiene datos de ese mes
    try:
        return r.json()
    except ValueError:
        raise ValueError(f"respuesta no JSON ({r.status_code}, {len(r.content)} bytes, {r.headers.get('content-type')}): {r.text[:160]!r}")


def escribir(f, F):
    s = io.StringIO()
    s.write(";".join(COLS) + "\n")
    for r in sorted(F):
        s.write(";".join("" if v is None else (v if isinstance(v, str) else f"{v:g}") for v in r) + "\n")
    f.write_bytes(gzip.compress(s.getvalue().encode("utf-8"), mtime=0))


def sin_saclim(datos):
    d = Path(datos)
    todas = [e["codigo"] for e in json.loads((d / "estaciones.json").read_text())]
    return [c for c in todas if not any((d / "saclim" / c).glob("*/*.csv.gz"))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datos", default="datos")
    ap.add_argument("--cods", default="sinsaclim", help="códigos separados por coma · sinsaclim · todas")
    ap.add_argument("--desde", type=int, default=2011)
    ap.add_argument("--hasta", type=int, default=date.today().year)
    ap.add_argument("--max", type=int, default=0)
    ap.add_argument("--minutos", type=int, default=0)
    ap.add_argument("--rehacer", action="store_true", help="vuelve a bajar meses ya guardados")
    ap.add_argument("--pausa", type=float, default=0.2)
    a = ap.parse_args()
    usuario, token = os.environ["DMC_USUARIO"], os.environ["DMC_TOKEN"]
    raiz = Path(a.datos) / "ema15"
    if a.cods == "sinsaclim":
        cods = sin_saclim(a.datos)
    elif a.cods == "todas":
        cods = [e["codigo"] for e in json.loads((Path(a.datos) / "estaciones.json").read_text())]
    else:
        cods = [c for c in a.cods.split(",") if c]
    pend = [c for c in cods if a.cods not in ("sinsaclim", "todas") or not (raiz / c / ".completo").exists()]
    if a.max:
        pend = pend[:a.max]
    print(f"estaciones: {len(cods)}; esta tanda: {len(pend)}", flush=True)
    limite = time.time() + 60 * a.minutos if a.minutos else None
    hoy = date.today()
    for cod in pend:
        if limite and time.time() > limite:
            print(f"tiempo agotado antes de {cod}; se reanuda en la próxima tanda"); break
        n = vacios = fallas = 0
        for an in range(a.desde, a.hasta + 1):
            for m in range(1, 13):
                if (an, m) > (hoy.year, hoy.month):
                    break
                f = raiz / cod / str(an) / f"{m:02d}.csv.gz"
                if (f.exists() or f.with_suffix("").with_suffix(".vacio").exists()) and not a.rehacer:
                    continue
                try:
                    F = filas(descargar(cod, an, m, usuario, token))
                    if not F:                     # confirma con un segundo intento antes de darlo por vacío
                        time.sleep(1.5); F = filas(descargar(cod, an, m, usuario, token))
                except Exception as e:
                    fallas += 1; print(f"  falla {cod} {an}-{m:02d}: {e}", flush=True); time.sleep(2); continue
                f.parent.mkdir(parents=True, exist_ok=True)
                if F:
                    escribir(f, F); n += 1
                else:
                    f.with_suffix("").with_suffix(".vacio").write_text(""); vacios += 1
                time.sleep(a.pausa)
        if not fallas:
            (raiz / cod).mkdir(parents=True, exist_ok=True)
            (raiz / cod / ".completo").write_text(f"{a.desde}-{a.hasta}\n")
        print(f"{cod}: {n} meses con datos, {vacios} vacíos" + (f", {fallas} fallas (se reintenta)" if fallas else ""), flush=True)


if __name__ == "__main__":
    main()
