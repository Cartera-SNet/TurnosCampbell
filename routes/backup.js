const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

const BACKUP_KEY = process.env.BACKUP_KEY;

function auth(req, res, next) {
  if (!BACKUP_KEY)
    return res.status(503).json({ error: 'Backup deshabilitado. Definí BACKUP_KEY en Railway.' });
  const key = req.headers['x-backup-key'] || req.query.key;
  if (key !== BACKUP_KEY)
    return res.status(401).json({ error: 'Clave de backup incorrecta.' });
  next();
}

// Helper: exportar todos los datos como objeto JSON
async function exportarDatos() {
  const [{ rows: paramedicos }, { rows: ambulancias }, { rows: turnos },
         { rows: turno_paramedicos }, { rows: extras }] = await Promise.all([
    db.query('SELECT * FROM paramedicos ORDER BY nombre'),
    db.query('SELECT * FROM ambulancias ORDER BY codigo'),
    db.query('SELECT * FROM turnos ORDER BY fecha'),
    db.query('SELECT * FROM turno_paramedicos'),
    db.query('SELECT * FROM extras ORDER BY fecha'),
  ]);
  return { exportado: new Date().toISOString(), paramedicos, ambulancias, turnos, turno_paramedicos, extras };
}

// Helper: enviar email con Resend
async function enviarConResend({ destino, fecha, filename, json, paramedicos, ambulancias, turnos, extras }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Falta la variable RESEND_API_KEY en Railway.');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Fundación Campbell <onboarding@resend.dev>',
      to:   [destino],
      subject: `💾 Backup Campbell – ${fecha}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;">
          <h2 style="color:#1B5E37;">💾 Backup – Fundación Campbell</h2>
          <p>Se adjunta el archivo <strong>${filename}</strong> con todos los datos exportados.</p>
          <table style="border-collapse:collapse;width:100%;font-size:14px;">
            <tr><td style="padding:6px;color:#666;">Paramédicos</td><td><strong>${paramedicos.length}</strong></td></tr>
            <tr><td style="padding:6px;color:#666;">Ambulancias</td><td><strong>${ambulancias.length}</strong></td></tr>
            <tr><td style="padding:6px;color:#666;">Turnos</td><td><strong>${turnos.length}</strong></td></tr>
            <tr><td style="padding:6px;color:#666;">Horas extra</td><td><strong>${extras.length}</strong></td></tr>
          </table>
          <p style="color:#888;font-size:12px;margin-top:20px;">
            Guardá este archivo en un lugar seguro como respaldo.
          </p>
        </div>`,
      attachments: [{
        filename,
        content: Buffer.from(json).toString('base64'),
      }],
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.message || JSON.stringify(data));
  return data;
}

// ── GET /api/backup/info ──────────────────────────────────────
router.get('/info', auth, async (req, res) => {
  try {
    const [p, a, t, e] = await Promise.all([
      db.query('SELECT COUNT(*) AS n FROM paramedicos'),
      db.query('SELECT COUNT(*) AS n FROM ambulancias'),
      db.query('SELECT COUNT(*) AS n FROM turnos'),
      db.query('SELECT COUNT(*) AS n FROM extras'),
    ]);
    res.json({
      motor: 'PostgreSQL (Neon)',
      registros: {
        paramedicos: parseInt(p.rows[0].n),
        ambulancias: parseInt(a.rows[0].n),
        turnos:      parseInt(t.rows[0].n),
        extras:      parseInt(e.rows[0].n),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/backup/descargar ─────────────────────────────────
router.get('/descargar', auth, async (req, res) => {
  try {
    const datos    = await exportarDatos();
    const fecha    = new Date().toISOString().slice(0, 10);
    const filename = `campbell_backup_${fecha}.json`;
    const json     = JSON.stringify(datos, null, 2);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(json);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/backup/enviar-email ─────────────────────────────
router.post('/enviar-email', auth, async (req, res) => {
  const destino = process.env.BACKUP_EMAIL_DESTINO;
  if (!destino) return res.status(503).json({ error: 'Falta la variable BACKUP_EMAIL_DESTINO en Railway.' });

  try {
    const datos    = await exportarDatos();
    const fecha    = new Date().toISOString().slice(0, 10);
    const filename = `campbell_backup_${fecha}.json`;
    const json     = JSON.stringify(datos, null, 2);

    await enviarConResend({
      destino, fecha, filename, json,
      paramedicos: datos.paramedicos,
      ambulancias: datos.ambulancias,
      turnos:      datos.turnos,
      extras:      datos.extras,
    });

    res.json({ ok: true, mensaje: `Backup enviado a ${destino}`, archivo: filename });
  } catch (e) { res.status(500).json({ error: 'Error al enviar: ' + e.message }); }
});

module.exports = router;

// ── Backup automático diario (medianoche) ─────────────────────
function programarBackupDiario() {
  function msHastaMedianoche() {
    const maniana = new Date();
    maniana.setDate(maniana.getDate() + 1);
    maniana.setHours(0, 0, 0, 0);
    return maniana - new Date();
  }

  async function enviarAutomatico() {
    const destino = process.env.BACKUP_EMAIL_DESTINO;
    if (!destino || !process.env.RESEND_API_KEY) return;

    try {
      const datos    = await exportarDatos();
      const fecha    = new Date().toISOString().slice(0, 10);
      const filename = `campbell_backup_${fecha}.json`;
      const json     = JSON.stringify(datos, null, 2);

      await enviarConResend({
        destino, fecha, filename, json,
        paramedicos: datos.paramedicos,
        ambulancias: datos.ambulancias,
        turnos:      datos.turnos,
        extras:      datos.extras,
      });
      console.log(`[Backup] Email enviado a ${destino}`);
    } catch (err) {
      console.error('[Backup] Error en envío automático:', err.message);
    }
    setTimeout(enviarAutomatico, 24 * 60 * 60 * 1000);
  }

  setTimeout(enviarAutomatico, msHastaMedianoche());
  console.log(`[Backup] Programado para medianoche`);
}

programarBackupDiario();