const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { randomUUID } = require('crypto');

const ROLES_VALIDOS = ['Paramédico', 'Conductor', 'Radioperador'];

const { normalizarCedula, cedulaValida, esCedulaProvisional, siguienteCedulaProvisional, MENSAJE_CEDULA, buscarCedulaDuplicada: buscarDup } = require('../lib/cedula');
const { requireAdmin, esAdmin } = require('../lib/auth');
const buscarCedulaDuplicada = (cedula, excluirId) => buscarDup(db, cedula, excluirId);

function respuestaDuplicada(dup, cedula) {
  const base = `La cédula ${String(cedula).trim()} ya está registrada a nombre de ${dup.nombre} (${dup.codigo})`;
  const error = dup.activo === false
    ? `${base}, que figura como RETIRADA. Si volvió a la empresa, pídele al administrador que la reactive en la base de datos (no la registres de nuevo: así no se pierde su historial).`
    : `${base}. No se puede registrar a la misma persona dos veces.`;
  return { error, duplicado: { nombre: dup.nombre, codigo: dup.codigo, activo: dup.activo !== false } };
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
    const existe = await db.query('SELECT nombre, activo FROM paramedicos WHERE codigo = $1', [codigoUp]);
    if (existe.rows.length) return res.status(400).json({ error: existe.rows[0].activo === false
      ? `El código ${codigoUp} pertenece a ${existe.rows[0].nombre}, que figura como retirada. Usa otro código.`
      : 'Ya existe un paramédico con ese código' });

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

// "Eliminar" RETIRA a la persona: desaparece de la aplicación pero NO se borra nada (sus turnos y horas siguen
// en la base de datos y en el Control de Horas de los meses en que trabajó). Solo el administrador puede reactivarla (desde la base de datos).
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      'UPDATE paramedicos SET activo = FALSE, retirado_el = COALESCE(retirado_el, NOW()) WHERE id = $1 RETURNING nombre',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Paramédico no encontrado' });
    res.json({ inactivado: true, nombre: rows[0].nombre });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
