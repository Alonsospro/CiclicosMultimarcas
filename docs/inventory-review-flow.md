# Conteo, reconteo y justificaciones

La habilitación depende del estado guardado del inventario. El servidor calcula los permisos de cada ítem y la interfaz los presenta.

| Estado | Operación disponible |
| --- | --- |
| EN_PROGRESO | Conteo; no aparece en la bandeja de justificaciones. |
| PENDIENTE_JUSTIFICACION | Primera revisión, tras completar y firmar el conteo. |
| EN_RECONTEO | Historial visible; segunda revisión bloqueada, también durante el segundo reconteo. |
| RECONTEO_COMPLETADO | Segunda revisión de todos los miembros del reconteo, incluso con diferencia cero. Con NO CUADRA, habilita opcionalmente el segundo reconteo. |
| REVISADO | Historial en consulta; requiere reapertura para editar. |

- La primera revisión debe tener decisión y explicación. CUADRA resuelve el ítem y NO CUADRA lo envía a reconteo.
- Se registra la membresía por SKU, almacén y ubicación en `recountItemKeys`. No se reconstruye a partir de diferencias finales.
- Un cero explícito es un conteo; una celda vacía o una cantidad del primer conteo no completa el reconteo.
- El segundo reconteo es opcional y solo incluye los ítems con NO CUADRA en la segunda revisión completa (`recount2ItemKeys`). Se puede cerrar sin él, dejando NO CUADRA como resultado final.
- Al firmar el segundo reconteo, sus ítems deben revisarse de nuevo. Sheets no tiene columnas para una tercera revisión: la nueva reemplaza AD-AH y la anterior se conserva en la app como registro `superseded` (historial y `__JUSTIFICATIONS` del cierre). Los demás ítems conservan su revisión.
- La segunda revisión tiene su propia decisión, texto, fecha y responsable. La primera explicación, una foto o una diferencia cero no la completan.
- El cierre exige completar las revisiones correspondientes. Admite NO CUADRA como resultado final documentado, manteniendo sus diferencias.
- Solo el usuario `Alonso` puede forzar el cierre si faltan justificaciones, con el conteo y el reconteo firmados. Cada una que falta se registra como NO CUADRA con razón `CIERRE FORZADO` y se conservan las diferencias. Primero se crea el archivo final y luego se escribe en la hoja principal; si esa escritura falla, el cierre se mantiene y la app informa qué códigos no se escribieron.
- Consultar la bandeja no cambia estados ni guarda inventarios.
- Reabrir cantidades vuelve a bloquear la revisión hasta firmar la etapa y exige una explicación posterior. Las explicaciones anteriores siguen visibles como historial.
- Después de generar un reconteo, las correcciones de cantidades se reabren en el reconteo vigente. Se bloquea volver al primer conteo para evitar mezclar una nueva secuencia con resultados posteriores ya registrados.

## Publicación

1. Publicar la app con el servidor y los archivos de interfaz de esta versión. El servidor envía el contexto de estado/ronda a Apps Script.
2. Actualizar `integrations/apps-script/InventoryWebhook.gs` en el proyecto Apps Script y publicar una nueva versión de su implementación web. Conservar las propiedades y la URL de implementación.

Apps Script comprueba el contexto recibido del servidor autenticado, la cantidad correspondiente en Sheets, el primer NO CUADRA para la segunda revisión y la explicación obligatoria. El estado completo del inventario se valida en el servidor; no se añaden columnas de estado a Sheets ni se cambia su estructura de 40 columnas.

Los inventarios existentes con revisiones incompletas necesitan documentarse; no se generan textos ni se marcan CUADRA automáticamente para completar sus registros.

## Verificación local

`node --test --test-concurrency=1 --test-isolation=none tests/*.test.js`

Las pruebas usan almacenamiento y servicios simulados, incluyendo las validaciones del script. No crean inventarios, fotos ni archivos en producción.
