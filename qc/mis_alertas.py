"""Etapa 3 · «Mis alertas»: reglas propias de cada persona del equipo, evaluadas sobre la última pasada,
y aviso opcional por Telegram (bot) o correo (Resend).

Reglas (las guarda la página en el KV «qc/equipo», ver functions/api/equipo.js):
  {id, nombre, fuente: "ema"|"obs", donde: "mias"|"todas"|"norte"|"centro"|"sur"|"austral"|"cods",
   cods: [..], var, op: ">"|">="|"<"|"<="|"="|"en"|"sin", valor}
  · op "en": lista y rangos de códigos, ej. "07-09,30-35" (tormentas de polvo/arena con ww).
  · op "sin": sin dato (EMA sin datos; observación sin mensaje en las últimas 2 h).
La misma lógica está en js/equipo.js (evaluar) para el contador de la página: si se cambia una, cambiar la otra.

Envío: solo cuando la condición aparece (no se repite mientras sigue). Estado en datos/hallazgos/avisos_enviados.json.
Secretos opcionales en GitHub: TELEGRAM_TOKEN (bot de @BotFather), RESEND_API_KEY y RESEND_FROM (correo).
"""
import json, os
from datetime import datetime, timezone, timedelta
from pathlib import Path
import requests

ZONAS = {"todas": (-90, 0), "norte": (-27.5, 0), "centro": (-38, -27.5), "sur": (-46, -38), "austral": (-90, -46)}
VARS_EMA = {"T": "Ts", "Td": "Td", "HR": "HR", "P_mar": "QFF", "ff10": "viento (kt)", "dd10": "dirección", "rr1h": "lluvia 1 h (mm)"}
VARS_OBS = {"Ts": "Ts", "Td": "Td", "HR": "HR", "ff": "viento (kt)", "VV": "visibilidad (m)", "ww": "ww", "RRR6": "RRR6 (mm)", "QFE": "QFE"}


def _rangos(txt):
    out = []
    for p in str(txt or "").replace(" ", "").split(","):
        if not p:
            continue
        a, _, b = p.partition("-")
        try:
            out.append((float(a), float(b or a)))
        except ValueError:
            pass
    return out


def cumple(x, op, valor):
    if x is None or isinstance(x, str):
        return False
    if op == "en":
        return any(a <= x <= b for a, b in _rangos(valor))
    try:
        y = float(valor)
    except (TypeError, ValueError):
        return False
    return {">": x > y, ">=": x >= y, "<": x < y, "<=": x <= y, "=": x == y}.get(op, False)


def _donde(r, e, mias):
    d = r.get("donde") or "todas"
    if d == "mias":
        return e["codigo"] in mias
    if d == "cods":
        return e["codigo"] in (r.get("cods") or [])
    lo, hi = ZONAS.get(d, ZONAS["todas"])
    return e.get("lat") is not None and lo <= e["lat"] < hi


def evaluar(persona, ema, obs, ahora=None):
    """Lista de {id, regla, codigo, nombre, texto} que se cumplen ahora para una persona."""
    ahora = ahora or datetime.now(timezone.utc)
    mias = set(persona.get("estaciones") or [])
    out = []
    for r in persona.get("alertas") or []:
        if r.get("activa") is False:
            continue
        fuente, var, op, val = r.get("fuente", "ema"), r.get("var"), r.get("op"), r.get("valor")
        L = (ema or {}).get("estaciones", []) if fuente == "ema" else (obs or {}).get("estaciones", [])
        for e in L:
            if not _donde(r, e, mias):
                continue
            if fuente == "ema":
                if op == "sin":
                    ok, x, h = e.get("nivel") == 3, None, (ema or {}).get("datos_hasta")
                else:
                    x, h = (e.get("valores") or {}).get(var), e.get("hora") or (ema or {}).get("datos_hasta")
                    ok = cumple(x, op, val)
            else:
                ult = (e.get("ult") or [{}])[-1] if e.get("ult") else {}
                if op == "sin":
                    u = e.get("ultima")
                    try:
                        t = datetime.fromisoformat(str(u).replace(" ", "T")).replace(tzinfo=timezone.utc) if u else None
                    except ValueError:
                        t = None
                    ok, x, h = (t is None or ahora - t > timedelta(hours=2)), None, u
                else:
                    x, h = ult.get(var), ult.get("h")
                    ok = cumple(x, op, val)
            if ok:
                nv = (VARS_EMA if fuente == "ema" else VARS_OBS).get(var, var)
                cond = "sin dato" if op == "sin" else f"{nv} = {x} ({op} {val})"
                out.append(dict(id=f"{r.get('id')}|{e['codigo']}", regla=r.get("nombre") or cond, codigo=e["codigo"], nombre=e.get("nombre"),
                                hora=str(h or "")[:16], texto=f"{r.get('nombre') or 'Alerta'} · {e.get('nombre')} ({e['codigo']}) · {cond} · {str(h or '')[:16]} UTC"))
    return out


def _telegram(chat, txt):
    tok = os.environ.get("TELEGRAM_TOKEN")
    if not (tok and chat):
        return False
    r = requests.post(f"https://api.telegram.org/bot{tok}/sendMessage", json={"chat_id": chat, "text": txt}, timeout=20)
    return r.ok


def _correo(dest, txt):
    key, de = os.environ.get("RESEND_API_KEY"), os.environ.get("RESEND_FROM")
    if not (key and de and dest):
        return False
    r = requests.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {key}"},
                      json={"from": de, "to": [dest], "subject": "METOTEC · Mis alertas", "text": txt}, timeout=20)
    return r.ok


def avisar(equipo, ema, obs, raiz):
    """Evalúa las reglas de todo el equipo y avisa lo nuevo. Devuelve un resumen para estado.json."""
    f = Path(raiz) / "hallazgos" / "avisos_enviados.json"
    previo = json.loads(f.read_text()) if f.exists() else {}
    nuevo, enviados, total = {}, 0, 0
    for p in (equipo or {}).get("personas", []):
        H = evaluar(p, ema, obs)
        total += len(H)
        act = {h["id"] for h in H}
        ant = set(previo.get(p["nombre"], []))
        nuevo[p["nombre"]] = sorted(act)
        nuevos = [h for h in H if h["id"] not in ant]
        if not nuevos or p.get("ausente") or not (p.get("telegram") or p.get("correo")):
            continue
        txt = "\n".join(h["texto"] for h in nuevos[:30]) + ("\n…" if len(nuevos) > 30 else "")
        if p.get("telegram") and _telegram(p["telegram"], txt):
            enviados += 1
        if p.get("correo") and _correo(p["correo"], txt):
            enviados += 1
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(nuevo, ensure_ascii=False, indent=0))
    return {"activas": total, "envios": enviados}
