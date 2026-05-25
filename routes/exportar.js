const express = require('express');
const router  = express.Router();
const ExcelJS = require('exceljs');
const db      = require('../db/database');

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

function getSemana(fechaStr) {
  const d    = new Date(fechaStr + 'T12:00:00');
  const day  = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const lunes = new Date(d);
  lunes.setDate(d.getDate() + diff);
  return lunes.toISOString().split('T')[0];
}

// Colores Fundación Campbell
const VERDE_OSCURO  = '1B5E37';
const VERDE_MEDIO   = '2E7D52';
const VERDE_CLARO   = 'D6EAD8';
const VERDE_HEADER  = '1B5E37';
const BLANCO        = 'FFFFFF';

router.get('/turnos', async (req, res) => {
  const { mes, anio } = req.query;
  if (!mes || !anio) return res.status(400).json({ error: 'mes y anio requeridos' });

  const mesStr    = String(mes).padStart(2, '0');
  const mesNombre = MESES[parseInt(mes) - 1];
  const prefix    = `${anio}-${mesStr}%`;

  // ── Consultas PostgreSQL ──────────────────────────────────
  const [{ rows: turnosRaw }, { rows: extras }] = await Promise.all([
    db.query("SELECT * FROM turnos WHERE fecha LIKE $1 ORDER BY fecha ASC", [prefix]),
    db.query("SELECT * FROM extras WHERE fecha LIKE $1 ORDER BY fecha ASC", [prefix]),
  ]);
  const turnos = await Promise.all(turnosRaw.map(async t => ({
    ...t,
    paramedicos: (await db.query(
      'SELECT paramedico_id AS id, paramedico_nombre AS nombre FROM turno_paramedicos WHERE turno_id = $1', [t.id]
    )).rows
  })));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Fundación Campbell';
  wb.created = new Date();

  // ─────────────────────────────────────────
  // HOJA 1: MALLA DETALLADA
  // ─────────────────────────────────────────
  const ws1 = wb.addWorksheet('Malla de Turnos', { pageSetup: { orientation: 'landscape', fitToPage: true } });

  ws1.mergeCells('A1:G1');
  const tit1 = ws1.getCell('A1');
  tit1.value = `FUNDACIÓN CAMPBELL — MALLA DE TURNOS — ${mesNombre.toUpperCase()} ${anio}`;
  tit1.font  = { name: 'Calibri', size: 14, bold: true, color: { argb: BLANCO } };
  tit1.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_OSCURO } };
  tit1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(1).height = 32;

  ws1.mergeCells('A2:G2');
  const sub1 = ws1.getCell('A2');
  sub1.value = `Turno Día: 7:00 am – 6:00 pm (11 h)   |   Turno Noche: 6:00 pm – 7:00 am (13 h)   |   Límite semanal: ${parseInt(mes) >= 7 ? 42 : 44} h`;
  sub1.font  = { name: 'Calibri', size: 10, italic: true, color: { argb: BLANCO } };
  sub1.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_MEDIO } };
  sub1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(2).height = 20;

  const headers1 = ['Fecha', 'Día', 'Ambulancia', 'Turno', 'Horario', 'Horas', 'Paramédicos'];
  const row3 = ws1.addRow(headers1);
  row3.eachCell(cell => {
    cell.font      = { name: 'Calibri', size: 10, bold: true, color: { argb: BLANCO } };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_HEADER } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = { top: { style: 'medium', color: { argb: BLANCO } }, bottom: { style: 'medium', color: { argb: BLANCO } }, left: { style: 'thin', color: { argb: BLANCO } }, right: { style: 'thin', color: { argb: BLANCO } } };
  });
  ws1.getRow(3).height = 22;

  let semanaAnterior = null;
  let filaActual = 4;
  const diasDelMes = new Date(anio, mes, 0).getDate();

  for (let d = 1; d <= diasDelMes; d++) {
    const fecha      = `${anio}-${mesStr}-${String(d).padStart(2,'0')}`;
    const fechaObj   = new Date(fecha + 'T12:00:00');
    const diaNombre  = DIAS[fechaObj.getDay()];
    const semana     = getSemana(fecha);
    const esFinDeSemana = fechaObj.getDay() === 0 || fechaObj.getDay() === 6;

    if (semana !== semanaAnterior) {
      ws1.mergeCells(`A${filaActual}:G${filaActual}`);
      const sepCell = ws1.getCell(`A${filaActual}`);
      sepCell.value = `Semana del ${semana.split('-').reverse().join('/')}`;
      sepCell.font  = { name: 'Calibri', size: 9, bold: true, color: { argb: VERDE_OSCURO } };
      sepCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_CLARO } };
      sepCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      ws1.getRow(filaActual).height = 16;
      filaActual++;
      semanaAnterior = semana;
    }

    const turnosDia = turnos.filter(t => t.fecha === fecha);
    const extrasDia = extras.filter(e => e.fecha === fecha);

    if (turnosDia.length === 0 && extrasDia.length === 0) {
      const row = ws1.addRow([fecha.split('-').reverse().join('/'), diaNombre, '—', '—', '—', '—', '—']);
      row.eachCell(cell => {
        cell.font = { name: 'Calibri', size: 9, color: { argb: 'AAAAAA' } };
        cell.fill = esFinDeSemana ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F5F5F5' } } : undefined;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'EEEEEE' } } };
      });
      ws1.getRow(filaActual).height = 16;
      filaActual++;
    } else {
      turnosDia.forEach(t => {
        const paraStr = t.paramedicos.map(p => p.nombre).join(' / ');
        const horario = t.turno === 'dia' ? '7:00 am – 6:00 pm' : '6:00 pm – 7:00 am';
        const bgRow   = t.turno === 'dia' ? 'FFFDE7' : 'EDE7F6';
        const row = ws1.addRow([
          fecha.split('-').reverse().join('/'), diaNombre, t.ambulancia_codigo,
          t.turno === 'dia' ? '☀ Día' : '🌙 Noche', horario, t.horas, paraStr
        ]);
        row.eachCell((cell, col) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgRow } };
          cell.font = { name: 'Calibri', size: 9 };
          cell.alignment = { vertical: 'middle', horizontal: col === 7 ? 'left' : 'center', wrapText: true };
          cell.border = { bottom: { style: 'thin', color: { argb: 'DDDDDD' } }, right: { style: 'thin', color: { argb: 'DDDDDD' } } };
        });
        row.getCell(6).font = { name: 'Calibri', size: 9, bold: true };
        ws1.getRow(filaActual).height = 18;
        filaActual++;
      });

      extrasDia.forEach(e => {
        const row = ws1.addRow([
          fecha.split('-').reverse().join('/'), diaNombre,
          e.ambulancia_codigo || '—', '⚡ Extra', e.nota || '—', e.horas, e.paramedico_nombre
        ]);
        row.eachCell((cell, col) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E8F5E9' } };
          cell.font = { name: 'Calibri', size: 9 };
          cell.alignment = { vertical: 'middle', horizontal: col === 7 ? 'left' : 'center', wrapText: true };
          cell.border = { bottom: { style: 'thin', color: { argb: 'DDDDDD' } }, right: { style: 'thin', color: { argb: 'DDDDDD' } } };
        });
        ws1.getRow(filaActual).height = 18;
        filaActual++;
      });
    }
  }

  ws1.columns = [{ width: 13 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 20 }, { width: 8 }, { width: 45 }];

  // ─────────────────────────────────────────
  // HOJA 2: CONTROL DE HORAS
  // ─────────────────────────────────────────
  const ws2 = wb.addWorksheet('Control de Horas');
  const limiteSemanal = parseInt(mes) >= 7 ? 42 : 44;

  ws2.mergeCells('A1:F1');
  const tit2 = ws2.getCell('A1');
  tit2.value = `FUNDACIÓN CAMPBELL — CONTROL DE HORAS — ${mesNombre.toUpperCase()} ${anio}`;
  tit2.font  = { name: 'Calibri', size: 14, bold: true, color: { argb: BLANCO } };
  tit2.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_OSCURO } };
  tit2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(1).height = 32;

  ws2.mergeCells('A2:F2');
  const sub2 = ws2.getCell('A2');
  sub2.value = `Límite semanal: ${limiteSemanal} horas   |   Celdas en rojo = semana excedida`;
  sub2.font  = { name: 'Calibri', size: 10, italic: true, color: { argb: BLANCO } };
  sub2.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_MEDIO } };
  sub2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(2).height = 20;

  const headers2 = ['Paramédico', 'Semana', 'Horas Semana', 'Límite', 'Exceso', 'Estado'];
  const hrow2 = ws2.addRow(headers2);
  hrow2.eachCell(cell => {
    cell.font      = { name: 'Calibri', size: 10, bold: true, color: { argb: BLANCO } };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_HEADER } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = { bottom: { style: 'medium', color: { argb: BLANCO } } };
  });
  ws2.getRow(3).height = 22;

  const reporte = {};
  turnos.forEach(t => {
    t.paramedicos.forEach(p => {
      if (!reporte[p.id]) reporte[p.id] = { nombre: p.nombre, semanas: {} };
      const sem = getSemana(t.fecha);
      if (!reporte[p.id].semanas[sem]) reporte[p.id].semanas[sem] = 0;
      reporte[p.id].semanas[sem] += t.horas;
    });
  });
  extras.forEach(e => {
    if (!reporte[e.paramedico_id]) reporte[e.paramedico_id] = { nombre: e.paramedico_nombre, semanas: {} };
    const sem = getSemana(e.fecha);
    if (!reporte[e.paramedico_id].semanas[sem]) reporte[e.paramedico_id].semanas[sem] = 0;
    reporte[e.paramedico_id].semanas[sem] += e.horas;
  });

  let filaH = 4;
  let totalHorasMes = 0;
  let totalExcesos  = 0;

  Object.values(reporte)
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .forEach(r => {
      const semanas = Object.entries(r.semanas).sort(([a], [b]) => a.localeCompare(b));
      const totalPm = semanas.reduce((s, [, h]) => s + h, 0);
      totalHorasMes += totalPm;

      semanas.forEach(([semana, horas], idx) => {
        const exceso = Math.max(0, horas - limiteSemanal);
        const alerta = horas > limiteSemanal;
        if (alerta) totalExcesos++;

        const semFmt = semana.split('-').reverse().join('/');
        const row = ws2.addRow([idx === 0 ? r.nombre : '', semFmt, horas, limiteSemanal, exceso > 0 ? exceso : '—', alerta ? '⚠ EXCEDIDO' : '✓ OK']);

        row.eachCell((cell, col) => {
          cell.font = { name: 'Calibri', size: 9, bold: col === 1 && idx === 0 };
          cell.alignment = { vertical: 'middle', horizontal: col <= 2 ? 'left' : 'center' };
          cell.border = { bottom: { style: 'thin', color: { argb: 'DDDDDD' } }, right: { style: 'thin', color: { argb: 'DDDDDD' } } };
          if (alerta) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FDECEA' } };
            if (col === 6) cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'C62828' } };
          } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'F9FBF9' : BLANCO } };
            if (col === 6) cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: '2E7D32' } };
          }
        });
        ws2.getRow(filaH).height = 18;
        filaH++;
      });

      const rowTot = ws2.addRow([`  Total ${r.nombre}`, '', totalPm, '', '', '']);
      rowTot.eachCell((cell, col) => {
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: VERDE_OSCURO } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_CLARO } };
        cell.alignment = { vertical: 'middle', horizontal: col === 3 ? 'center' : 'left' };
        cell.border = { top: { style: 'thin', color: { argb: VERDE_OSCURO } }, bottom: { style: 'medium', color: { argb: VERDE_OSCURO } } };
      });
      ws2.getRow(filaH).height = 18;
      filaH++;
    });

  filaH++;
  ws2.mergeCells(`A${filaH}:F${filaH}`);
  const resCell = ws2.getCell(`A${filaH}`);
  resCell.value = `RESUMEN MES: Total horas trabajadas: ${totalHorasMes} h   |   Semanas excedidas: ${totalExcesos}   |   Paramédicos: ${Object.keys(reporte).length}`;
  resCell.font  = { name: 'Calibri', size: 10, bold: true, color: { argb: BLANCO } };
  resCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_OSCURO } };
  resCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(filaH).height = 24;
  ws2.columns = [{ width: 28 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 14 }];

  const filename = `Turnos_${mesNombre}_${anio}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
