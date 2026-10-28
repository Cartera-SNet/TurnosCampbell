// La cédula identifica a la persona. Se compara sin puntos, espacios ni guiones (1.042.460.556 = 1042460556).
function normalizarCedula(c) {
  return String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

// Entre 5 y 15 números o letras (cédulas, extranjería, pasaporte)
function cedulaValida(c) {
  const n = normalizarCedula(c);
  return n.length >= 5 && n.length <= 15;
}

const MENSAJE_CEDULA = 'La cédula debe tener entre 5 y 15 números o letras. Si todavía no la tienen, dejala vacía y se asigna un código provisional.';

// Quien aún no tiene cédula recibe un código provisional consecutivo (SC0001, SC0002…) hasta que se cargue la real.
const esCedulaProvisional = (c) => /^SC\d+$/.test(normalizarCedula(c));

// El número sale de una secuencia de la base de datos: cada código provisional es único y NO se reutiliza
// (aunque la persona reciba después su cédula real), para no confundir a sistemas externos que lo hayan guardado.
async function siguienteCedulaProvisional(db) {
  const { rows } = await db.query("SELECT nextval('seq_cedula_provisional') AS n");
  return 'SC' + String(rows[0].n).padStart(4, '0');
}

async function buscarCedulaDuplicada(db, cedula, excluirId) {
  const norm = normalizarCedula(cedula);
  if (!norm) return null;
  const { rows } = await db.query(
    `SELECT id, nombre, codigo FROM paramedicos
     WHERE cedula IS NOT NULL AND cedula <> ''
       AND UPPER(regexp_replace(cedula, '[^0-9A-Za-z]', '', 'g')) = $1
       AND ($2::text IS NULL OR id <> $2)
     LIMIT 1`,
    [norm, excluirId || null]
  );
  return rows[0] || null;
}

module.exports = { normalizarCedula, cedulaValida, esCedulaProvisional, siguienteCedulaProvisional, MENSAJE_CEDULA, buscarCedulaDuplicada };
