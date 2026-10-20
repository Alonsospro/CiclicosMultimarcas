# Cierres con una hoja y métricas vinculadas

El cierre crea un archivo nuevo y copia únicamente la pestaña del centro. Conserva la configuración regional, zona horaria, encabezados, tamaños y estilos de la pestaña. Escribe las 40 columnas del esquema habitual o las 43 de semanales con los datos confirmados del inventario. Los importes conservan el formato monetario del original; las cantidades son numéricas y las fechas usan formato de fecha.

Antes de confirmar el cierre, Apps Script vuelve a leer todas las celdas escritas y compara sus valores con el contenido enviado por la app. Se rechazan cantidades incompatibles, costos negativos y fechas recibidas como cantidades. Si falla la creación o la verificación, el archivo incompleto se envía a la papelera y el inventario no se confirma como cerrado.

El archivo final tiene una sola pestaña. En la misma carpeta se guarda un archivo `.metadata.json` con el manifiesto y la evidencia de justificaciones. La descripción del archivo de Sheets conserva el manifiesto resumido, las huellas del contenido y el ID del archivo de evidencia. El historial de la app sigue conservando la autoría firmada de los conteos. La evidencia no añade pestañas al libro.

El enlace confirmado por Google, incluido el nuevo `gid`, se conserva en el inventario y el historial. Los reintentos de la misma operación devuelven el mismo archivo. El dashboard usa ese archivo final para sus métricas; el selector, el consolidado y los informes comparten la misma lista de inventarios principales. Un reconteo `REC-` no se cuenta como otro inventario. El recálculo vuelve a leer el cierre y no reemplaza datos operativos ni usa el maestro como sustituto del archivo final.

## Activación

1. Revisar y publicar el cambio de la appweb desde GitHub/AI Studio.
2. En cada proyecto Apps Script que utiliza el esquema de 40 columnas (cíclicos, mensuales y barrido), pegar completo `integrations/apps-script/InventoryWebhook.gs`.
3. En el proyecto de semanales, pegar completo `integrations/apps-script/InventoryWebhookSemanales.gs` (43 columnas).
4. Guardar y actualizar cada implementación web existente a una nueva versión. Conservar su URL `/exec`, sus tokens y sus propiedades de carpetas y spreadsheet. Guardar el código sin actualizar la implementación no activa el cambio en la appweb.
5. Recargar la app y usar **Recalcular métricas**. La sección de fuentes muestra el centro, las filas leídas, la validación y el enlace a la pestaña final.

## Cierres anteriores

Se admiten archivos con el antiguo manifiesto oculto y archivos sin manifiesto cuyo nombre sigue `Inventario_TIPO_CENTRO_FINAL_YYYYMMDD_HHmmss`. Para un archivo antiguo se selecciona la pestaña por el centro exacto y, cuando existe, por su `gid`.

Un archivo sin manifiesto puede leerse si su estructura y cantidades son coherentes, con una advertencia de que no se puede demostrar su pertenencia al cierre. Los archivos con datos inválidos se mantienen visibles para revisión, con su enlace, y se excluyen del cálculo. El consolidado se identifica como parcial y los informes se deshabilitan cuando hay fuentes pendientes.

Este cambio no modifica archivos históricos de Drive ni reconstruye automáticamente el cierre 5100 a partir de un maestro que pudo cambiar después. Una recuperación histórica requiere confirmar qué datos corresponden a la fecha del cierre.

## Verificación

`npm test` cubre los esquemas 40/43, los formatos, el enlace y la idempotencia, la verificación posterior a escritura, archivos antiguos, la exclusión de reconteos y archivos corruptos, el recálculo y la conservación de compensaciones y autoría. Las pruebas utilizan servicios simulados y no crean inventarios ni archivos en producción.

`node scripts/build-apps-script.cjs` sincroniza el contrato compartido y genera el script semanal a partir del de 40 columnas.
