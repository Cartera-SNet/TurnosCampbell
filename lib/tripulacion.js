// Tripulación de un turno para mostrar en Excel y PDF:
// paramédico(s) primero y el conductor al final, marcado "(cond.)" (igual que en la malla de la pantalla).
function nombresTripulacion(personas, separador = ' / ') {
  return [...personas]
    .sort((a, b) => (a.funcion === 'Conductor') - (b.funcion === 'Conductor'))
    .map(p => p.nombre + (p.funcion === 'Conductor' ? ' (cond.)' : ''))
    .join(separador);
}

module.exports = { nombresTripulacion };
