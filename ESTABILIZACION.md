# Estabilización de Cíclicos — entrega local del 01/10/2026

Código actualizado en esta carpeta. **Pendiente de validación integrada y despliegue**: esta entrega no modifica AI Studio, Cloud Run, Firebase, las hojas ni las carpetas de producción. Se mantuvieron los archivos de usuarios, autenticación, permisos y configuración. La comparación de integridad está en el manifiesto adjunto al paquete.

| Problema | Cambio implementado |
| --- | --- |
| Guardado aparente que desaparece al reiniciar | Las operaciones de inventario esperan la confirmación de Firestore. Inventario, auditoría y pendientes de Sheets se confirman juntos. Disco y memoria quedan como caché. |
| Avance reemplazado por copias antiguas | Recuperación desde Firestore, precondiciones de versión y rechazo de conteos obsoletos. La sincronización desde Sheets completa datos faltantes sin reemplazar conteos confirmados. |
| Corte de red o respuesta perdida | Cola de conteos en el navegador, identificador estable por envío y reintentos. La cola hacia Sheets también persiste en Firestore. |
| Errores parciales de Apps Script | Se rechazan respuestas inválidas y se identifican los ítems fallidos. Un inventario con sincronización pendiente no puede enviarse/cerrarse como completo. |
| Fotos de justificación ausentes | Contrato de categoría/ronda corregido; se exige un ID real de imagen de Drive. Los nombres distinguen inventario, ítem, ronda y contenido; se conserva la evidencia anterior. |
| SKU repetido en otro almacén | Selección estricta de fila para conteos, justificaciones y Apps Script. Las coincidencias ambiguas se rechazan. |
| Ceros y fotos de reconteo | El cero se conserva en Apps Script; guardar una foto de reconteo envía la cantidad de esa fase y espera a que termine la subida. |
| Cierre sin archivo final válido | El estado cerrado requiere respuesta de Drive con archivo real. Exportación de las 40 columnas conservando almacén, ubicación y rondas. |

**Uso de la pantalla:** escribir cantidades conserva un borrador; el avance confirmado cambia al pulsar **CONTAR** y recibir confirmación del servidor. Un aviso distingue conteos pendientes en el navegador de inventarios guardados en Firebase todavía pendientes de Sheets. Ante conflicto se revisa el valor vigente antes de reenviar. No borrar los datos del navegador mientras existan pendientes.

**Verificación realizada:** 45 pruebas automatizadas aprobadas y comprobación de sintaxis/referencias de 54 archivos. Instalación reproducible con `npm ci --ignore-scripts --no-audit --no-fund`. Se corrigió el lockfile que impedía instalar con `npm ci`.

Las pruebas cubren reinicio, cuota agotada, respuesta perdida, dos escrituras concurrentes, versiones obsoletas, 20 envíos simultáneos, un lote con 14 fallos, recuperación de colas, conteos cero, fotos, justificaciones de SKU duplicados, contrato HTTP y cierre fallido. Usan servicios Google simulados y directorios temporales; los casos de navegador ejecutan su lógica en un DOM simulado. **No son una prueba de carga en Cloud Run ni una validación visual en teléfonos.** Los archivos reales de datos no se usan como fixtures ni se reescriben.

Para repetir desde esta carpeta:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
```

`build` y `lint` comprueban sintaxis y referencias locales; esta app sirve JavaScript directamente y no tiene empaquetador. No iniciar `npm start` para una prueba aislada con la configuración productiva: el arranque recupera Firestore y puede reanudar sincronizaciones pendientes.

**Orden de actualización recomendado:**

1. Conservar este respaldo local y obtener una copia actual de datos/configuración antes de publicar. Comparar el Apps Script desplegado con `gas/Code.gs`: el TXT recibido y el archivo del proyecto eran revisiones diferentes; esta entrega parte del archivo del proyecto.
2. Validar primero en una copia aislada con su propia base Firestore, hoja, carpetas y endpoints de Apps Script. Verificar reglas actuales, consulta por `secret` y `path`, límites de documentos e índices con la API REST. Los mocks no validan reglas ni índices reales.
3. Publicar una nueva versión del Apps Script actualizado en esa copia, conservando su URL `/exec`. El script crea una pestaña técnica oculta `_NIBOL_SYNC` para reconocer reintentos; no borrarla. Confirmar las constantes y carpetas de cada tipo de inventario que realmente se utilice.
4. Aplicar los archivos de la app y desplegar juntos backend y frontend usando el flujo actual de Cloud Run/AI Studio. El ZIP de entrega contiene **solo archivos cambiados o nuevos**: se aplica sobre el proyecto existente, no se importa como proyecto completo.
5. Comprobar conteo → recarga → reinicio; desconexión → reconexión; SKU duplicado en almacenes distintos; foto de justificación en ambas rondas; fallo y recuperación de Sheets; cierre y apertura del archivo final. Verificar que las fotos son imágenes abribles y que ningún pendiente se anuncia como sincronizado.
6. Repetir la validación con 14 centros y hasta 20 sesiones reales. Después, actualizar producción en una ventana sin conteos activos y recargar las pestañas de los operadores. No mezclar revisiones antiguas y nuevas escribiendo los mismos datos.

**Límites que siguen pendientes:**

- La cuota compartida de Firestore observada en la auditoría sigue siendo un impedimento operativo. El código detecta el rechazo y conserva conteos pendientes; no aumenta cuota ni cambia facturación. Debe resolverse la capacidad antes de otra jornada completa.
- Se conserva un documento por archivo/inventario. Se rechazan contenidos superiores a 950.000 bytes antes de intentar guardarlos; inventarios, auditorías o colas muy grandes necesitan una migración posterior a documentos menores. No se garantiza capacidad ilimitada ni menor consumo de cuota.
- Los reintentos de Sheets avanzan con la app activa, lecturas de detalle, arranque y temporizador del servidor. Con Cloud Run inactivo no hay una ejecución garantizada por horario; la cola permanece durable hasta la siguiente actividad. Una respuesta de entrega incierta conserva una reserva de siete minutos para evitar adelantar trabajos todavía en ejecución.
- La cola de conteos sin confirmar reside en ese navegador y usuario. No es un respaldo entre dispositivos y no sobrevive al borrado de almacenamiento del navegador. Fotos y justificaciones requieren confirmación en línea; no se añadió una cola local de archivos fotográficos.
- No se reconciliaron automáticamente los incidentes históricos ni se recuperaron fotos que nunca llegaron a guardarse. La auditoría original contiene otros hallazgos fuera de esta etapa: seguridad/accesos excluidos por solicitud, distribución de `BD_BASE` que limpia hojas, reglas de negocio de stock negativo/CUADRA y mantenimiento de snapshots. No ejecutar redistribuciones durante conteos activos.
- Hay nuevas colas, versiones de ítems y marcadores persistentes de eliminación. Restaurar solo el código antiguo después de operar con esta versión puede interpretar mal esos datos; una reversión debe planificarse con la copia de datos y vaciado controlado de pendientes.

Respaldo previo: `../work/CICLICO-original-20261001-002216.zip`. Entrega: `../outputs/MEJORAS_ESTABILIDAD_CICLICOS.zip`, con manifiesto SHA-256, diferencias y evidencia de pruebas. Los usuarios/datos originales quedan fuera del ZIP de cambios.

Referencias técnicas usadas: [API REST de Firestore](https://firebase.google.com/docs/firestore/use-rest-api), [commit atómico](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit) y [precondiciones de escritura](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write).
