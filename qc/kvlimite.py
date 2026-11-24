"""Ahorro de escrituras en el KV de Cloudflare (plan gratuito: ~1.000 escrituras al día).
- No se reescribe una clave si su contenido no cambió (se ignoran las marcas de hora como "generado").
- Las claves que no son de tiempo real se escriben como máximo cada INTERVALO segundos.
El registro de lo escrito vive en datos/kv_cache.json (la rama de datos se guarda en cada pasada)."""
import hashlib, json, os, re, time
from pathlib import Path

CACHE = Path(os.environ.get("KV_CACHE", "datos/kv_cache.json"))
TIEMPO_REAL = ("qc/ultimo", "qc/super", "qc/sensorial")   # se escriben en cada pasada (si cambiaron)
INTERVALO = 3600                                          # el resto, a lo más una vez por hora
_MARCAS = re.compile(r'"(generado|actualizado|creado|hora_generado)"\s*:\s*"[^"]*"')


def _leer():
    try:
        return json.loads(CACHE.read_text())
    except Exception:
        return {}


def _huella(texto):
    t = texto.decode("utf-8", "ignore") if isinstance(texto, bytes) else texto
    return hashlib.sha1(_MARCAS.sub("", t).encode("utf-8")).hexdigest()


def decidir(clave, texto):
    """Devuelve None si hay que escribir, o el motivo por el que se omite."""
    c = _leer().get(clave)
    if not c:
        return None
    if c.get("h") == _huella(texto):
        return "sin cambios"
    if not clave.startswith(TIEMPO_REAL) and time.time() - c.get("t", 0) < INTERVALO:
        return "espera"
    return None


def anotar(clave, texto, estado):
    if str(estado) != "200":
        return
    d = _leer()
    d[clave] = {"h": _huella(texto), "t": int(time.time())}
    try:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(d, separators=(",", ":")))
    except Exception:
        pass


def reciente(clave, segundos):
    """True si la clave se escribió hace menos de `segundos` (para saltarse trabajo completo)."""
    c = _leer().get(clave)
    return bool(c) and time.time() - c.get("t", 0) < segundos
