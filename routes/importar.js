const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const XLSX    = require('xlsx');
const db      = require('../db/database');
const { randomUUID } = require('crypto');
const { normalizarCedula, cedulaValida, buscarCedulaDuplicada, siguienteCedulaProvisional } = require('../lib/cedula');
const { requireAdmin } = require('../lib/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function leerExcel(buffer) {
  const wb  = XLSX.read(buffer, { type: 'buffer' });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

// ── Carga masiva de paramédicos ──────────────────────────────
router.post('/paramedicos', requireAdmin, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

  let rows;
  try { rows = leerExcel(req.file.buffer); }
  catch (e) { return res.status(400).json({ error: 'No se pudo leer el archivo Excel: ' + e.message }); }

  if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío' });

  rows = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim().toLowerCase(), v])));
  const primera = rows[0];
  if (!('nombre' in primera) || !('codigo' in primera)) {
    return res.status(400).json({
      error: `El archivo debe tener las columnas "nombre" y "codigo" (y "cedula"). Se encontraron: ${Object.keys(primera).join(', ')}`
    });
  }

  const resultados = { insertados: 0, omitidos: 0, provisionales: 0, errores: [] };

  for (const row of rows) {
    const nombre = String(row.nombre || '').trim();
    const codigo = String(row.codigo || '').trim().toUpperCase();
    const cedula = row.cedula !== undefined ? row.cedula : row['cédula'];
    if (!nombre || !codigo) { resultados.omitidos++; continue; }
    const conCedula = normalizarCedula(cedula).length > 0;
    if (conCedula && !cedulaValida(cedula)) {
      resultados.omitidos++;
      resultados.errores.push(`La cédula de ${nombre} no es válida (5 a 15 números o letras)`);
      continue;
    }

    const existe = await db.query('SELECT nombre, activo FROM paramedicos WHERE codigo=$1', [codigo]);
    if (existe.rows.length) {
      resultados.omitidos++;
      resultados.errores.push(existe.rows[0].activo === false ? `Código "${codigo}" pertenece a ${existe.rows[0].nombre}, que figura como retirada (${nombre})` : `Código "${codigo}" ya existe (${nombre})`);
      continue;
    }
    if (conCedula) {
      const dup = await buscarCedulaDuplicada(db, cedula, null);
      if (dup) {
        resultados.omitidos++;
        resultados.errores.push(`La cédula de ${nombre} ya está registrada a nombre de ${dup.nombre} (${dup.codigo})${dup.activo === false ? ', que figura como retirada: pide al administrador que la reactive' : ''}`);
        continue;
      }
    }
    // Sin cédula: código provisional consecutivo hasta que se cargue la real
    const cedulaFinal = conCedula ? normalizarCedula(cedula) : await siguienteCedulaProvisional(db);
    await db.query('INSERT INTO paramedicos (id, nombre, codigo, cedula) VALUES ($1,$2,$3,$4)', [randomUUID(), nombre, codigo, cedulaFinal]);
    resultados.insertados++;
    if (!conCedula) resultados.provisionales++;
  }

  res.json(resultados);
});

// ── Carga masiva de ambulancias ──────────────────────────────
router.post('/ambulancias', requireAdmin, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

  let rows;
  try { rows = leerExcel(req.file.buffer); }
  catch (e) { return res.status(400).json({ error: 'No se pudo leer el archivo Excel: ' + e.message }); }

  if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío' });

  // Encabezados sin importar mayúsculas/espacios
  rows = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim().toLowerCase(), v])));
  const primera = rows[0];
  if (!('nombre' in primera)) {
    return res.status(400).json({
      error: `El archivo debe tener al menos la columna "nombre" (opcionales: codigo, placa, ips). Se encontraron: ${Object.keys(primera).join(', ')}`
    });
  }

  const resultados = { insertados: 0, omitidos: 0, errores: [] };

  for (const row of rows) {
    const nombre = String(row.nombre || '').trim();
    const codigo = String(row.codigo || nombre).trim().toUpperCase();   // sin columna codigo: se usa el nombre (como en el formulario)
    const placa  = String(row.placa || '').trim().toUpperCase() || null;
    const ips    = String(row.ips || '').trim().toUpperCase() || null;
    if (!nombre || !codigo) { resultados.omitidos++; continue; }

    if (ips) {
      const okIps = await db.query('SELECT 1 FROM empresas WHERE codigo=$1 AND activa = TRUE', [ips]);
      if (!okIps.rows.length) {
        resultados.omitidos++;
        resultados.errores.push(`IPS "${ips}" no existe (${nombre})`);
        continue;
      }
    }

    const existe = await db.query('SELECT id FROM ambulancias WHERE codigo=$1', [codigo]);
    if (existe.rows.length) {
      resultados.omitidos++;
      resultados.errores.push(`Código "${codigo}" ya existe (${nombre})`);
      continue;
    }
    await db.query('INSERT INTO ambulancias (id, nombre, codigo, placa, ips) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), nombre, codigo, placa, ips]);
    resultados.insertados++;
  }

  res.json(resultados);
});

// ── Plantillas de Excel para importar (la hoja 1 solo trae los encabezados; las instrucciones van en la hoja 2) ──
router.get('/plantilla/:tipo', async (req, res) => {
  const tipo = req.params.tipo;
  if (!['paramedicos', 'ambulancias'].includes(tipo)) return res.status(404).json({ error: 'Plantilla no encontrada' });
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const encabezados = tipo === 'paramedicos' ? ['nombre', 'codigo', 'cedula'] : ['nombre', 'codigo', 'placa', 'ips'];
  const ws = wb.addWorksheet(tipo === 'paramedicos' ? 'Personal' : 'Ambulancias');
  ws.addRow(encabezados).eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E37' } };
  });
  encabezados.forEach((_, i) => { ws.getColumn(i + 1).width = 22; });
  const ayuda = wb.addWorksheet('Instrucciones');
  const lineas = tipo === 'paramedicos'
    ? ['Escribí una persona por fila en la hoja "Personal" (la fila 1 son los encabezados: no la borres).',
       'nombre: obligatorio.', 'codigo: obligatorio, no puede repetirse (ej: P0043).',
       'cedula: opcional. Si la dejás vacía, el sistema asigna un código provisional consecutivo (SC0001, SC0002…) hasta que se cargue la cédula real.',
       'La cédula no puede repetirse: identifica a la persona.']
    : ['Escribí una ambulancia por fila en la hoja "Ambulancias" (la fila 1 son los encabezados: no la borres).',
       'nombre: obligatorio.', 'codigo: opcional (si falta se usa el nombre).', 'placa: opcional.', 'ips: opcional (C30, CCM o CCSO).'];
  lineas.forEach(l => ayuda.addRow([l]));
  ayuda.getColumn(1).width = 120;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="plantilla_${tipo === 'paramedicos' ? 'personal' : 'ambulancias'}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
