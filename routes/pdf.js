const express     = require('express');
const router      = express.Router();
const PDFDocument = require('pdfkit');
const path        = require('path');
const db          = require('../db/database');

const MESES    = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS     = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const VERDE    = '#1B5E37';
const VERDE_M  = '#2E7D52';
const VERDE_CL = '#EAF4EE';
const AMARILLO = '#FFF9C4';
const ROJO_BG  = '#FDECEA';
const ROJO     = '#C62828';
const GRIS     = '#F5F5F5';
const GRIS_T   = '#666666';

function getSemana(fechaStr) {
  const d   = new Date(fechaStr + 'T12:00:00');
  const day = d.getDay();
  const lunes = new Date(d);
  lunes.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return lunes.toISOString().split('T')[0];
}
function fmtFecha(f) { return f.split('-').reverse().join('/'); }

function drawRect(doc, x, y, w, h, color) {
  doc.save().rect(x, y, w, h).fill(color).restore();
}

function headerPagina(doc, titulo, subtitulo, logoPath, pageW) {
  drawRect(doc, 0, 0, pageW, 70, VERDE);
  try { doc.image(logoPath, 20, 8, { height: 54 }); } catch(e) {}
  doc.fillColor('white').font('Helvetica-Bold').fontSize(15)
     .text('FUNDACIÓN CAMPBELL', 90, 12, { width: pageW - 110 });
  doc.font('Helvetica').fontSize(10)
     .text(titulo, 90, 32, { width: pageW - 110 });
  doc.fontSize(8).fillColor('rgba(255,255,255,0.75)')
     .text(subtitulo, 90, 48, { width: pageW - 110 });
  doc.fillColor('black');
}

function pieAgina(doc, pageW, pageH, mesNombre, anio) {
  const y = pageH - 28;
  drawRect(doc, 0, y, pageW, 28, VERDE);
  doc.fillColor('white').font('Helvetica').fontSize(8)
     .text(`${mesNombre} ${anio}  |  Fundación Campbell  |  Sistema de Gestión de Turnos`,
       20, y + 9, { width: pageW - 100 });
  doc.text(`Página ${doc.bufferedPageRange().start + doc.bufferedPageRange().count}`,
    pageW - 80, y + 9, { width: 70, align: 'right' });
  doc.fillColor('black');
}

function filaTH(doc, cols, y, rowH = 18) {
  cols.forEach(c => {
    drawRect(doc, c.x, y, c.w, rowH, VERDE);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(7.5)
       .text(c.label, c.x + 3, y + (rowH - 8) / 2 + 1, { width: c.w - 6, align: c.align || 'center' });
  });
  return y + rowH;
}

function filaTD(doc, vals, cols, y, rowH, bgColor) {
  if (bgColor) drawRect(doc, cols[0].x, y, cols.reduce((s, c) => s + c.w, 0), rowH, bgColor);
  doc.save().moveTo(cols[0].x, y + rowH).lineTo(cols[0].x + cols.reduce((s, c) => s + c.w, 0), y + rowH)
     .strokeColor('#DDDDDD').lineWidth(0.4).stroke().restore();
  cols.forEach((c, i) => {
    const val = vals[i] !== undefined ? String(vals[i]) : '';
    doc.fillColor(c.color || '#222222').font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5)
       .text(val, c.x + 3, y + (rowH - 8) / 2 + 1, { width: c.w - 6, align: c.align || 'left', lineBreak: false });
  });
  return y + rowH;
}

router.get('/turnos', async (req, res) => {
  const { mes, anio } = req.query;
  if (!mes || !anio) return res.status(400).json({ error: 'mes y anio requeridos' });

  const mesStr    = String(mes).padStart(2, '0');
  const mesNombre = MESES[parseInt(mes) - 1];
  const prefix    = `${anio}-${mesStr}%`;
  const limite    = parseInt(mes) >= 7 ? 42 : 44;
  const logoPath  = path.join(__dirname, '../public/img/logo.png');

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

  const doc    = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  doc.on('end',  () => {
    const buf = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Turnos_${mesNombre}_${anio}.pdf"`);
    res.send(buf);
  });

  const pageW  = 841.89;
  const pageH  = 595.28;
  const ML     = 24;
  const MR     = 24;
  const bodyW  = pageW - ML - MR;
  const bodyTop = 82;
  const bodyBot = pageH - 36;
  const rowH   = 16;

  // PÁGINA 1: MALLA DE TURNOS
  doc.addPage();
  headerPagina(doc, `MALLA DE TURNOS — ${mesNombre.toUpperCase()} ${anio}`,
    `Turno Día: 7:00 am–6:00 pm (11 h)   |   Turno Noche: 6:00 pm–7:00 am (13 h)   |   Límite semanal: ${limite} h`,
    logoPath, pageW);
  pieAgina(doc, pageW, pageH, mesNombre, anio);

  const colsMalla = [
    { x: ML,       w: 52,  label: 'Fecha',       align: 'center' },
    { x: ML+52,    w: 52,  label: 'Día',         align: 'center' },
    { x: ML+104,   w: 70,  label: 'Ambulancia',  align: 'center' },
    { x: ML+174,   w: 60,  label: 'Turno',       align: 'center' },
    { x: ML+234,   w: 70,  label: 'Horario',     align: 'center' },
    { x: ML+304,   w: 32,  label: 'Horas',       align: 'center' },
    { x: ML+336,   w: bodyW - 336, label: 'Paramédicos', align: 'left' },
  ];

  let y = filaTH(doc, colsMalla, bodyTop, 20);
  let semAnt = null;
  const diasMes = new Date(anio, mes, 0).getDate();

  for (let d = 1; d <= diasMes; d++) {
    const fecha     = `${anio}-${mesStr}-${String(d).padStart(2,'0')}`;
    const fobj      = new Date(fecha + 'T12:00:00');
    const diaNom    = DIAS[fobj.getDay()];
    const semana    = getSemana(fecha);
    const esFS      = fobj.getDay() === 0 || fobj.getDay() === 6;
    const turnosDia = turnos.filter(t => t.fecha === fecha);
    const extrasDia = extras.filter(e => e.fecha === fecha);

    if (semana !== semAnt) {
      if (y + rowH > bodyBot) {
        doc.addPage();
        headerPagina(doc, `MALLA DE TURNOS — ${mesNombre.toUpperCase()} ${anio} (cont.)`,
          `Turno Día: 7:00 am–6:00 pm (11 h)   |   Turno Noche: 6:00 pm–7:00 am (13 h)`,
          logoPath, pageW);
        pieAgina(doc, pageW, pageH, mesNombre, anio);
        y = filaTH(doc, colsMalla, bodyTop, 20);
      }
      drawRect(doc, ML, y, bodyW, 13, VERDE_CL);
      doc.save().moveTo(ML, y).lineTo(ML + bodyW, y).strokeColor(VERDE_M).lineWidth(0.8).stroke().restore();
      doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(7)
         .text(`  Semana del ${fmtFecha(semana)}`, ML + 3, y + 3, { width: bodyW - 6 });
      y += 13;
      semAnt = semana;
    }

    if (y + rowH > bodyBot) {
      doc.addPage();
      headerPagina(doc, `MALLA DE TURNOS — ${mesNombre.toUpperCase()} ${anio} (cont.)`,
        `Turno Día: 7:00 am–6:00 pm (11 h)   |   Turno Noche: 6:00 pm–7:00 am (13 h)`,
        logoPath, pageW);
      pieAgina(doc, pageW, pageH, mesNombre, anio);
      y = filaTH(doc, colsMalla, bodyTop, 20);
    }

    if (turnosDia.length === 0 && extrasDia.length === 0) {
      y = filaTD(doc, [fmtFecha(fecha), diaNom, '—', '—', '—', '—', '—'], colsMalla, y, rowH, esFS ? GRIS : null);
    } else {
      turnosDia.forEach(t => {
        if (y + rowH > bodyBot) {
          doc.addPage();
          headerPagina(doc, `MALLA DE TURNOS — ${mesNombre.toUpperCase()} ${anio} (cont.)`, '', logoPath, pageW);
          pieAgina(doc, pageW, pageH, mesNombre, anio);
          y = filaTH(doc, colsMalla, bodyTop, 20);
        }
        const bg = t.turno === 'dia' ? '#FFFDE7' : '#EDE7F6';
        const horario = t.turno === 'dia' ? '7:00am - 6:00pm' : '6:00pm - 7:00am';
        const paraStr = t.paramedicos.map(p => p.nombre).join(' / ');
        y = filaTD(doc,
          [fmtFecha(fecha), diaNom, t.ambulancia_codigo, t.turno === 'dia' ? 'DIA' : 'NOCHE', horario, `${t.horas}h`, paraStr],
          colsMalla, y, rowH, bg);
      });
      extrasDia.forEach(e => {
        if (y + rowH > bodyBot) {
          doc.addPage();
          headerPagina(doc, `MALLA DE TURNOS — ${mesNombre.toUpperCase()} ${anio} (cont.)`, '', logoPath, pageW);
          pieAgina(doc, pageW, pageH, mesNombre, anio);
          y = filaTH(doc, colsMalla, bodyTop, 20);
        }
        y = filaTD(doc,
          [fmtFecha(fecha), diaNom, e.ambulancia_codigo || '—', 'EXTRA', e.nota || '—', `${e.horas}h`, e.paramedico_nombre],
          colsMalla, y, rowH, '#E8F5E9');
      });
    }
  }

  // PÁGINA: CONTROL DE HORAS
  doc.addPage();
  headerPagina(doc, `CONTROL DE HORAS — ${mesNombre.toUpperCase()} ${anio}`,
    `Límite semanal: ${limite} horas   |   Celdas resaltadas en rojo = semana excedida`,
    logoPath, pageW);
  pieAgina(doc, pageW, pageH, mesNombre, anio);

  const colsH = [
    { x: ML,       w: 160, label: 'Paramédico',   align: 'left'   },
    { x: ML+160,   w: 80,  label: 'Semana',       align: 'center' },
    { x: ML+240,   w: 70,  label: 'Horas Semana', align: 'center' },
    { x: ML+310,   w: 55,  label: 'Límite',       align: 'center' },
    { x: ML+365,   w: 55,  label: 'Exceso',       align: 'center' },
    { x: ML+420,   w: 80,  label: 'Estado',       align: 'center' },
    { x: ML+500,   w: bodyW - 500, label: 'Total Mes', align: 'center' },
  ];

  let yH = filaTH(doc, colsH, bodyTop, 20);

  const reporte = {};
  turnos.forEach(t => {
    t.paramedicos.forEach(p => {
      if (!reporte[p.id]) reporte[p.id] = { nombre: p.nombre, semanas: {} };
      const sem = getSemana(t.fecha);
      reporte[p.id].semanas[sem] = (reporte[p.id].semanas[sem] || 0) + t.horas;
    });
  });
  extras.forEach(e => {
    if (!reporte[e.paramedico_id]) reporte[e.paramedico_id] = { nombre: e.paramedico_nombre, semanas: {} };
    const sem = getSemana(e.fecha);
    reporte[e.paramedico_id].semanas[sem] = (reporte[e.paramedico_id].semanas[sem] || 0) + e.horas;
  });

  let totalHorasMes = 0;
  let totalExcesos  = 0;
  const pmOrdenados = Object.values(reporte).sort((a, b) => a.nombre.localeCompare(b.nombre));

  pmOrdenados.forEach(r => {
    const semanas = Object.entries(r.semanas).sort(([a], [b]) => a.localeCompare(b));
    const totalPm = semanas.reduce((s, [, h]) => s + h, 0);
    totalHorasMes += totalPm;

    semanas.forEach(([sem, horas], idx) => {
      const exceso = Math.max(0, horas - limite);
      const alerta = horas > limite;
      if (alerta) totalExcesos++;

      if (yH + rowH > bodyBot) {
        doc.addPage();
        headerPagina(doc, `CONTROL DE HORAS — ${mesNombre.toUpperCase()} ${anio} (cont.)`, '', logoPath, pageW);
        pieAgina(doc, pageW, pageH, mesNombre, anio);
        yH = filaTH(doc, colsH, bodyTop, 20);
      }

      const bg = alerta ? ROJO_BG : (idx % 2 === 0 ? '#F9FBF9' : null);
      yH = filaTD(doc, [
        idx === 0 ? r.nombre : '',
        fmtFecha(sem),
        `${horas} h`,
        `${limite} h`,
        exceso > 0 ? `+${exceso} h` : '—',
        alerta ? 'EXCEDIDO' : 'OK',
        idx === 0 ? `${totalPm} h` : '',
      ], colsH.map((c, i) => ({
        ...c,
        bold:  (i === 0 && idx === 0) || i === 6,
        color: i === 5 ? (alerta ? ROJO : VERDE_M) : (i === 4 && exceso > 0 ? ROJO : '#222222'),
      })), yH, rowH, bg);
    });

    if (yH < bodyBot) {
      doc.save().moveTo(ML, yH).lineTo(ML + bodyW, yH)
         .strokeColor(VERDE_M).lineWidth(0.6).stroke().restore();
    }
  });

  if (yH + 26 > bodyBot) {
    doc.addPage();
    headerPagina(doc, `CONTROL DE HORAS — Resumen`, '', logoPath, pageW);
    pieAgina(doc, pageW, pageH, mesNombre, anio);
    yH = bodyTop;
  }
  yH += 10;
  drawRect(doc, ML, yH, bodyW, 22, VERDE);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(9)
     .text(
       `RESUMEN: ${pmOrdenados.length} paramédicos   |   Total horas trabajadas: ${totalHorasMes} h   |   Semanas excedidas: ${totalExcesos}   |   Límite: ${limite} h/semana`,
       ML + 8, yH + 7, { width: bodyW - 16, align: 'left' }
     );

  doc.end();
});

module.exports = router;
