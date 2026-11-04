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
