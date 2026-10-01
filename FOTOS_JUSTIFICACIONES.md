# Corrección de la subida de fotos de justificación

El mensaje «Drive no confirmó un archivo de imagen» se genera en el backend cuando la respuesta de Apps Script no incluye `photo.id`, `photo.url` o `photo.mimeType` de imagen. El Apps Script adjunto por el usuario devuelve ID, nombre y URL desde `createFile`, pero omite `mimeType`. Por ello una subida guardada puede anunciarse como fallida. No se ha inspeccionado la respuesta de la implementación en producción.

## Cambio aplicado

- `src/services/gasService.js` acepta la respuesta antigua para esta petición de subida en base64: exige ID, URL HTTPS de archivo de Drive con el mismo ID y nombre con extensión de imagen. Usa el MIME del archivo enviado, cuyos bytes ya valida `driveService.savePhotoFile`, e identifica su procedencia como `validatedUpload`. Esto es compatibilidad con el contrato antiguo; no es una consulta independiente del tipo MIME en Drive.
- Si Apps Script declara un MIME, debe coincidir con el de la imagen enviada. Enlaces de carpetas, documentos, IDs distintos y respuestas incompletas se rechazan. Los errores de contrato indican actualizar Apps Script en vez de pedir subir repetidamente la misma foto.
- El `gas/Code.gs` actual del proyecto ya incluye el MIME utilizado para crear el archivo. Al reutilizar una foto existente lo lee mediante `file.getMimeType()`.

## Activación

Aplicar el backend actualizado y reiniciar el servidor local o desplegar la nueva revisión de la app, según el entorno utilizado. El cambio del backend permite el contrato del script antiguo compartido. Para usar el contrato completo, publicar también el `gas/Code.gs` actual en las implementaciones de Apps Script de los tipos de inventario utilizados, conservando sus URLs y configuración.

La versión antigua de Apps Script nombra las fotos por SKU y puede sustituir una foto previa. La versión actual distingue inventario, fila, ronda y contenido; conviene publicarla para conservar los respaldos de distintas justificaciones.

En la revisión posterior se confirmó que el usuario utiliza `http://127.0.0.1:3000/` y que el servidor seguía ejecutando el proceso iniciado antes del cambio. Se reinició exclusivamente ese servidor local desde esta carpeta para cargar el servicio actualizado. Se comprobó que `/api/health` responde `online`, que el puerto 3000 pertenece al proceso nuevo y que su registro de errores de arranque está vacío. Los registros están en `entrega/foto-servidor`.

La sintaxis del servicio se comprobó con `node --check`. No se hicieron subidas reales ni despliegues externos, y no se ejecutaron pruebas automatizadas. La comprobación funcional pendiente consiste en subir una foto desde Justificaciones, abrir el enlace devuelto y guardar la justificación con su ID de Drive.

Se guardaron copias de referencia del servicio y de Apps Script en `entrega/respaldo-foto-justificacion`. En esta corrección solo se modificó el servicio del backend.
