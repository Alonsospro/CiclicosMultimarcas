# Apps Script en producción

`InventoryWebhook.gs` es el webhook de 40 columnas que está desplegado (cíclicos). Es distinto de `../InventoryWebhook.gs`: el archivo final es una copia del libro maestro con las pestañas ocultas `__INVENTORY_MANIFEST` y `__JUSTIFICATIONS`. Los cambios para producción se aplican sobre este archivo y se prueban en `tests/apps-script-produccion.test.js`.

Para publicar: pegar el archivo completo en el proyecto de Apps Script, guardar y crear una **nueva versión** de la implementación web existente (Implementar → Administrar implementaciones → editar → Nueva versión), conservando la URL `/exec`.

## Cambios sobre la versión desplegada

- **Recierre en el mismo archivo.** Si la app envía `replaceFileId` (archivo del cierre anterior del mismo inventario y centro, en `Archivos Finales`), `createFinalFile_` reescribe ese archivo en vez de copiar el maestro otra vez: mismo enlace y pestaña, nuevo nombre con la fecha del cierre, manifiesto y justificaciones regenerados, y la lista `revisions` en la descripción. Si algo falla, restaura filas, pestañas ocultas, nombre y descripción. Sin `replaceFileId` válido se crea una copia nueva, igual que antes.
