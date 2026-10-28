// Clave de administrador verificada EN EL SERVIDOR (la variable BACKUP_KEY de Railway).
// El navegador la envía en la cabecera "x-backup-key". Nunca viaja en la dirección (URL).
const crypto = require('crypto');

const MAX_FALLOS = 10;                 // intentos con clave incorrecta...
const VENTANA_MS = 15 * 60 * 1000;     // ...dentro de 15 minutos bloquean esa IP
const fallos = new Map();              // ip -> { n, desde }

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();

function claveCoincide(recibida) {
  const esperada = process.env.BACKUP_KEY || '';
  if (!esperada || !recibida) return false;
  return crypto.timingSafeEqual(hash(recibida), hash(esperada));   // comparación en tiempo constante
}

function bloqueada(ip) {
  const f = fallos.get(ip);
  if (!f) return false;
  if (Date.now() - f.desde > VENTANA_MS) { fallos.delete(ip); return false; }
  return f.n >= MAX_FALLOS;
}

function registrarFallo(ip) {
  const f = fallos.get(ip);
  if (!f || Date.now() - f.desde > VENTANA_MS) fallos.set(ip, { n: 1, desde: Date.now() });
  else f.n++;
}

// 'ok' | 'sin_clave' | 'incorrecta' | 'bloqueada' | 'no_configurada'
function estadoClave(req) {
  if (!process.env.BACKUP_KEY) return 'no_configurada';
  if (bloqueada(req.ip)) return 'bloqueada';
  const clave = req.headers['x-backup-key'];
  if (!clave) return 'sin_clave';            // sin clave no cuenta como intento fallido (p. ej. sesión vencida)
  if (claveCoincide(clave)) { fallos.delete(req.ip); return 'ok'; }
  registrarFallo(req.ip);
  return 'incorrecta';
}

// Para rutas que solo puede usar el administrador
function requireAdmin(req, res, next) {
  const e = estadoClave(req);
  if (e === 'ok') return next();
  if (e === 'no_configurada') return res.status(503).json({ error: 'Falta configurar BACKUP_KEY en el servidor (Railway → Variables).' });
  if (e === 'bloqueada') return res.status(429).json({ error: 'Demasiados intentos con clave incorrecta. Probá de nuevo en unos minutos.' });
  return res.status(401).json({ error: e === 'sin_clave' ? 'Se requiere la clave de administrador (la sesión pudo vencer). Volvé a ingresarla.' : 'Clave de administrador incorrecta. Volvé a ingresarla.' });
}

// Para rutas abiertas que muestran más datos si quien consulta es administrador
const esAdmin = (req) => estadoClave(req) === 'ok';

setInterval(() => { const t = Date.now(); for (const [ip, f] of fallos) if (t - f.desde > VENTANA_MS) fallos.delete(ip); }, VENTANA_MS).unref();

module.exports = { requireAdmin, esAdmin, _reiniciarFallos: () => fallos.clear() };
