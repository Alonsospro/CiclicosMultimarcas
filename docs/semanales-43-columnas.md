# Semanales: 43 columnas y compensaciones

## Archivos y alcance

- Script completo para pegar en el proyecto semanal: [`InventoryWebhookSemanales.gs`](../integrations/apps-script/InventoryWebhookSemanales.gs).
- Los cíclicos continúan con [`InventoryWebhook.gs`](../integrations/apps-script/InventoryWebhook.gs) y 40 columnas.
- El contrato compartido está en `src/services/inventoryContract.js`. Después de editarlo, ejecutar `node scripts/build-apps-script.cjs` para regenerar ambos scripts y la copia del navegador.

La versión semanal se identifica como `WEEKLY_43_V1`. Backend y Apps Script comprueban esa versión; las hojas deben tener los encabezados y posiciones acordados. Los datos antiguos no se desplazan automáticamente por posición.

## Cantidades

| Columna | Contenido | Regla |
| --- | --- | --- |
| K | Stock Sistema | Referencia inicial. Ninguna escritura de conteo o justificación de la app incluye esta columna. |
| L | Cantidad Fisica Final | Último total físico disponible más compensaciones vigentes. Es un resultado conciliado; no reemplaza la observación física. |
| M | Total Conteo | N + O. Conserva el primer conteo físico. |
| P / Q | Diferencia / costo del primer conteo | M − K; diferencia × J. Se conservan incluso después de justificar. |
| Y | Cant. Justificada 1 | Compensación documentada de la primera justificación. |
| AA | Total Reconteo 1 | AB + AC; reemplaza M como base física final. |
| AD / AE | Diferencia / costo del reconteo 1 | AA − K; diferencia × J. |
| AK | Cant. Justificada 2 | Compensación documentada de la segunda justificación. |
| AM | Total Reconteo 2 | AN + AO; reemplaza AA como base física final. |
| AP / AQ | Diferencia / costo del reconteo 2 | AM − K; diferencia × J. |

Los demás campos mantienen los títulos y el orden completo A:AQ indicados por el usuario. La segunda justificación acepta tanto el encabezado `Estado de Jutificacion 2` como `Estado de Justificacion 2` en AG.

Al indicar CUADRA, el encargado ingresa una cantidad entera sin signo. La app determina el signo: suma ante faltantes y resta ante sobrantes. La cantidad debe compensar exactamente la diferencia pendiente. Con diferencia cero se registra cero y se exige explicar el resultado del reconteo. NO CUADRA registra compensación cero y conserva la diferencia.

Ejemplos sin reconteo: K=10, M=8 y Y=+2 dan L=10; K=10, M=13 y Y=−3 también dan L=10. M y sus diferencias siguen mostrando cómo se contó inicialmente.

Las etapas físicas no se suman entre sí. Una compensación anterior al último conteo físico permanece como historia y deja de participar en L. La justificación de ese nuevo conteo debe registrar su propia compensación. Cambiar o reabrir una etapa exige las firmas y explicaciones correspondientes al flujo existente.

El primer registro físico de un inventario semanal recién creado inicia sus campos de conteos y justificaciones en el maestro, sin heredar los del ciclo anterior. Las copias cerradas del ciclo anterior conservan sus datos. Subir solamente una foto no cambia cantidades, fechas físicas ni autoría.

## Indicadores

Los ERI conservan sus fórmulas de cantidad, SKU y valor, pero comparan el primer físico M contra K para el indicador inicial y el conciliado L contra K para el final. CUADRA por sí solo no pone la diferencia en cero. El SKU se evalúa junto con su almacén para que un sobrante de otro almacén no esconda un faltante. Las cantidades no se duplican por tener ubicaciones adicionales.

El ERU semanal promedia `100 / número de ubicaciones distintas` por combinación SKU/almacén auditada. Una ubicación aporta 100%, dos 50% y tres 33,333…%. Sin ubicación aporta cero. Las ubicaciones se normalizan y no se cuentan duplicadas. CUADRA y las compensaciones no alteran ese resultado. Los filtros que mezclan tipos indican que el resultado combina modelos.

La confiabilidad del contador usa las cantidades físicas firmadas y verificadas, separadas de L y de las compensaciones. Ver [confiabilidad de contadores](confiabilidad-contadores-semanales.md).

## Actualización

1. En el proyecto Apps Script conectado al archivo **semanal**, reemplazar el código por el contenido completo de `InventoryWebhookSemanales.gs`.
2. Conservar `APPS_SCRIPT_TOKEN` y la configuración del archivo semanal (`INVENTORY_SPREADSHEET_ID`, si el script no está vinculado). Para fotos/cierres, conservar la raíz configurada; se acepta `ROOT_SEMANALES` o `ROOT_SEMANAL` según el tipo usado por la app, con respaldo en `ROOT_CICLICO`.
3. Comprobar que las hojas de los centros tienen las 43 columnas en el orden acordado. La opción **Verificar columnas** detecta incompatibilidades; no migra ni reconstruye datos históricos.
4. Actualizar la implementación existente de la aplicación web de Apps Script a una nueva versión. Al conservar esa implementación se mantiene la URL `/exec`. Si se crea otra, actualizar `SEMANALES_URL` en el servidor.
5. Publicar la appweb con estos cambios. Antes de continuar un inventario semanal creado con la versión anterior, sincronizarlo con Sheets y revisar la correspondencia de sus datos.

Los valores iniciales que ya fueron sobrescritos en K por una versión anterior requieren una fuente histórica fiable para recuperarse. Esta actualización no inventa ese stock inicial ni migra cierres antiguos de 40 columnas a 43.

## Validación

Las pruebas locales cubren el contrato, el código real del Apps Script mediante simulación de Sheets, flujos de firma/justificación/cierre, los indicadores y el formulario en Chrome móvil. Las pruebas no escriben en Firestore, Sheets ni Drive de producción. Tras publicar, comprobar un inventario semanal real con las credenciales y permisos del despliegue.
