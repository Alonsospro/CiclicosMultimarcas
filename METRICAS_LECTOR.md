# Métricas como lector de Google Sheets

El panel lee la pestaña exacta de cada cierre mediante Apps Script y calcula las métricas con un modelo común de datos. La lectura y el botón Recalcular no reescriben `data/history` ni `data/inventories`.

## Activación

1. Publicar `gas/Code.gs` como una nueva versión de las implementaciones de Apps Script utilizadas por los tipos de inventario. Conservar sus URLs `/exec` y la configuración de carpetas correspondiente a cada implementación. La nueva acción de lectura se llama `readFinalInventory`.
2. Desplegar juntos el backend y los archivos de `public`. Los cierres nuevos requieren que Apps Script confirme el manifiesto; una implementación antigua muestra un error y no confirma el cierre en la app.
3. Recargar el navegador. En Métricas seleccionar el centro y el inventario, y pulsar Recalcular para descartar la caché anterior.
4. Comprobar el inventario de 108 SKU: si la pestaña del centro contiene esos 108 registros, deben aparecer 108 SKU únicos. Si contiene 234 registros incompatibles, el panel mostrará el conflicto y excluirá esa fuente. El proyecto no corrige ni borra archivos históricos automáticamente.

Esta entrega contiene código local. No se publicó en Google Apps Script ni se desplegó la app, y no se verificó la conexión de producción.

## Qué se valida

- Encabezados reconocidos, incluso con acentos, espacios y distinto orden. Se requieren SKU, stock de sistema, costo unitario y una columna de conteo físico/total/buen estado.
- Valores numéricos válidos y ceros explícitos. Una celda con error o una fecha utilizada como cantidad/costo no se transforma silenciosamente en cero.
- Cantidad de filas, SKU únicos y huella del conjunto de SKU/almacén/ubicación del cierre. Se admiten SKU repetidos en filas y ubicaciones legítimas.
- Primer conteo y las dos rondas de reconteo, incluyendo reconteos de cero. Los nombres de ubicaciones adicionales no multiplican las cantidades al consolidar un SKU.

Los cierres nuevos guardan un manifiesto pequeño en el registro local y una pestaña oculta `__INVENTORY_MANIFEST` en el archivo final. La copia final conserva únicamente la pestaña de inventario y su manifiesto; se escriben las filas enviadas por ese cierre. El manifiesto usa una huella SHA-256 de las identidades, incluyendo repeticiones, para detectar sustituciones aunque el número de filas no cambie.

Los cierres anteriores con un registro local original se contrastan con sus ítems. Un archivo antiguo sin manifiesto ni registro original se puede interpretar por su estructura; el panel y el informe advierten que su pertenencia al cierre no está confirmada. El lector necesita acceso a un archivo dentro de `Archivos Finales` y una pestaña identificada por su centro o `gid`; no adivina cuál usar por el tamaño de la tabla.

## Comportamiento del panel

Un archivo incompatible o no disponible aparece en el selector con un aviso. Sus datos se excluyen del cálculo. Si el inventario seleccionado no tiene una fuente válida, se ocultan sus métricas. Un consolidado con archivos excluidos se identifica como parcial y bloquea la exportación hasta validar las fuentes.

El consolidado suma evaluaciones por inventario. El mismo SKU evaluado en dos inventarios cuenta como dos evaluaciones; cada inventario individual muestra sus SKU únicos. Los inventarios distintos del mismo centro y día siguen siendo seleccionables. Las copias del mismo cierre se relacionan por los identificadores y el archivo real, y se prioriza su versión confirmada más reciente.

Los gráficos históricos utilizan solo inventarios reales leídos correctamente. Los informes PDF usan cantidades e importes calculados; el Excel incorpora la pestaña `Fuentes_Metricas` con archivo, pestaña, filas, SKU, fecha de lectura y advertencias.

## Lectura y caché

Se lee únicamente el inventario seleccionado cuando hay un filtro individual. El consolidado usa lotes de tres lecturas simultáneas. Las lecturas se comparten por archivo, centro, pestaña y huella del cierre durante 30 segundos; Recalcular las invalida. Un fallo de Google Sheets se muestra como fuente no disponible, sin sustituirla silenciosamente por filas locales antiguas.

## Comprobación local

Resultado final: 54 pruebas aprobadas, incluidas 13 pruebas específicas del lector; sintaxis y referencias de 56 archivos verificadas. La evidencia está en `entrega/PRUEBAS_METRICAS.txt`.

`npm test` ejecuta pruebas con Google simulado y almacenamiento temporal. Incluyen 108 frente a 234, sustitución de SKU con igual cantidad, pestañas ambiguas, dos inventarios en el mismo día, ceros, reconteos, ubicaciones adicionales, exportación con manifiesto y respuestas del panel que llegan fuera de orden. `npm run build` comprueba sintaxis y referencias de los scripts.

Los datos operativos existentes no se migraron ni se sobrescribieron durante esta implementación.
