# Apps Script en producción

`InventoryWebhook.gs` es el webhook de 40 columnas que está desplegado (cíclicos). Es distinto de `../InventoryWebhook.gs`: el archivo final es una copia del libro maestro con las pestañas ocultas `__INVENTORY_MANIFEST` y `__JUSTIFICATIONS`. Los cambios para producción se aplican sobre este archivo y se prueban en `tests/apps-script-produccion.test.js`.

Para publicar: pegar el archivo completo en el proyecto de Apps Script, guardar y crear una **nueva versión** de la implementación web existente (Implementar → Administrar implementaciones → editar → Nueva versión), conservando la URL `/exec`.

## Cambios sobre la versión desplegada

- **Recierre en el mismo archivo.** Si la app envía `replaceFileId` (archivo del cierre anterior del mismo inventario y centro, en `Archivos Finales`), `createFinalFile_` reescribe ese archivo en vez de copiar el maestro otra vez: mismo enlace y pestaña, nuevo nombre con la fecha del cierre, manifiesto y justificaciones regenerados, y la lista `revisions` en la descripción. Si algo falla, restaura filas, pestañas ocultas, nombre y descripción. Sin `replaceFileId` válido se crea una copia nueva, igual que antes.

## Semanales (`InventoryWebhookSemanales.gs`)

Copia del webhook semanal desplegado (commit base 2c68670), con estos cambios:

- **44 columnas A:AR** para coincidir con las hojas de SEMANALES NIBOL MULTIMARCAS: nueva columna G `Sobrestock` (ubicación de sobrestock; se conserva y nunca se escribe ni cuenta para el ERU). El almacén y BD_BASE se ubican por nombre de columna.
- **Stock Sistema (L) fijo.** Las escrituras empiezan en M (Cantidad Física Final). CUADRA calcula sola la compensación para que M = L.
- **Recierre en el mismo archivo**, igual que en cíclicos.
- Contrato sincronizado con `src/services/inventoryContract.js` (incluye la lectura de fechas d/M/aaaa de Sheets).

Ver [docs/semanales-44-columnas.md](../../../docs/semanales-44-columnas.md).
