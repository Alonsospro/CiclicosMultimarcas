# Integración de inventarios con Google Sheets

La creación masiva consulta automáticamente la pestaña de cada centro seleccionado. Copia las columnas maestras A–K, conserva las ubicaciones adicionales y comienza con las cantidades de conteo vacías. Cada combinación tipo/centro/fecha tiene un identificador estable: repetir la solicitud reutiliza el inventario existente. Una hoja vacía, inaccesible o con identidades duplicadas produce un error para ese centro; los demás centros pueden completarse.

## Actualización coordinada

Este cambio requiere actualizar la app y Apps Script juntos. El archivo `InventoryWebhook.gs` de esta carpeta sustituye el script independiente compartido en la conversación. `gas/Code.gs` es la versión anterior del repositorio y no es el archivo para instalar.

1. Hacer una copia del proyecto Apps Script y de la hoja de producción. Probar primero con una copia de los datos.
2. Sustituir el código del proyecto de prueba por `InventoryWebhook.gs`. No mantener simultáneamente otras definiciones de `doPost`, `CFG` o `COL`.
3. Configurar estas propiedades del script:
   - `INVENTORY_SPREADSHEET_ID`: ID de la hoja con las pestañas de centros; puede omitirse en un proyecto vinculado a esa hoja.
   - `APPS_SCRIPT_TOKEN`: secreto compartido, generado para esta integración.
   - `ROOT_CICLICO`, `ROOT_BARRIDO`, `ROOT_SEMANAL` y `ROOT_MENSUAL`: IDs de las carpetas de cierres correspondientes a los tipos usados. También se reconocen las raíces GENERAL/EXPRESS. Configurar explícitamente para no depender de los valores heredados.
   - `PHOTOS_ROOT_ID`: carpeta para evidencias. Si se omite, se usa la raíz del tipo.
   - `REFERENCE_PHOTOS_FOLDER_ID`: carpeta opcional con imágenes cuyo nombre, sin extensión, coincide exactamente con el SKU.
   - Copie solo el ID de la carpeta (el texto después de `/folders/` en el enlace); se aceptan IDs o enlaces de carpeta. No use IDs de documentos ni enlaces de archivos. La cuenta Google que ejecuta la implementación de Apps Script debe tener acceso de edición a las carpetas de fotos y de cierres.
   - Las raíces de Drive no traen IDs de ejemplo: cada propiedad `ROOT_...` debe contener una carpeta real. Si falta o el ID no tiene acceso, el webhook devuelve un mensaje que señala la propiedad que hay que corregir.
   - `PHOTO_LINK_SHARING`: opcional; `true` permite ver nuevas fotos a cualquiera que tenga el enlace. Por defecto se conservan privadas; los usuarios que visualicen evidencias deben tener permisos de Drive.
4. Publicar una nueva versión de la aplicación web Apps Script. Conservar el esquema de permisos necesario para que el servidor pueda llamarla.
5. Configurar en el servidor el mismo `APPS_SCRIPT_TOKEN`, y las URLs de Apps Script utilizadas por `src/config.js`. El token se mantiene en el servidor; no incorporarlo al frontend ni al repositorio.
6. Desplegar la app y comprobar el flujo completo en prueba antes de sustituir la configuración de producción.

## Contrato de datos

- La pestaña del centro debe llamarse con su código de cuatro dígitos, por ejemplo `1120`.
- Se mantiene el esquema A–AN de 40 columnas. Los encabezados se validan; una hoja con otra estructura no se reordena silenciosamente.
- La identidad del producto es SKU + almacén + ubicación original. Las ubicaciones adicionales se conservan en E/F.
- `Stock_Fisico` es un alias de **buen estado** en la app. `Stock_Total` es buen estado + mal estado. Lo mismo se aplica a ambos reconteos.
- Las cantidades contadas son enteros no negativos. El stock del sistema sí puede ser negativo. Cero contado frente a stock de sistema negativo produce diferencia; no se inventa un total físico negativo.
- CUADRA ajusta K al último total contado, conforme a la regla solicitada, y deja en cero las diferencias presentes. El stock anterior se conserva en la pestaña oculta `_INVENTORY_ORIGINAL_STOCK`, para permitir revertir a NO CUADRA.
- Las operaciones mutadoras requieren `operationId`; los reintentos de transporte reutilizan ese ID. `_NIBOL_SYNC` almacena respuesta y huella del contenido. Reutilizar un ID con otro contenido se rechaza.
- El cierre exige confirmación real de Google y conserva los 40 campos, ambas rondas, manifiesto de miembros y metadatos de justificaciones.
- Los cierres antiguos con manifiesto siguen siendo legibles si pertenecen a una raíz configurada. Para archivos sin manifiesto se exige centro y pestaña exactos con el esquema de 40 columnas; no se elige arbitrariamente la primera pestaña.
- La distribución desde BD_BASE conserva filas ya contadas y no elimina filas ausentes de la base. Si almacén y centro son distintos, BD_BASE debe incluir una columna Centro explícita.

## Validación

Ejecutar `npm test` con Node.js 22. Las pruebas usan dobles de Sheets/Drive y transporte: verifican carga por centro, resultados parciales, reintentos, cantidades, cierre y equivalencia del contrato Node/Apps Script. No sustituyen una prueba contra un despliegue real de Google.

En la copia de prueba, crear inventarios para dos centros; verificar que sus listas provienen de sus respectivas pestañas y que empiezan pendientes. Contar 8 buenos + 2 dañados y comprobar total 10. Agregar/eliminar ubicación sin cambiar cantidades. Hacer ambos reconteos y justificar CUADRA/NO CUADRA. Cerrar, abrir el archivo devuelto y comparar las 40 columnas. Simular un error de Google: la app debe mostrarlo sin anunciar un guardado o cierre confirmado.

## Límites conocidos

No existe una transacción distribuida entre Google y la persistencia de la app. Un corte tras escribir en Google puede requerir sincronizar de nuevo; el registro de operaciones reduce duplicados pero no convierte ambos sistemas en una sola transacción. La persistencia Firestore/cache existente tampoco incorpora un bloqueo distribuido para solicitudes simultáneas desde distintas instancias. Evitar iniciar en paralelo inventarios distintos que escriban las mismas filas del mismo centro: la hoja activa conserva un único juego de conteos por producto.

Los archivos finales son copias en Drive. La entrega del código no modifica ni despliega el proyecto Apps Script de producción.
