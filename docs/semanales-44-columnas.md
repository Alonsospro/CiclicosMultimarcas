# Semanales: 44 columnas, stock inicial fijo y compensaciones

## Archivos y alcance

- Script desplegado en el proyecto semanal: [`produccion/InventoryWebhookSemanales.gs`](../integrations/apps-script/produccion/InventoryWebhookSemanales.gs). Es el que se pega en Apps Script.
- [`InventoryWebhookSemanales.gs`](../integrations/apps-script/InventoryWebhookSemanales.gs) es la variante del repo con archivo de evidencia `.metadata.json`; comparte las mismas reglas de columnas.
- El contrato compartido está en `src/services/inventoryContract.js`. Después de editarlo, ejecutar `node scripts/build-apps-script.cjs` para copiarlo al navegador y a los scripts semanales.

La versión semanal se identifica como `WEEKLY_44_V1`. Los ítems guardados por la app con la marca anterior `WEEKLY_43_V1` se siguen tratando como semanales. Las hojas deben tener los 44 encabezados en el orden acordado; los datos no se desplazan automáticamente por posición.

## Columnas clave (A:AR)

| Columna | Contenido | Regla |
| --- | --- | --- |
| D / E / F | Ubicación, Ubicación 1, Ubicación 2 | Ubicaciones del SKU; cuentan para el ERU. |
| G | Sobrestock | Ubicación de sobrestock. Viene del maestro (BD_BASE, columna `sobrestock` opcional), se muestra en la app y se conserva; la app nunca la escribe y no cuenta para el ERU. |
| H | Almacen | Identifica el SKU junto con la ubicación. |
| L | Stock Sistema | Punto de partida del centro. **Ninguna escritura de conteo o justificación lo modifica.** |
| M | Cantidad Fisica Final | Último total físico + compensaciones vigentes. Es el resultado final de conteos y justificaciones. |
| N | Total Conteo | O + P. Conserva el primer conteo físico. |
| Q / R | Diferencia / costo del primer conteo | N − L; diferencia × K. Se conservan después de justificar. |
| Z | Cant. Justificada 1 | Compensación de la primera justificación. |
| AB / AE / AF | Total, diferencia y costo del reconteo 1 | AB reemplaza N como base física final. |
| AL | Cant. Justificada 2 | Compensación de la segunda justificación. |
| AN / AQ / AR | Total, diferencia y costo del reconteo 2 | AN reemplaza AB como base física final. |

Las escrituras de la app sobre una fila existente empiezan en M: G (Sobrestock) y L (Stock Sistema) nunca se reescriben. La segunda justificación acepta `Estado de Jutificacion 2` y `Estado de Justificacion 2`.

## CUADRA y NO CUADRA

Al marcar **CUADRA** la app calcula sola la compensación: suma ante faltantes y resta ante sobrantes, de modo que **M queda igual a L (diferencia cero con el sistema)**. El encargado no escribe cantidades; el formulario muestra la compensación calculada. Si una integración envía una cantidad, debe coincidir exactamente con la diferencia. **NO CUADRA** registra compensación cero y conserva la diferencia.

Ejemplos sin reconteo: L=10, N=8 → Z=+2 y M=10; L=10, N=13 → Z=−3 y M=10. L, N y sus diferencias siguen mostrando el punto de partida y cómo se contó, para analizar variaciones y rotación.

Las etapas físicas no se suman entre sí. Una compensación anterior al último conteo físico permanece como historia y deja de participar en M. Un inventario semanal nuevo no hereda los conteos ni compensaciones del ciclo anterior.

## Indicadores

- **ERI ítem, SKU y monetario.** Inicial: primer conteo N contra L. Final: M contra L. CUADRA lleva el final a cero diferencia sin tocar L. El SKU se evalúa junto con su almacén, para que un sobrante de otro almacén no esconda un faltante.
- **ERU.** Por cada SKU + almacén auditado: 100% si tiene solo su ubicación inicial (D) y esta cumple el formato de 10 caracteres alfanuméricos; 0% si tiene más de una ubicación (E o F) o si la ubicación inicial no cumple el formato. Sobrestock (G) no influye. CUADRA y las compensaciones no alteran el ERU.

La confiabilidad del contador usa las cantidades físicas firmadas, separadas de M y de las compensaciones. Ver [confiabilidad de contadores](confiabilidad-contadores-semanales.md).

## Actualización

1. Publicar la appweb con estos cambios.
2. En el proyecto Apps Script del archivo **SEMANALES NIBOL MULTIMARCAS**, reemplazar el código por el contenido completo de `produccion/InventoryWebhookSemanales.gs`, guardar y crear una **nueva versión** de la implementación existente (se conserva la URL `/exec`).
3. Con el menú **📦 Inventarios → Verificar columnas** comprobar las 44 columnas. Luego **Actualizar maestros desde BD_BASE**.

En `BD_BASE`, `Valor` es el valor total de la línea: `Costo Unitario` se calcula como `Valor ÷ Stock`. Una columna `Costo Unitario` en la base tiene prioridad y se copia tal cual. Las columnas que la base no trae (código de barras, unidad, ubicaciones adicionales, sobrestock) conservan lo que ya tiene la hoja del centro. Las columnas adicionales de la base, como `tipoMat`, `sector`, `Marca` o `Total USD`, se ignoran.

La appweb y el script deben actualizarse juntos: la app nueva envía `WEEKLY_44_V1` y el script anterior solo aceptaba 43 columnas (que además ya no coinciden con las hojas).

## Validación

Las pruebas locales ejecutan el código real de ambos scripts semanales con una simulación de Sheets y Drive: encabezados de 44 columnas, que L y G no se escriben, CUADRA automática, recierre en el mismo archivo y restauración ante fallas. No escriben en Firestore, Sheets ni Drive de producción.
