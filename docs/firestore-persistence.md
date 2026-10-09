# Persistencia en Cloud Run

Los inventarios, usuarios, justificaciones, historial y auditoría se leen de Firestore. Los JSON locales son copias efímeras: no se importan al arrancar ni se utilizan como recuperación cuando falta un documento remoto.

La base de producción existente es `nibol-inventarios/(default)`. `FIRESTORE_DATABASE_ID` permite seleccionar otra base explícitamente; no cambiarlo a la base creada por la integración de AI Studio sin migrar primero los datos y validar sus reglas. El inicio de sesión necesita el documento canónico `app_files/dXNlcnMuanNvbg` (`users.json`), que también conserva los campos de coordinación. No borrar ese documento al limpiar inventarios.

Cada respuesta de guardado espera una transacción que comprueba generación y revisión. Una limpieza cambia la generación; las instancias antiguas no pueden confirmar sus escrituras. Los archivos retirados se eliminan después y la lectura los ignora mientras tanto. Los borrados individuales conservan una marca para impedir que duplicados antiguos reaparezcan. Los errores de concurrencia devuelven 409 para actualizar la vista antes de repetir una edición.

`GET /api/health` debe devolver `storage: "firestore"`, `version: "2.0.0"` y la revisión de Cloud Run, y responde 503 si no puede comprobar el documento de control. Esta comprobación es de lectura: no demuestra por sí sola permisos de escritura. Las transacciones y el flujo HTTP se verifican con `npm test`; las pruebas no borran inventarios de producción.

Para desplegar, actualizar todos los archivos de `main` en el proyecto de AI Studio, incluyendo `package.json` y `package-lock.json`, y volver a publicar. GitHub y AI Studio no deben darse por sincronizados solo porque se integró un PR. Confirmar el nuevo identificador de revisión y el endpoint de salud después de publicar. El servicio no debe mostrar mensajes de importación de archivos locales a Firestore.

Se utiliza una lectura del control por petición y una consulta completa cuando cambia la revisión. Cada guardado añade una escritura al control compartido. Los documentos individuales se limitan a 900 KB y el contenido de una transacción a 8 MB; para inventarios mayores hace falta particionar los documentos. Los respaldos programados se serializan con las peticiones de esa instancia; un temporizador dentro de Cloud Run no sustituye a un trabajo central programado.
