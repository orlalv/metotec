/* Envío de resultados al registro del curso (Netlify Functions + Blobs).
   Si no hay conexión, el resultado queda en este navegador y se reenvía la próxima vez. */
(function(){
  const URL_GUARDAR = "/api/guardar";
  const COLA = "resultados_pendientes";
  const leer = () => { try { return JSON.parse(localStorage.getItem(COLA)) || []; } catch (e) { return []; } };
  const escribir = v => { try { localStorage.setItem(COLA, JSON.stringify(v)); } catch (e) {} };
  async function post(data){
    const r = await fetch(URL_GUARDAR, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)});
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  window.enviarResultado = async function(data){
    data.pagina = location.pathname; data.enviado_cliente = new Date().toISOString();
    try { await post(data); return {ok: true}; }
    catch (e){ const c = leer(); c.push(data); escribir(c); return {ok: false, error: e.message}; }
  };
  async function reintentar(){
    const c = leer(); if (!c.length) return;
    const quedan = [];
    for (const d of c){ try { await post(d); } catch (e){ quedan.push(d); } }
    escribir(quedan);
  }
  window.addEventListener("load", () => setTimeout(reintentar, 1500));
})();
