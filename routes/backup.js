const express = require('express');
const router  = express.Router();
const multer  = require('multer');
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
      nota: 'El backup y restore se maneja desde el panel de Neon (Backup & Restore).',
      neon_dashboard: 'https://console.neon.tech',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/backup/enviar-email ─────────────────────────────
// Exporta todas las tablas como JSON y las manda por email
router.post('/enviar-email', auth, async (req, res) => {
  const { createTransport } = require('nodemailer');
  const user     = process.env.BACKUP_EMAIL_USER;
  const password = process.env.BACKUP_EMAIL_PASSWORD;
  const destino  = process.env.BACKUP_EMAIL_DESTINO;

  if (!user || !password || !destino)
    return res.status(503).json({ error: 'Faltan variables de entorno de email.' });

  try {
    const [{ rows: paramedicos }, { rows: ambulancias }, { rows: turnos },
           { rows: turno_paramedicos }, { rows: extras }] = await Promise.all([
      db.query('SELECT * FROM paramedicos ORDER BY nombre'),
      db.query('SELECT * FROM ambulancias ORDER BY codigo'),
      db.query('SELECT * FROM turnos ORDER BY fecha'),
      db.query('SELECT * FROM turno_paramedicos'),
      db.query('SELECT * FROM extras ORDER BY fecha'),
    ]);

    const backup = { exportado: new Date().toISOString(), paramedicos, ambulancias, turnos, turno_paramedicos, extras };
    const fecha    = new Date().toISOString().slice(0, 10);
    const filename = `campbell_backup_${fecha}.json`;
    const json     = JSON.stringify(backup, null, 2);

    const transporter = createTransport({ service: 'gmail', auth: { user, pass: password } });
    await transporter.sendMail({
      from:    `"Fundación Campbell" <${user}>`,
      to:      destino,
      subject: `💾 Backup Campbell – ${new Date().toLocaleDateString('es-AR')}`,
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
            Para restaurar, usá el panel de Neon (Backup &amp; Restore) o importá el JSON desde la app.
          </p>
        </div>`,
      attachments: [{ filename, content: json, contentType: 'application/json' }],
    });

    res.json({ ok: true, mensaje: `Backup enviado a ${destino}`, archivo: filename });
  } catch (e) { res.status(500).json({ error: 'Error al enviar: ' + e.message }); }
});

module.exports = router;

// ── Backup automático diario ──────────────────────────────────
function programarBackupDiario() {
  function msHastaMedianoche() {
    const maniana = new Date();
    maniana.setDate(maniana.getDate() + 1);
    maniana.setHours(0, 0, 0, 0);
    return maniana - new Date();
  }

  async function enviarAutomatico() {
    const user     = process.env.BACKUP_EMAIL_USER;
    const password = process.env.BACKUP_EMAIL_PASSWORD;
    const destino  = process.env.BACKUP_EMAIL_DESTINO;
    if (!user || !password || !destino) return;

    try {
      const { createTransport } = require('nodemailer');
      const [{ rows: p }, { rows: a }, { rows: t }, { rows: tp }, { rows: e }] = await Promise.all([
        db.query('SELECT * FROM paramedicos'),
        db.query('SELECT * FROM ambulancias'),
        db.query('SELECT * FROM turnos'),
        db.query('SELECT * FROM turno_paramedicos'),
        db.query('SELECT * FROM extras'),
      ]);
      const fecha    = new Date().toISOString().slice(0, 10);
      const filename = `campbell_backup_${fecha}.json`;
      const json     = JSON.stringify({ exportado: new Date().toISOString(), paramedicos: p, ambulancias: a, turnos: t, turno_paramedicos: tp, extras: e }, null, 2);

      const transporter = createTransport({ service: 'gmail', auth: { user, pass: password } });
      await transporter.sendMail({
        from: `"Fundación Campbell" <${user}>`,
        to: destino,
        subject: `💾 Backup diario Campbell – ${fecha}`,
        html: `<p>Backup automático adjunto: <strong>${filename}</strong></p>`,
        attachments: [{ filename, content: json, contentType: 'application/json' }],
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
