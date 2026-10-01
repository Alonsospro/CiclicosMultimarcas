# Corrección de fotos de justificación

## Causa

La app podía anunciar «Drive no confirmó un archivo de imagen» después de que Drive guardara la foto. El Apps Script antiguo devuelve `photo.id`, `photo.name` y `photo.url`, pero omite `photo.mimeType`, que el backend exigía.

## Corrección

`src/services/gasService.js` acepta el contrato antiguo exclusivamente para la petición de subida en base64. Exige un ID y una URL HTTPS de archivo de Drive cuyo ID coincida, además de un nombre con extensión de imagen. El MIME se obtiene de la imagen enviada, cuyos bytes valida previamente `driveService.savePhotoFile`; se identifica como `validatedUpload`. No es una consulta independiente del MIME en Drive.

Si Apps Script devuelve MIME, debe coincidir con el enviado. Las carpetas, los documentos, los enlaces con IDs distintos y las respuestas incompletas se rechazan. Los errores de contrato indican actualizar Apps Script en vez de pedir repetir la subida.

## Activación y comprobación

Reiniciar el backend local o desplegar una nueva revisión para que cargue el cambio. En Node.js, editar un archivo no actualiza los módulos de un proceso que ya está ejecutándose. El frontend usa el backend de su mismo origen.

El `gas/Code.gs` del repositorio ya incluye `mimeType`. Publicarlo en las implementaciones utilizadas permite el contrato completo y nombres que distinguen inventario, fila, ronda y contenido.

La sintaxis del servicio actualizado se comprobó con `node --check`. No se ejecutaron pruebas automatizadas ni se hizo una subida real durante esta corrección. La comprobación funcional pendiente consiste en subir una foto desde Justificaciones, abrir el enlace devuelto y guardar la justificación con su ID de Drive.