# Sistema de Turnos — Fundación Campbell

Aplicación web (Node.js + Express + PostgreSQL) para organizar la malla mensual de turnos de ambulancias,
controlar las horas del personal y exportar los reportes. Se despliega en Railway; la base de datos está en Neon (PostgreSQL).

## Estructura

```
server.js            Arranque y rutas
db/database.js       Conexión y migraciones automáticas (crea/actualiza tablas al iniciar)
lib/tripulacion.js   Cómo se muestra la tripulación (paramédico primero, conductor al final)
routes/              API: turnos, paramedicos (personal), ambulancias, extras, empresas,
                     exportar (Excel), pdf, importar (Excel), backup, externo (API para otros sistemas)
public/              Pantalla (index.html, js/app.js, css/styles.css)
sql/                 Scripts para DBeaver (no los ejecuta la app)
```

## Variables de entorno (Railway → Variables)

| Variable | Para qué | Obligatoria |
|---|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL (Neon) | Sí |
| `BACKUP_KEY` | **Clave de administrador**, verificada en el servidor (ver *Seguridad*). Usá una clave larga | Sí |
| `API_EXTERNA_KEY` | Clave de la API para otros sistemas (`/api/externo`) | Si se usa esa API |
| `RESEND_API_KEY`, `BACKUP_EMAIL_DESTINO` | Envío del backup por email | Opcional |
| `REGLAS_ASIGNACION_DESDE` | Fecha `AAAA-MM-DD` desde la que rigen las reglas de doble asignación (por defecto `2026-10-27`) | Opcional |
| `PORT` | Lo define Railway | No |

`ADMIN_KEY`, `BACKUP_EMAIL_USER` y `BACKUP_EMAIL_PASSWORD` ya no se usan: se pueden borrar de Railway.

## Seguridad

- La clave de administrador (`BACKUP_KEY`) la **verifica el servidor** en cada operación protegida; la pantalla la envía en la cabecera `x-backup-key` (nunca en la dirección). Se compara en tiempo constante y tras **10 intentos con clave equivocada** esa IP queda bloqueada 15 minutos.
- **Exigen la clave:** crear/editar/eliminar/unir personal, crear/editar/eliminar ambulancias, crear/eliminar horas extra, importar Excel, exportar Excel y PDF de la malla, exportar Personal APH y todo `/api/backup`.
- **Cédulas:** `GET /api/paramedicos` las entrega enmascaradas (`••••1234`) salvo que la petición lleve la clave. Los códigos provisionales (`SC0001`) no se enmascaran.
- **Abierto a propósito:** la malla (consultar, crear y borrar turnos, firmas) y las plantillas de importación, como se decidió. Cualquiera con la dirección puede modificar turnos.
- **API externa** (`/api/externo`): clave propia (`API_EXTERNA_KEY`).
- Si falta `BACKUP_KEY` en el servidor, las operaciones de administrador se rechazan (503): nunca quedan abiertas.

## Reglas de los turnos

**Siempre (cualquier fecha):**
- Un turno es de **día** o de **noche**, de una ambulancia y una fecha. Volver a guardar el mismo turno lo actualiza; no se duplica.
- Tripulación de 1 a 3 personas; opcionalmente un **conductor** (puede ser cualquier persona del personal, sin importar su rol) y un solo conductor por turno.
- La misma persona no puede repetirse en el turno y el conductor no puede ser también el paramédico.
- Las **horas del turno** salen de la ambulancia (`horas_turno`: 11 por defecto, 8 urgencias/hospitalización, 12 si se configura así).
- La **empresa** del turno se sugiere con la IPS de la ambulancia; si queda vacía se usa esa.

**Solo desde el 27/10/2026 (`REGLAS_ASIGNACION_DESDE`):**
- Una persona **no puede estar en dos ambulancias en la misma fecha y el mismo turno** (día y noche del mismo día sí se permiten). El formulario bloquea esas opciones ("ya en MOVIL 56") y el servidor lo valida.
- Antes de esa fecha todo se guarda y edita como siempre.

**Personal (identidad por cédula):**
- La **cédula identifica a la persona y es única**. Se compara sin puntos, espacios ni guiones y se guarda normalizada (`1.042.460.556` → `1042460556`).
- Quien **todavía no tiene cédula** recibe un **código provisional consecutivo** (`SC0001`, `SC0002`…) que se muestra como "⚠ Cédula provisional". Cuando se carga la cédula real, la reemplaza. Los códigos provisionales **no se reutilizan** (salen de una secuencia de la base de datos). La API externa los marca con `cedula_provisional: true`.
- Si una misma persona quedó registrada dos veces, se corrige con **Unir** (Editar → *Unir con otro registro*): pasa todos sus turnos y horas extra al registro que se conserva (si estaban los dos en un turno queda uno solo, con la función de conductor y la firma), hereda la cédula real si el otro solo tenía un provisional, y elimina el duplicado, todo en una transacción.
- Al **eliminar** a alguien, la pantalla avisa cuántos turnos se perderían; si tiene horas extra no se permite eliminar.
- **Importar personal por Excel:** columnas `nombre` y `codigo` (y `cedula`, opcional). Hay una plantilla descargable en la propia ventana de importación.

**Control de Horas:** suma por persona y por semana (lunes a domingo) los turnos y las horas extra y los compara con el límite semanal (**44 h** de enero a junio, **42 h** de julio a diciembre). El límite no impide asignar: solo genera alertas. En una semana que cruza de mes, cada mes suma solo sus propios días.

## Base de datos

`paramedicos` (personal: nombre, código, cédula única, rol) · `ambulancias` (nombre, código, placa, IPS, horas por turno, activa) ·
`empresas` (C30, CCM, CCSO) · `turnos` (fecha, turno, ambulancia, horas, empresa) ·
`turno_paramedicos` (personas de cada turno, función Conductor/Paramédico, firma) · `extras` (horas extra).

Las tablas y columnas se crean/actualizan solas al arrancar la app. `sql/01_verificar_esquema.sql` muestra qué existe y `sql/02_crear_lo_que_falta.sql` lo crea a mano si hiciera falta.

## API

| Método | Ruta |
|---|---|
| `GET` | `/api/paramedicos` |
| `POST` | `/api/paramedicos` |
| `PUT` | `/api/paramedicos/:id` |
| `GET` | `/api/paramedicos/:id/uso` |
| `POST` | `/api/paramedicos/:id/unir` |
| `DELETE` | `/api/paramedicos/:id` |
| `GET` | `/api/ambulancias` |
| `POST` | `/api/ambulancias` |
| `PUT` | `/api/ambulancias/:id` |
| `DELETE` | `/api/ambulancias/:id` |
| `GET` | `/api/empresas` |
| `GET` | `/api/turnos` |
| `GET` | `/api/turnos/ocupados` |
| `POST` | `/api/turnos` |
| `DELETE` | `/api/turnos/:id` |
| `PUT` | `/api/turnos/:turnoId/firma/:paramedicoId` |
| `GET` | `/api/turnos/reporte/horas` |
| `GET` | `/api/extras` |
| `POST` | `/api/extras` |
| `DELETE` | `/api/extras/:id` |
| `GET` | `/api/exportar/turnos` |
| `GET` | `/api/exportar/personal` |
| `GET` | `/api/pdf/turnos` |
| `POST` | `/api/importar/paramedicos` |
| `POST` | `/api/importar/ambulancias` |
| `GET` | `/api/importar/plantilla/:tipo` |
| `GET` | `/api/backup/info` |
| `GET` | `/api/backup/descargar` |
| `POST` | `/api/backup/enviar-email` |
| `GET` | `/api/externo/paramedicos` |
| `GET` | `/api/externo/ambulancias` |
| `GET` | `/api/externo/empresas` |

La API externa (`/api/externo/*`) es de solo lectura y exige `API_EXTERNA_KEY` (`?key=` o cabecera `x-api-key`).

## Despliegue

1. Subir los cambios a GitHub (`git add . && git commit && git push`): Railway despliega solo.
2. En los logs de Railway debe aparecer `[DB] Esquema PostgreSQL listo` sin líneas `[DB] … NO creadas`.

## Pendientes conocidos

- **Restauración:** no existe desde la aplicación; se hace con *Backup & Restore* de Neon.
- **Backup automático por email:** se programa dentro de la app para la medianoche del servidor (hora UTC = 7 p. m. en Colombia) y **solo se envía si la app está despierta a esa hora**. Con `sleepApplication: true` en `railway.json` la app duerme cuando no tiene visitas, así que ese envío puede no ocurrir. Las copias de Neon (*Backup & Restore*) no dependen de esto.
- **Claves:** `BACKUP_KEY` y `API_EXTERNA_KEY` deben ser largas y difíciles de adivinar (con la verificación en el servidor son la única barrera).
