# Cotización ARS (BCU) para The Dolls Collection

Publica `cotizacion-ars.json` con la cotización oficial del peso argentino del
**Banco Central del Uruguay** para que el tema de Shopify muestre precios orientativos en ARS.

## Fuente

- Servicio web oficial del BCU (SOAP, público, sin clave):
  `https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones` (WSDL: `?wsdl`)
- Moneda **500 — "PESO ARGENTINO"** (CodigoISO ARS, arbitrajes internacionales).
- `TCV` = **pesos uruguayos por 1 peso argentino** (ej. 0,026506 el 09/10/2026).
- Fórmula: **ARS = UYU ÷ uyu_por_ars** (equivale a UYU × ars_por_uyu).
- El BCU publica la cotización de cada día hábil; fines de semana y feriados no hay dato nuevo.

## Cómo funciona

1. GitHub Actions ejecuta `scripts/actualizar-cotizacion.mjs` dos veces por día
   (10:30 y 19:30 de Montevideo) y cuando lo lanzás a mano (Actions → Run workflow).
2. Pide al BCU los últimos 10 días y toma la cotización más reciente.
3. La valida: número dentro de un rango razonable, fecha válida y no futura, no más vieja que la
   guardada, variación menor a ±25 % contra la anterior.
4. Si es válida reescribe el JSON (`actualizado` = momento real de la actualización).
5. Si el BCU falla o el dato es inválido **conserva la última cotización válida**, anota el error en
   `estado` y la ejecución queda en rojo (GitHub te avisa por email). Nunca guarda 0.

El tema guarda la cotización 3 h en el navegador de cada visitante (no consulta en cada página) y
deja de convertir si la `fecha_cotizacion` tiene más de 5 días (ajustable en el tema).

## Puesta en marcha (una vez, ~10 minutos, gratis)

1. Creá una cuenta en github.com (si no tenés).
2. Creá un repositorio **público** llamado `cotizacion-ars-bcu` (New repository → Public).
3. Subí todos los archivos de esta carpeta, incluidas las carpetas ocultas `.github/` y el archivo
   `.nojekyll` (Add file → Upload files, o con `git push`).
4. En el repo: **Settings → Actions → General → Workflow permissions → "Read and write
   permissions"** → Save.
5. **Actions → Cotización ARS (BCU) → Run workflow** para probarlo. Debe quedar en verde.
6. URL del JSON (elegí una):
   - Directa, sin configurar nada más:
     `https://raw.githubusercontent.com/TU_USUARIO/cotizacion-ars-bcu/main/cotizacion-ars.json`
   - O con GitHub Pages (Settings → Pages → Deploy from branch → main / root):
     `https://TU_USUARIO.github.io/cotizacion-ars-bcu/cotizacion-ars.json`
7. En Shopify: Tienda online → Temas → (tema) → Personalizar → Configuración del tema →
   **Argentina (ARS y WhatsApp)** → pegá la URL en **"URL del JSON de cotización"** → Guardar.
   Con la URL cargada, el respaldo manual deja de usarse.

## Costo y límites

- GitHub Actions es gratuito en repositorios públicos; cada ejecución dura segundos.
- GitHub puede pausar las tareas programadas de un repo público sin actividad durante 60 días;
  como el flujo hace un commit cada vez que el BCU publica una cotización nueva, el repo se
  mantiene activo. Si alguna vez se pausa, GitHub avisa por email y se reactiva desde Actions.
- No usa claves, tokens ni credenciales de Shopify. El JSON es público y solo contiene la cotización.

## Pruebas

`node test/test.mjs` — 20 pruebas sin red con respuestas reales y de error del BCU
(cotización válida, sin dato nuevo, error del BCU, respuesta inválida, salto sospechoso,
fecha anterior o futura).
