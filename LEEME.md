# Sitio del curso: tiempo presente METAR y SYNOP

## Qué contiene

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Portada del curso, ordenada por tema (diagnóstico, viento, visibilidad, tiempo presente, nubes, observación completa, observación diaria) |
| `practica_viento_visibilidad.html` | Práctica de viento y visibilidad con casos al límite y vista desde arriba |
| `visor_nubes_360.html` | Visor de cielos 360° para practicar nubes |
| `banco_casos.html` | Banco de 46 casos de la prueba final en la máscara de ingreso, con corrección casilla por casilla |
| `diagnostico.html` | Test diagnóstico de 18 preguntas: nota, nivel, tiempo y explicación de cada respuesta |
| `practica_tiempo_presente.html` | Práctica de visibilidad, ww, W1W2 y tiempo presente/reciente METAR (SYNOP, METAR o mixto) |
| `simulador.html` | Simulador de observación de práctica con selector de casillas; lo registrado queda solo en el computador del alumno |
| `observacion_diaria.html` | Observación diaria de Quinta Normal: cada registro va a la planilla común de Control de Calidad y al panel docente |
| `prueba_12utc_santo_domingo.html` | Prueba de observación completa con imagen 360; el resultado se envía solo al registrar |
| `resultados.html` | Panel docente con clave: tabla, filtros, promedio, aprobados, tiempo, lo que más cuesta y CSV |
| `material/` | Guía en PDF y tarjetas llavero |
| `api.js` | Envío de resultados (si no hay internet, se reenvían después) |
| `netlify/functions/` (guardar, resultados, diarias) | Guardan y entregan los resultados (Netlify Functions + Netlify Blobs) |
| `netlify.toml`, `package.json` | Configuración para Netlify |

## Publicar en Netlify (con GitHub, sin programar)

1. Cree una cuenta en GitHub y un repositorio nuevo (puede ser privado).
2. En el repositorio, use «Add file → Upload files» y suba **todo el contenido** de esta carpeta (incluida la carpeta `netlify`).
3. En Netlify: «Add new project → Import an existing project → GitHub» y elija el repositorio. No cambie nada en la configuración de compilación: la toma de `netlify.toml`.
4. En Netlify, vaya a «Project configuration → Environment variables» y cree la variable `CLAVE_DOCENTE` con la clave que usará en el panel.
5. Vuelva a publicar («Deploys → Trigger deploy») para que tome la clave.
6. Pruebe: haga el diagnóstico con un nombre de prueba y entre a `resultados.html` con su clave.

**Importante:** si arrastra la carpeta a Netlify Drop, las páginas se publican pero las funciones no, y los resultados no se guardan. Use GitHub (o la línea de comandos: `npm install`, luego `npx netlify-cli deploy --prod`).

## Usar su dominio .cl (NIC Chile)

**Opción A · el dominio completo para el curso (miculso.cl):**
1. En Netlify: «Domain management → Add a domain» y escriba su dominio. Elija usar **Netlify DNS**; Netlify le mostrará 4 servidores de nombres.
2. En nic.cl, entre a la administración de su dominio y reemplace los servidores de nombres (DNS) por los 4 de Netlify.
3. Espere la propagación (puede tardar hasta 24–48 horas). Netlify activa HTTPS solo.

**Opción B · solo un subdominio (curso.midominio.cl)**, si el dominio ya tiene otro sitio o correo:
1. En Netlify, agregue `curso.midominio.cl` como dominio del proyecto.
2. Donde hoy administra los registros DNS de su dominio, cree un registro **CNAME**: `curso` → `nombre-del-proyecto.netlify.app`.

## Tener en cuenta

- **Las claves de la prueba van dentro del HTML.** Un alumno que abra «Ver código fuente» podría verlas. Para el diagnóstico no importa; para una prueba con nota, conviene usarla presencial o cambiar el caso cada vez.
- **Datos personales:** se guardan nombre, curso, respuestas, notas y tiempos. Avise a los alumnos que sus resultados quedan registrados para el docente.
- **Borrar resultados:** desde el panel, botón «Ver» → «Borrar».
- El plan gratuito de Netlify alcanza de sobra para un curso: cada resultado pesa pocos kilobytes.
