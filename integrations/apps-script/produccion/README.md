# Apps Script en producción

`InventoryWebhook.gs` es el webhook de 40 columnas que está desplegado (cíclicos). Es distinto de `../InventoryWebhook.gs`: el archivo final es una copia del libro maestro con las pestañas ocultas `__INVENTORY_MANIFEST` y `__JUSTIFICATIONS`. Los cambios para producción se aplican sobre este archivo y se prueban en `tests/apps-script-produccion.test.js`.

Para publicar: pegar el archivo completo en el proyecto de Apps Script, guardar y crear una **nueva versión** de la implementación web existente (Implementar → Administrar implementaciones → editar → Nueva versión), conservando la URL `/exec`.

## Cambios sobre la versión desplegada

- **Recierre en el mismo archivo.** Si la app envía `replaceFileId` (archivo del cierre anterior del mismo inventario y centro, en `Archivos Finales`), `createFinalFile_` reescribe ese archivo en vez de copiar el maestro otra vez: mismo enlace y pestaña, nuevo nombre con la fecha del cierre, manifiesto y justificaciones regenerados, y la lista `revisions` en la descripción. Si algo falla, restaura filas, pestañas ocultas, nombre y descripción. Sin `replaceFileId` válido se crea una copia nueva, igual que antes.

- **Justificación parcial.** Acepta `justifiedQuantity` con NO CUADRA: K no cambia y la diferencia de la última etapa guarda lo que queda. Justificar toda la diferencia queda como CUADRA y más que la diferencia se rechaza. Las 40 columnas no cambian.

- **Fotos de justificación en Drive.** Nueva lectura `listJustificationPhotos` (también en semanales): recorre las carpetas de todas las fechas de un centro y tipo, sin escribir nada, para que "Revisar respaldos" encuentre las fotos subidas otro día. Sin esta versión, el reporte sale igual y avisa que no pudo buscar en Drive.

## Semanales (`InventoryWebhookSemanales.gs`)

Copia del webhook semanal desplegado (commit base 2c68670), con estos cambios:

- **44 columnas A:AR** para coincidir con las hojas de SEMANALES NIBOL MULTIMARCAS: nueva columna G `Sobrestock` (ubicación de sobrestock; se conserva y nunca se escribe ni cuenta para el ERU). El almacén y BD_BASE se ubican por nombre de columna.
- **Stock Sistema (L) fijo.** Las escrituras empiezan en M (Cantidad Física Final). CUADRA calcula sola la compensación para que M = L; NO CUADRA guarda la cantidad parcial que escriba el encargado en Cant. Justificada.
- **Recierre en el mismo archivo**, igual que en cíclicos.
- **Limpiar hojas de centros** (menú 📦 Inventarios). Pide un código de centro o `TODOS`, confirma y borra las filas desde la 2; conserva encabezados y formato, y no toca `BD_BASE` ni las pestañas ocultas. Si una pestaña tiene otros encabezados, se detiene sin borrar. Usar solo sin inventarios semanales abiertos en esos centros; después cargar la semana con "Actualizar maestros desde BD_BASE".
- Contrato sincronizado con `src/services/inventoryContract.js` (incluye la lectura de fechas d/M/aaaa de Sheets).

Ver [docs/semanales-44-columnas.md](../../../docs/semanales-44-columnas.md).

## Lubricantes (MENSUAL)

El archivo **MENSUALES NIBOL MULTIMARCAS** usa el mismo `InventoryWebhookSemanales.gs` y las mismas 44 columnas. La appweb envía el esquema de 44 columnas para `MENSUAL` igual que para `SEMANAL` (`usesWeeklySchema` en el contrato). Las reglas propias de semanales, como la confiabilidad de contadores, siguen solo para `SEMANAL`. Un inventario de Lubricantes creado con 40 columnas debe sincronizarse desde Sheets, con la hoja ya en 44 columnas, antes de seguir contando.

## Barrido (`BarridoWebhook.gs`)

Script de la planilla **BARRIDO NIBOL MULTIMARCAS** (pestañas por centro con las 44 columnas A:AR). Se pega en Extensiones → Apps Script de esa planilla y se publica como aplicación web (su URL `/exec` es `BARRIDO_URL`).

- **Conteos:** cada conteo de la appweb se escribe en la pestaña del centro. Si el código no está en ese almacén, agrega la fila; si está, actualiza Total, B/E, M/E, Cantidad Física Final, Diferencia, fecha y responsable. Una ubicación nueva va a Ubicación 1 o 2.
- **Almacenes:** lista en la propiedad `BARRIDO_ALMACENES` (por defecto `AL04, RJD0, AM01`). Se aplica como desplegable en la columna H de cada centro, la appweb la muestra al registrar y un administrador la cambia desde Barrido (botón del lápiz). Un almacén fuera de la lista se rechaza.
- **Fotos:** carpeta de barridos (`BARRIDO_FOLDER_ID`, por defecto `1SucBFevV5PEzM-ONZCriDQiBag31byD1`), subcarpeta `AAAA-MM-DD · centro nombre` y archivo con el código ingresado (`RE505881.jpg`; otra foto del mismo código, `RE505881 (2).jpg`). El enlace queda como nota en la celda del SKU.
- **Finalizar:** copia la pestaña del centro a `Inventario_BARRIDO_<centro>_FINAL_<fecha>` dentro de la subcarpeta del día.
- **Propiedades:** `APPS_SCRIPT_TOKEN` (igual a `BARRIDO_APPS_SCRIPT_TOKEN` de la appweb) y, opcional, `BARRIDO_FOLDER_ID`.
- Después de pegarlo: Implementar → Administrar implementaciones → editar → Nueva versión, y en la planilla 📦 Barrido → Aplicar lista de almacenes.
