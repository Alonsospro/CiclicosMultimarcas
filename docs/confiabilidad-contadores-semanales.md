# Confiabilidad de contadores en semanales

La nueva evaluación se activa para `SEMANAL` y `SEMANALES`. Los otros tipos conservan su evaluación anterior y se muestran por separado.

## Cálculo

- Confiabilidad: registros correctos / registros físicamente verificados × 100.
- Cobertura: registros físicamente verificados / registros con autoría × 100.
- Una observación corresponde a un ítem (inventario, SKU, almacén y ubicación) y etapa: conteo inicial, reconteo 1 o reconteo 2.
- Se compara el **primer registro firmado de cada etapa**, no el stock del sistema ni la decisión CUADRA. Deben coincidir buen estado y mal estado; también se informa la exactitud de cada cantidad y del total.
- Los conteos pendientes de firma o verificación no se califican. Sin verificaciones se muestra **Sin evaluación**.
- No se ordenan los contadores por porcentaje: se muestra la muestra y cobertura para interpretar los resultados.
- No hay excepción para productos con ubicaciones adicionales. La unidad evaluada es el total del registro, porque la aplicación no recoge cantidades independientes por ubicación.

## Uso

1. Registrar las cantidades y finalizar/firmar la etapa mediante el flujo existente.
2. Abrir Métricas → Contadores → Confiabilidad verificada · Semanales.
3. Como encargado del centro o administrador, seleccionar el inventario principal y abrir **Revisar registros**.
4. Elegir una muestra que incluya productos con y sin diferencias contra el sistema.
5. Comprobar físicamente B/E y M/E, explicar la comprobación y confirmar que no hubo movimientos que impidan comparar con las etapas firmadas.
6. Si hubo movimientos o la evidencia es insuficiente, registrar **No comparable** con explicación. Se conserva el historial y queda pendiente de evaluación.

El encargado o administrador puede verificar su propio conteo. Se identifica como **Autoverificación**; no se presenta como una validación independiente.

## Integridad y persistencia

La autoría se toma de la sesión que guarda el conteo confirmado por Sheets, no del auxiliar asignado ni de un nombre escrito por el cliente. La firma conserva las cantidades originales. Las modificaciones posteriores se registran separadamente y no crean varias penalizaciones para el mismo ítem y etapa.

Las verificaciones se guardan en `counterEvidence`, junto al inventario, por el flujo de persistencia de Firestore existente. No escriben cantidades en Sheets. Reintentar la misma solicitud no duplica la verificación; una revisión hecha sobre una versión anterior del registro se rechaza. Reabrir una etapa o cambiar cantidades deja la evaluación pendiente y conserva el historial.

El historial de cierre y el recálculo desde Sheets conservan la evidencia por SKU, almacén y ubicación. Las respuestas de inventario a auxiliares no incluyen este historial, para no mostrar los resultados anteriores durante un reconteo ciego.

Los registros anteriores a esta actualización, sin autoría y firma suficientes, aparecen como **Sin evidencia evaluable**. No se generan firmas ni evaluaciones históricas por inferencia.

## Apps Script y despliegue

La evaluación conserva la evidencia en la aplicación. Este cambio también incluye el contrato semanal de 43 columnas, K fija, las compensaciones Y/AK y el resultado conciliado L. El verificador siempre confirma cantidades físicas: una compensación documental no altera el conteo firmado ni aumenta automáticamente la confiabilidad del contador.

Para instalarlo, seguir [Semanales: 43 columnas y compensaciones](semanales-43-columnas.md). Se debe actualizar el Apps Script semanal y publicar la appweb de esta misma versión.
