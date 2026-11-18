/* Subopciones «Series» y «Sensores» de Precipitación.
   Etapa 1 (estructura): por ahora son pantallas informativas; el contenido llega en las etapas siguientes (ver claude/etapa-precipitacion en el proyecto). */
(function(){
const TXT = {
  series: {
    t: "Series",
    p: ["Aquí se avisará cuándo faltan series de datos minutarios de agua caída: estaciones sin dato en las últimas horas o días, con los minutos que faltan y desde cuándo.",
        "Desde cada aviso se podrá abrir directo «Relleno de series» para completar el hueco."],
    n: "Mientras tanto: «Completitud obs.» y «Estado de estaciones» muestran la disponibilidad general, y «Relleno de series» permite completar un día de una estación."
  },
  sensores: {
    t: "Sensores",
    p: ["Aquí se detectará un pluviómetro tapado o con fallas del propio aparato: el mismo valor repetido minuto a minuto (por ejemplo 0,2 0,2 0,2 0,2…), un cero sostenido mientras las vecinas sí registran lluvia y el goteo posterior a una obstrucción.",
        "Se separa de «Precipitación binaria»: allí se juzga si llovió o no en cada hora; aquí se juzga el comportamiento del sensor."],
    n: "Mientras tanto, algunos casos de goteo ya aparecen en «Precipitación binaria»."
  }
};
function pagina(el, sub){
  const d = TXT[sub] || TXT.series;
  el.innerHTML = `<div class="ppx"><h3>${d.t} <small style="color:var(--mu);font-weight:400">· próximamente</small></h3>${d.p.map(x => `<p style="margin:6px 0">${x}</p>`).join("")}<p style="margin:10px 0 0"><i>${d.n}</i></p></div>`;
}
window.PPX = {pagina};
})();
