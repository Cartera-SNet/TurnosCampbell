const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { randomUUID } = require('crypto');

const ROLES_VALIDOS = ['Paramédico', 'Conductor', 'Radioperador'];

const { normalizarCedula, cedulaValida, esCedulaProvisional, siguienteCedulaProvisional, MENSAJE_CEDULA, buscarCedulaDuplicada: buscarDup } = require('../lib/cedula');
const { requireAdmin, esAdmin } = require('../lib/auth');
const buscarCedulaDuplicada = (cedula, excluirId) => buscarDup(db, cedula, excluirId);

function respuestaDuplicada(dup, cedula) {
  return { error: `La cédula ${String(cedula).trim()} ya está registrada a nombre de ${dup.nombre} (${dup.codigo}). No se puede registrar a la misma persona dos veces.`, duplicado: { nombre: dup.nombre, codigo: dup.codigo } };
}

// Sin la clave de administrador la cédula llega enmascarada (••••1234); los códigos provisionales (SC0001) no son sensibles.
const enmascarar = (p) => (!p.cedula || esCedulaProvisional(p.cedula)) ? p : { ...p, cedula: '••••' + String(p.cedula).slice(-4) };

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM paramedicos ORDER BY nombre ASC');
    res.json(esAdmin(req) ? rows : rows.map(enmascarar));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', requireAdmin, async (req, res) => {
  const { nombre, codigo, cedula } = req.body;
  const rol = req.body.rol || 'Paramédico';
  if (!nombre || !codigo) return res.status(400).json({ error: 'Nombre y código son requeridos' });
  const conCedula = normalizarCedula(cedula).length > 0;
  if (conCedula && !cedulaValida(cedula)) return res.status(400).json({ error: MENSAJE_CEDULA });
  if (!ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });

  const codigoUp = codigo.trim().toUpperCase();
  try {
    const existe = await db.query('SELECT id FROM paramedicos WHERE codigo = $1', [codigoUp]);
    if (existe.rows.length) return res.status(400).json({ error: 'Ya existe un paramédico con ese código' });

    if (conCedula) {
      const dup = await buscarCedulaDuplicada(cedula, null);
      if (dup) return res.status(409).json(respuestaDuplicada(dup, cedula));
    }
    // Sin cédula: código provisional consecutivo (si dos altas coinciden, se reintenta con el siguiente)
    let ultimoError;
    for (let intento = 0; intento < 3; intento++) {
      const ced = conCedula ? normalizarCedula(cedula) : await siguienteCedulaProvisional(db);
      try {
        const { rows } = await db.query(
          'INSERT INTO paramedicos (id, nombre, codigo, cedula, rol) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [randomUUID(), nombre.trim(), codigoUp, ced, rol]
        );
        return res.status(201).json(rows[0]);
      } catch (e) {
        ultimoError = e;
        if (conCedula || e.code !== '23505') throw e;
      }
    }
    throw ultimoError;
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const { nombre, codigo, activo, cedula, rol } = req.body;
  if (rol !== undefined && rol !== null && !ROLES_VALIDOS.includes(rol))
    return res.status(400).json({ error: 'Rol no válido' });
  const conCedula = normalizarCedula(cedula).length > 0;
  if (conCedula && !cedulaValida(cedula)) return res.status(400).json({ error: MENSAJE_CEDULA });
  try {
    let cedulaFinal;
    if (conCedula) {
      const dup = await buscarCedulaDuplicada(cedula, req.params.id);
      if (dup) return res.status(409).json(respuestaDuplicada(dup, cedula));
      cedulaFinal = normalizarCedula(cedula);
    } else {
      // Se dejó vacía: conserva la que ya tenía; si no tenía ninguna, recibe un código provisional consecutivo
      const actual = await db.query('SELECT cedula FROM paramedicos WHERE id = $1', [req.params.id]);
      if (!actual.rows.length) return res.status(404).json({ error: 'Personal no encontrado' });
      cedulaFinal = actual.rows[0].cedula || await siguienteCedulaProvisional(db);
    }

    // Una sola sentencia: si cambia el nombre, también se actualiza el nombre copiado en turnos y horas extra
    // (Control de Horas lo toma de ahí, así no queda el nombre viejo en unas semanas y el nuevo en otras)
    const { rowCount } = await db.query(
      `WITH u AS (
         UPDATE paramedicos SET nombre=$1, codigo=$2, activo=$3, cedula=$4, rol=COALESCE($5, rol) WHERE id=$6 RETURNING id, nombre
       ), t AS (
         UPDATE turno_paramedicos tp SET paramedico_nombre = u.nombre FROM u WHERE tp.paramedico_id = u.id AND tp.paramedico_nombre <> u.nombre
       ), e AS (
         UPDATE extras x SET paramedico_nombre = u.nombre FROM u WHERE x.paramedico_id = u.id AND x.paramedico_nombre <> u.nombre
       )
       SELECT id FROM u`,
      [nombre, codigo?.toUpperCase(), activo, cedulaFinal, rol || null, req.params.id]
    );
    res.json({ updated: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cuánto histórico tiene una persona (para avisar antes de eliminarla)
router.get('/:id/uso', async (req, res) => {
  try {
    const [t, e] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS n FROM turno_paramedicos WHERE paramedico_id = $1', [req.params.id]),
      db.query('SELECT COUNT(*)::int AS n FROM extras WHERE paramedico_id = $1', [req.params.id]),
    ]);
    res.json({ turnos: t.rows[0].n, extras: e.rows[0].n });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// UNIR dos registros de la misma persona: todos los turnos y horas extra del registro de origen pasan al de destino
// y el origen se elimina. Todo en una transacción: o se hace completo o no se hace nada.
router.post('/:id/unir', requireAdmin, async (req, res) => {
  const origenId = req.params.id, destinoId = req.body.destino_id;
  if (!destinoId || destinoId === origenId) return res.status(400).json({ error: 'Elegí otra persona con la que unir.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, nombre, cedula FROM paramedicos WHERE id = ANY($1::text[]) FOR UPDATE', [[origenId, destinoId]]);
    const o = rows.find(r => r.id === origenId), d = rows.find(r => r.id === destinoId);
    if (!o || !d) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Alguna de las dos personas no existe.' }); }

    // Si el destino no tiene cédula real (vacía o provisional) y el origen sí, la hereda (la cédula no puede estar en dos registros a la vez)
    if ((!d.cedula || esCedulaProvisional(d.cedula)) && o.cedula && !esCedulaProvisional(o.cedula)) {
      await client.query('UPDATE paramedicos SET cedula = NULL WHERE id = $1', [o.id]);
      await client.query('UPDATE paramedicos SET cedula = $2 WHERE id = $1', [d.id, o.cedula]);
    }
    // 1) Turnos donde el destino NO estaba: pasan al destino
    const movidos = await client.query(
      `UPDATE turno_paramedicos tp SET paramedico_id = $2, paramedico_nombre = $3
       WHERE tp.paramedico_id = $1
         AND NOT EXISTS (SELECT 1 FROM turno_paramedicos x WHERE x.turno_id = tp.turno_id AND x.paramedico_id = $2)`,
      [o.id, d.id, d.nombre]);
    // 2) Turnos donde estaban los dos: queda el destino; si el origen era el conductor, el destino pasa a serlo; se conserva la firma
    const ambos = await client.query(
      `SELECT o.turno_id, (o.funcion = 'Conductor') AS era_conductor
       FROM turno_paramedicos o JOIN turno_paramedicos x ON x.turno_id = o.turno_id AND x.paramedico_id = $2
       WHERE o.paramedico_id = $1`, [o.id, d.id]);
    const conductorEn = ambos.rows.filter(r => r.era_conductor).map(r => r.turno_id);
    if (conductorEn.length) {
      await client.query("UPDATE turno_paramedicos SET funcion = NULL WHERE paramedico_id = $1 AND turno_id = ANY($2::text[])", [o.id, conductorEn]);
      await client.query("UPDATE turno_paramedicos SET funcion = 'Conductor' WHERE paramedico_id = $1 AND turno_id = ANY($2::text[])", [d.id, conductorEn]);
    }
    await client.query(
      `UPDATE turno_paramedicos dd SET firma = oo.firma FROM turno_paramedicos oo
       WHERE oo.turno_id = dd.turno_id AND oo.paramedico_id = $1 AND dd.paramedico_id = $2 AND dd.firma IS NULL AND oo.firma IS NOT NULL`, [o.id, d.id]);
    await client.query('DELETE FROM turno_paramedicos WHERE paramedico_id = $1', [o.id]);
    // 3) Horas extra
    const extras = await client.query('UPDATE extras SET paramedico_id = $2, paramedico_nombre = $3 WHERE paramedico_id = $1', [o.id, d.id, d.nombre]);
    // 4) Se elimina el registro duplicado
    await client.query('DELETE FROM paramedicos WHERE id = $1', [o.id]);
    // 5) Aviso: si al unir la persona quedó en dos ambulancias a la vez en algún turno
    const dobles = await client.query(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT 1 FROM turnos t JOIN turno_paramedicos tp ON tp.turno_id = t.id
         WHERE tp.paramedico_id = $1 GROUP BY t.fecha, t.turno HAVING COUNT(*) > 1) x`, [d.id]);
    await client.query('COMMIT');
    res.json({ destino: d.nombre, origen: o.nombre, turnos_movidos: movidos.rowCount, turnos_en_ambos: ambos.rowCount, extras_movidos: extras.rowCount, dobles_asignados: dobles.rows[0].n });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const ex = await db.query('SELECT COUNT(*)::int AS n FROM extras WHERE paramedico_id=$1', [req.params.id]);
    if (ex.rows[0].n > 0)
      return res.status(409).json({ error: `No se puede eliminar: tiene ${ex.rows[0].n} registro(s) de horas extra. Eliminá primero esas horas extra desde Control de Horas / la malla.` });
    await db.query('DELETE FROM turno_paramedicos WHERE paramedico_id=$1', [req.params.id]);
    const { rowCount } = await db.query('DELETE FROM paramedicos WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Paramédico no encontrado' });
    res.json({ deleted: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
