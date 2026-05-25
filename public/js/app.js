// ============================================================
// ESTADO GLOBAL
// ============================================================
const API = '';
let paramedicos = [];
let ambulancias = [];

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  poblarSelectores();
  await cargarDatos();
  
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('page-' + btn.dataset.page).classList.add('active');
      if (btn.dataset.page === 'paramedicos') renderParamedicos();
      if (btn.dataset.page === 'ambulancias') renderAmbulanciasList();
    });
  });

  cargarMalla();
});

function poblarSelectores() {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mesActual = hoy.getMonth();

  ['malla-mes','horas-mes'].forEach(id => {
    const sel = document.getElementById(id);
    MESES.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = i + 1;
      opt.textContent = m;
      if (i === mesActual) opt.selected = true;
      sel.appendChild(opt);
    });
  });

  ['malla-anio','horas-anio'].forEach(id => {
    const sel = document.getElementById(id);
    for (let y = anio - 1; y <= anio + 2; y++) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === anio) opt.selected = true;
      sel.appendChild(opt);
    }
  });
}

// ============================================================
// EXPORTAR EXCEL
// ============================================================
function exportarExcel() {
  const mes  = document.getElementById('malla-mes').value;
  const anio = document.getElementById('malla-anio').value;
  toast('Generando Excel, espera un momento...', 'success');
  window.location.href = `/api/exportar/turnos?mes=${mes}&anio=${anio}`;
}

function exportarPDF() {
  const mes  = document.getElementById('malla-mes').value;
  const anio = document.getElementById('malla-anio').value;
  toast('Generando PDF, espera un momento...', 'success');
  window.location.href = `/api/pdf/turnos?mes=${mes}&anio=${anio}`;
}

async function cargarDatos() {
  [paramedicos, ambulancias] = await Promise.all([
    fetch('/api/paramedicos').then(r => r.json()),
    fetch('/api/ambulancias').then(r => r.json())
  ]);
}

// ============================================================
// TOAST
// ============================================================
function toast(msg, tipo = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + tipo + ' show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ============================================================
// MODALES
// ============================================================
function cerrarModal(id) {
  document.getElementById(id).classList.remove('open');
}

window.addEventListener('click', e => {
  document.querySelectorAll('.modal.open').forEach(m => {
    if (e.target === m) m.classList.remove('open');
  });
});

// ============================================================
// MALLA MENSUAL
// ============================================================
async function cargarMalla() {
  const mes = document.getElementById('malla-mes').value;
  const anio = document.getElementById('malla-anio').value;
  const container = document.getElementById('malla-container');
  container.innerHTML = '<p style="color:#6b7280;padding:20px">Cargando...</p>';

  const [turnos, extras] = await Promise.all([
    fetch(`/api/turnos?mes=${mes}&anio=${anio}`).then(r => r.json()),
    fetch(`/api/extras?mes=${mes}&anio=${anio}`).then(r => r.json())
  ]);

  if (turnos.error) { container.innerHTML = '<p style="color:red">Error al cargar</p>'; return; }

  // Agrupar por fecha y ambulancia
  const porDia = {};
  const diasDelMes = new Date(anio, mes, 0).getDate();

  for (let d = 1; d <= diasDelMes; d++) {
    const fecha = `${anio}-${String(mes).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    porDia[fecha] = { turnos: [], extras: [] };
  }

  turnos.forEach(t => { if (porDia[t.fecha]) porDia[t.fecha].turnos.push(t); });
  extras.forEach(e => { if (porDia[e.fecha]) porDia[e.fecha].extras.push(e); });

  const limiteSemanal = parseInt(mes) >= 7 ? 42 : 44;

  let html = `
    <div class="leyenda">
      <span><strong>${MESES[mes-1]} ${anio}</strong></span>
      <span class="leyenda-item"><span class="turno-chip turno-dia">☀️ Día</span> 7am-6pm (11h)</span>
      <span class="leyenda-item"><span class="turno-chip turno-noche">🌙 Noche</span> 6pm-7am (13h)</span>
      <span style="color:#6b7280;font-size:12px">Límite semanal: ${limiteSemanal}h</span>
    </div>
    <div class="malla-table-wrapper">
    <table class="malla-table">
      <thead><tr>
        <th>Día</th><th>Fecha</th><th>Ambulancia</th><th>Turno</th><th>Paramédicos</th><th>Acciones</th>
      </tr></thead>
      <tbody>
  `;

  let semanaAnterior = null;

  Object.entries(porDia).forEach(([fecha, data]) => {
    const fechaObj = new Date(fecha + 'T12:00:00');
    const diaSemana = DIAS_SEMANA[fechaObj.getDay()];
    const esFinDeSemana = fechaObj.getDay() === 0 || fechaObj.getDay() === 6;
    const rowStyle = esFinDeSemana ? 'background:#f9fafb' : '';

    // Separador de semana
    const semana = getSemana(fecha);
    if (semana !== semanaAnterior) {
      html += `<tr><td colspan="6" style="background:#e0e7ff;color:#3730a3;font-size:12px;font-weight:600;padding:6px 8px">Semana del ${formatFecha(semana)}</td></tr>`;
      semanaAnterior = semana;
    }

    if (data.turnos.length === 0 && data.extras.length === 0) {
      const diaNum = parseInt(fecha.split('-')[2]);
      html += `<tr style="${rowStyle}">
        <td style="color:#9ca3af">${diaSemana}</td>
        <td style="color:#9ca3af">${diaNum}</td>
        <td colspan="3" style="color:#d1d5db;font-style:italic;font-size:12px">Sin turnos</td>
        <td><button class="btn-icon" style="font-size:12px;padding:4px 8px;width:auto" onclick="abrirModalTurno('${fecha}')">+</button></td>
      </tr>`;
    } else {
      let firstRow = true;
      const totalFilas = data.turnos.length + data.extras.length;

      data.turnos.forEach((t, idx) => {
        const paraStr = t.paramedicos.map(p => p.nombre.split(' ')[0]).join(', ');
        html += `<tr style="${rowStyle}">
          ${firstRow ? `<td rowspan="${totalFilas}" style="font-weight:600">${diaSemana}</td><td rowspan="${totalFilas}" style="font-weight:600">${parseInt(fecha.split('-')[2])}</td>` : ''}
          <td><span style="font-size:12px;font-weight:500">${t.ambulancia_codigo}</span></td>
          <td><span class="turno-chip turno-${t.turno}">${t.turno === 'dia' ? '☀️ Día' : '🌙 Noche'} · ${t.horas}h</span></td>
          <td class="cell-paramedico">${paraStr}</td>
          <td><button class="btn-danger" style="font-size:11px;padding:3px 8px" onclick="eliminarTurno('${t._id}')">✕</button></td>
        </tr>`;
        firstRow = false;
      });

      data.extras.forEach(e => {
        const pm = paramedicos.find(p => p._id === e.paramedico_id);
        html += `<tr style="${rowStyle}">
          ${firstRow ? `<td rowspan="${totalFilas}" style="font-weight:600">${diaSemana}</td><td rowspan="${totalFilas}" style="font-weight:600">${parseInt(fecha.split('-')[2])}</td>` : ''}
          <td><span style="font-size:12px;font-weight:500">${e.ambulancia_codigo || '-'}</span></td>
          <td><span class="turno-chip badge-extra">⚡ Extra · ${e.horas}h</span></td>
          <td class="cell-paramedico">${pm?.nombre?.split(' ')[0] || e.paramedico_nombre || ''} ${e.nota ? `<em>(${e.nota})</em>` : ''}</td>
          <td><button class="btn-danger" style="font-size:11px;padding:3px 8px" onclick="eliminarExtra('${e._id}')">✕</button></td>
        </tr>`;
        firstRow = false;
      });
    }
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function getSemana(fechaStr) {
  const d = new Date(fechaStr + 'T12:00:00');
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const lunes = new Date(d);
  lunes.setDate(d.getDate() + diff);
  return lunes.toISOString().split('T')[0];
}

function formatFecha(fechaStr) {
  const [y, m, d] = fechaStr.split('-');
  return `${d}/${m}/${y}`;
}

// ============================================================
// MODAL TURNO
// ============================================================
function abrirModalTurno(fecha = '') {
  const modal = document.getElementById('modal-turno');
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('turno-fecha').value = fecha || hoy;

  const selAmb = document.getElementById('turno-ambulancia');
  selAmb.innerHTML = '<option value="">-- Seleccionar ambulancia --</option>';
  ambulancias.filter(a => a.activa !== false).forEach(a => {
    selAmb.innerHTML += `<option value="${a._id}" data-codigo="${a.codigo}">${a.codigo} - ${a.nombre}</option>`;
  });

  document.querySelector('input[name="turno-tipo"][value="dia"]').checked = true;

  const cont = document.getElementById('paramedicos-seleccion');
  cont.innerHTML = `<div class="paramedico-row">
    <select class="select-paramedico"><option value="">-- Seleccionar --</option>${optsParamedicos()}</select>
    <button class="btn-icon" onclick="agregarFilaParamedico()">+</button>
  </div>`;

  modal.classList.add('open');
}

function optsParamedicos() {
  return paramedicos.filter(p => p.activo !== false).map(p => `<option value="${p._id}" data-nombre="${p.nombre}">${p.nombre}</option>`).join('');
}

function agregarFilaParamedico() {
  const cont = document.getElementById('paramedicos-seleccion');
  const filas = cont.querySelectorAll('.paramedico-row');
  if (filas.length >= 3) { toast('Máximo 3 paramédicos por turno', 'error'); return; }
  const div = document.createElement('div');
  div.className = 'paramedico-row';
  div.innerHTML = `<select class="select-paramedico"><option value="">-- Seleccionar --</option>${optsParamedicos()}</select>
    <button class="btn-remove-row" onclick="this.parentElement.remove()">✕</button>`;
  cont.appendChild(div);
}

async function guardarTurno() {
  const fecha = document.getElementById('turno-fecha').value;
  const ambSel = document.getElementById('turno-ambulancia');
  const ambulancia_id = ambSel.value;
  const ambulancia_codigo = ambSel.selectedOptions[0]?.dataset.codigo || '';
  const turno = document.querySelector('input[name="turno-tipo"]:checked').value;

  const selects = document.querySelectorAll('.select-paramedico');
  const paramedArr = [];
  selects.forEach(s => {
    if (s.value) {
      paramedArr.push({ id: s.value, nombre: s.selectedOptions[0].dataset.nombre });
    }
  });

  if (!fecha || !ambulancia_id || !paramedArr.length) {
    toast('Completa todos los campos requeridos', 'error'); return;
  }

  const res = await fetch('/api/turnos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha, ambulancia_id, ambulancia_codigo, turno, paramedicos: paramedArr })
  });
  const data = await res.json();
  if (data.error) { toast(data.error, 'error'); return; }

  toast('Turno guardado correctamente');
  cerrarModal('modal-turno');
  cargarMalla();
}

async function eliminarTurno(id) {
  if (!confirm('¿Eliminar este turno?')) return;
  await fetch('/api/turnos/' + id, { method: 'DELETE' });
  toast('Turno eliminado');
  cargarMalla();
}

async function eliminarExtra(id) {
  if (!confirm('¿Eliminar este registro extra?')) return;
  await fetch('/api/extras/' + id, { method: 'DELETE' });
  toast('Extra eliminado');
  cargarMalla();
}

// ============================================================
// MODAL EXTRA
// ============================================================
function abrirModalExtra() {
  const modal = document.getElementById('modal-extra');
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('extra-fecha').value = hoy;
  document.getElementById('extra-horas').value = '';
  document.getElementById('extra-nota').value = '';

  const selPm = document.getElementById('extra-paramedico');
  selPm.innerHTML = '<option value="">-- Seleccionar --</option>';
  paramedicos.filter(p => p.activo !== false).forEach(p => {
    selPm.innerHTML += `<option value="${p._id}" data-nombre="${p.nombre}">${p.nombre}</option>`;
  });

  const selAmb = document.getElementById('extra-ambulancia');
  selAmb.innerHTML = '<option value="">-- Sin especificar --</option>';
  ambulancias.filter(a => a.activa !== false).forEach(a => {
    selAmb.innerHTML += `<option value="${a._id}" data-codigo="${a.codigo}">${a.codigo} - ${a.nombre}</option>`;
  });

  modal.classList.add('open');
}

async function guardarExtra() {
  const fecha = document.getElementById('extra-fecha').value;
  const pmSel = document.getElementById('extra-paramedico');
  const paramedico_id = pmSel.value;
  const paramedico_nombre = pmSel.selectedOptions[0]?.dataset.nombre || '';
  const horas = parseFloat(document.getElementById('extra-horas').value);
  const ambSel = document.getElementById('extra-ambulancia');
  const ambulancia_id = ambSel.value || null;
  const ambulancia_codigo = ambSel.selectedOptions[0]?.dataset.codigo || null;
  const nota = document.getElementById('extra-nota').value;

  if (!fecha || !paramedico_id || !horas) {
    toast('Fecha, paramédico y horas son requeridos', 'error'); return;
  }

  const res = await fetch('/api/extras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha, paramedico_id, paramedico_nombre, horas, ambulancia_id, ambulancia_codigo, nota })
  });
  const data = await res.json();
  if (data.error) { toast(data.error, 'error'); return; }

  toast('Horas extra registradas');
  cerrarModal('modal-extra');
  cargarMalla();
}

// ============================================================
// CONTROL DE HORAS
// ============================================================
async function cargarHoras() {
  const mes = document.getElementById('horas-mes').value;
  const anio = document.getElementById('horas-anio').value;
  const container = document.getElementById('horas-container');
  container.innerHTML = '<p style="color:#6b7280;padding:20px">Calculando horas...</p>';

  const reporte = await fetch(`/api/turnos/reporte/horas?mes=${mes}&anio=${anio}`).then(r => r.json());

  if (!reporte.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📊</div><p>No hay turnos registrados en ${MESES[mes-1]} ${anio}</p></div>`;
    return;
  }

  const limiteSemanal = parseInt(mes) >= 7 ? 42 : 44;
  const totalAlertas = reporte.reduce((s, r) => s + r.alertas.length, 0);
  const totalHoras = reporte.reduce((s, r) => s + r.total_mes, 0);
  const conAlerta = reporte.filter(r => r.alertas.length > 0).length;

  let html = `
    <div class="resumen-mes">
      <div class="resumen-stat"><div class="valor">${reporte.length}</div><div class="etiqueta">Paramédicos activos</div></div>
      <div class="resumen-stat"><div class="valor">${totalHoras}</div><div class="etiqueta">Horas totales mes</div></div>
      <div class="resumen-stat"><div class="valor" style="color:${conAlerta > 0 ? '#e02424' : '#057a55'}">${conAlerta}</div><div class="etiqueta">Con alertas de horas</div></div>
      <div class="resumen-stat"><div class="valor" style="color:#6b7280">${limiteSemanal}h</div><div class="etiqueta">Límite semanal</div></div>
    </div>
    <div class="horas-table-wrapper">
    <table class="horas-table">
      <thead><tr>
        <th>Paramédico</th>
        <th>Total Mes</th>
        <th>Detalle Semanal</th>
        <th>Estado</th>
      </tr></thead>
      <tbody>
  `;

  reporte.sort((a, b) => b.alertas.length - a.alertas.length || b.total_mes - a.total_mes).forEach(r => {
    const tieneAlerta = r.alertas.length > 0;
    const rowStyle = tieneAlerta ? 'background:#fff7ed' : '';

    const semanasHtml = Object.entries(r.semanas).map(([sem, data]) => {
      const esAlerta = data.horas > data.limite;
      const porcentaje = Math.round((data.horas / data.limite) * 100);
      return `<div class="semana-row">
        <span>Sem. ${formatFecha(sem)}</span>
        <span>
          <span style="color:${esAlerta ? '#e02424' : '#374151'};font-weight:${esAlerta ? '700' : '400'}">${data.horas}h</span>
          <span style="color:#9ca3af"> / ${data.limite}h</span>
          ${esAlerta ? `<span style="color:#e02424;font-size:11px"> ▲${data.horas - data.limite}h</span>` : ''}
        </span>
      </div>`;
    }).join('');

    const badgeClass = tieneAlerta ? 'badge-over' : (r.total_mes > 0 ? 'badge-ok' : 'badge-warn');
    const badgeText = tieneAlerta ? `⚠️ ${r.alertas.length} semana(s) excedida(s)` : (r.total_mes > 0 ? '✓ OK' : 'Sin turnos');

    html += `<tr style="${rowStyle}">
      <td style="font-weight:600">${r.nombre}</td>
      <td style="font-size:20px;font-weight:700;color:var(--primary)">${r.total_mes}h</td>
      <td><div class="semana-detail">${semanasHtml || '<span style="color:#9ca3af">—</span>'}</div></td>
      <td><span class="badge ${badgeClass}">${badgeText}</span></td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// ============================================================
// PARAMÉDICOS
// ============================================================
function abrirModalParamedico(pm = null) {
  document.getElementById('modal-paramedico-title').textContent = pm ? 'Editar Paramédico' : 'Nuevo Paramédico';
  document.getElementById('paramedico-id').value = pm?._id || '';
  document.getElementById('paramedico-nombre').value = pm?.nombre || '';
  document.getElementById('paramedico-codigo').value = pm?.codigo || '';
  document.getElementById('modal-paramedico').classList.add('open');
}

async function guardarParamedico() {
  const id = document.getElementById('paramedico-id').value;
  const nombre = document.getElementById('paramedico-nombre').value.trim();
  const codigo = document.getElementById('paramedico-codigo').value.trim();

  if (!nombre || !codigo) { toast('Nombre y código son requeridos', 'error'); return; }

  const url = id ? `/api/paramedicos/${id}` : '/api/paramedicos';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, codigo }) });
  const data = await res.json();
  if (data.error) { toast(data.error, 'error'); return; }

  toast(id ? 'Paramédico actualizado' : 'Paramédico creado');
  cerrarModal('modal-paramedico');
  await cargarDatos();
  renderParamedicos();
}

async function eliminarParamedico(id) {
  if (!confirm('¿Eliminar este paramédico?')) return;
  await fetch('/api/paramedicos/' + id, { method: 'DELETE' });
  toast('Paramédico eliminado');
  await cargarDatos();
  renderParamedicos();
}

function renderParamedicos() {
  const container = document.getElementById('paramedicos-container');
  if (!paramedicos.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">👨‍⚕️</div><p>No hay paramédicos registrados</p></div>`;
    return;
  }
  container.innerHTML = `<div class="cards-grid">${paramedicos.map(p => `
    <div class="card">
      <div class="card-header">
        <div class="card-title">👨‍⚕️ ${p.nombre}</div>
        <span class="card-code">${p.codigo}</span>
      </div>
      <div class="card-actions">
        <button class="btn-secondary" onclick="abrirModalParamedico(${JSON.stringify(p).replace(/"/g,'&quot;')})">Editar</button>
        <button class="btn-danger" onclick="eliminarParamedico('${p._id}')">Eliminar</button>
      </div>
    </div>`).join('')}</div>`;
}

// ============================================================
// AMBULANCIAS
// ============================================================
function abrirModalAmbulancia(amb = null) {
  document.getElementById('modal-ambulancia-title').textContent = amb ? 'Editar Ambulancia' : 'Nueva Ambulancia';
  document.getElementById('ambulancia-id').value = amb?._id || '';
  document.getElementById('ambulancia-nombre').value = amb?.nombre || '';
  document.getElementById('ambulancia-codigo').value = amb?.codigo || '';
  document.getElementById('modal-ambulancia').classList.add('open');
}

async function guardarAmbulancia() {
  const id = document.getElementById('ambulancia-id').value;
  const nombre = document.getElementById('ambulancia-nombre').value.trim();
  const codigo = document.getElementById('ambulancia-codigo').value.trim();

  if (!nombre || !codigo) { toast('Nombre y código son requeridos', 'error'); return; }

  const url = id ? `/api/ambulancias/${id}` : '/api/ambulancias';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, codigo }) });
  const data = await res.json();
  if (data.error) { toast(data.error, 'error'); return; }

  toast(id ? 'Ambulancia actualizada' : 'Ambulancia creada');
  cerrarModal('modal-ambulancia');
  await cargarDatos();
  renderAmbulanciasList();
}

async function eliminarAmbulancia(id) {
  if (!confirm('¿Eliminar esta ambulancia?')) return;
  await fetch('/api/ambulancias/' + id, { method: 'DELETE' });
  toast('Ambulancia eliminada');
  await cargarDatos();
  renderAmbulanciasList();
}

function renderAmbulanciasList() {
  const container = document.getElementById('ambulancias-container');
  if (!ambulancias.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">🚑</div><p>No hay ambulancias registradas</p></div>`;
    return;
  }
  container.innerHTML = `<div class="cards-grid">${ambulancias.map(a => `
    <div class="card">
      <div class="card-header">
        <div class="card-title">🚑 ${a.nombre}</div>
        <span class="card-code">${a.codigo}</span>
      </div>
      <div class="card-actions">
        <button class="btn-secondary" onclick="abrirModalAmbulancia(${JSON.stringify(a).replace(/"/g,'&quot;')})">Editar</button>
        <button class="btn-danger" onclick="eliminarAmbulancia('${a._id}')">Eliminar</button>
      </div>
    </div>`).join('')}</div>`;
}

// ============================================================
// IMPORTACIÓN MASIVA
// ============================================================
let _importarTipo = '';

function abrirModalImportar(tipo) {
  _importarTipo = tipo;
  const label = tipo === 'paramedicos' ? 'Paramédicos' : 'Ambulancias';
  document.getElementById('modal-importar-title').textContent = `📥 Importar ${label} desde Excel`;
  document.getElementById('importar-archivo').value = '';
  document.getElementById('importar-resultado').style.display = 'none';
  document.getElementById('importar-resultado').innerHTML = '';
  document.getElementById('btn-importar-confirm').disabled = false;
  document.getElementById('btn-importar-confirm').textContent = 'Importar';
  document.getElementById('modal-importar').classList.add('open');
}

async function ejecutarImportacion() {
  const fileInput = document.getElementById('importar-archivo');
  if (!fileInput.files.length) { toast('Seleccioná un archivo Excel primero', 'error'); return; }

  const btn = document.getElementById('btn-importar-confirm');
  btn.disabled = true;
  btn.textContent = 'Importando...';

  const formData = new FormData();
  formData.append('archivo', fileInput.files[0]);

  try {
    const res  = await fetch(`/api/importar/${_importarTipo}`, { method: 'POST', body: formData });
    const data = await res.json();

    const resDiv = document.getElementById('importar-resultado');
    resDiv.style.display = 'block';

    if (data.error) {
      resDiv.innerHTML = `<div style="background:#FDECEA;border:1px solid #EF9A9A;border-radius:8px;padding:12px;color:#B71C1C;font-size:13px;">
        <strong>❌ Error:</strong> ${data.error}
      </div>`;
      btn.disabled = false;
      btn.textContent = 'Importar';
      return;
    }

    const hayErrores = data.errores && data.errores.length > 0;
    resDiv.innerHTML = `
      <div style="background:#E8F5E9;border:1px solid #A5D6B5;border-radius:8px;padding:12px;font-size:13px;">
        <div style="font-weight:700;color:#1B5E37;margin-bottom:6px;">✅ Importación completada</div>
        <div>✔ Insertados: <strong>${data.insertados}</strong></div>
        <div>⊘ Omitidos (duplicados o vacíos): <strong>${data.omitidos}</strong></div>
        ${hayErrores ? `<div style="margin-top:8px;font-size:12px;color:#666;">
          <strong>Detalle de omitidos:</strong><br>
          ${data.errores.slice(0,10).map(e => `• ${e}`).join('<br>')}
          ${data.errores.length > 10 ? `<br>... y ${data.errores.length - 10} más` : ''}
        </div>` : ''}
      </div>`;

    btn.textContent = 'Cerrar';
    btn.disabled = false;
    btn.onclick = () => {
      cerrarModal('modal-importar');
      btn.onclick = ejecutarImportacion;
    };

    await cargarDatos();
    if (_importarTipo === 'paramedicos') renderParamedicos();
    else renderAmbulanciasList();

    toast(`${data.insertados} registros importados correctamente`);

  } catch(e) {
    document.getElementById('importar-resultado').innerHTML =
      `<div style="background:#FDECEA;border:1px solid #EF9A9A;border-radius:8px;padding:12px;color:#B71C1C;font-size:13px;">
        <strong>❌ Error de conexión:</strong> ${e.message}
      </div>`;
    btn.disabled = false;
    btn.textContent = 'Importar';
  }
}

// ══════════════════════════════════════════════════════════════
// BACKUP
// ══════════════════════════════════════════════════════════════

function backupKey() {
  return document.getElementById('backup-key')?.value?.trim() || '';
}

async function verificarBackupKey() {
  const key = backupKey();
  if (!key) return;
  const status = document.getElementById('backup-key-status');
  status.textContent = 'Verificando…';

  try {
    const res = await fetch('/api/backup/info', { headers: { 'x-backup-key': key } });
    const data = await res.json();

    if (!res.ok) {
      status.innerHTML = `<span style="color:#b71c1c;">❌ ${data.error}</span>`;
      document.getElementById('backup-info-card').style.display = 'none';
      document.getElementById('backup-actions').style.display = 'none';
      return;
    }

    status.innerHTML = `<span style="color:var(--verde);">✅ Clave correcta</span>`;

    // Mostrar info de la BD
    const r = data.registros;
    document.getElementById('backup-info-content').innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:5px 0;color:var(--text-muted);">Archivo</td><td><strong>${data.archivo}</strong></td></tr>
        <tr><td style="padding:5px 0;color:var(--text-muted);">Tamaño</td><td><strong>${data.tamaño_kb}</strong></td></tr>
        <tr><td style="padding:5px 0;color:var(--text-muted);">Última modificación</td><td><strong>${new Date(data.ultima_modificacion).toLocaleString('es-AR')}</strong></td></tr>
        <tr><td style="padding:5px 0;color:var(--text-muted);" colspan="2"><hr style="border:none;border-top:1px solid var(--border);margin:6px 0;"></td></tr>
        <tr><td style="padding:5px 0;color:var(--text-muted);">Paramédicos</td><td><strong>${r.paramedicos}</strong></td></tr>
        <tr><td style="padding:5px 0;color:var(--text-muted);">Ambulancias</td><td><strong>${r.ambulancias}</strong></td></tr>
        <tr><td style="padding:5px 0;color:var(--text-muted);">Turnos</td><td><strong>${r.turnos}</strong></td></tr>
        <tr><td style="padding:5px 0;color:var(--text-muted);">Horas extra</td><td><strong>${r.extras}</strong></td></tr>
      </table>`;
    document.getElementById('backup-info-card').style.display = 'block';
    document.getElementById('backup-actions').style.display = 'flex';
  } catch(e) {
    status.innerHTML = `<span style="color:#b71c1c;">❌ Error de conexión: ${e.message}</span>`;
  }
}

function descargarBackup() {
  const key = backupKey();
  // Abrir en nueva pestaña con la clave como query param para descarga directa
  const fecha = new Date().toISOString().slice(0,10);
  const url = `/api/backup/descargar?key=${encodeURIComponent(key)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `campbell_backup_${fecha}.db`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('Descarga iniciada');
}

async function enviarBackupEmail() {
  const key    = backupKey();
  const status = document.getElementById('email-status');
  status.innerHTML = '<span style="color:var(--text-muted);">Enviando…</span>';

  try {
    const res  = await fetch('/api/backup/enviar-email', { method: 'POST', headers: { 'x-backup-key': key } });
    const data = await res.json();

    if (!res.ok) {
      status.innerHTML = `<span style="color:#b71c1c;">❌ ${data.error}</span>`;
      return;
    }
    status.innerHTML = `<span style="color:var(--verde);">✅ ${data.mensaje}</span>`;
  } catch (e) {
    status.innerHTML = `<span style="color:#b71c1c;">❌ Error: ${e.message}</span>`;
  }
}
  const archivo = document.getElementById('backup-archivo').files[0];
  if (!archivo) { toast('Seleccioná un archivo .db primero'); return; }

  const confirmado = confirm(
    '⚠️ ATENCIÓN\n\nEsto reemplazará TODOS los datos actuales con el backup seleccionado.\n\n¿Estás seguro/a?'
  );
  if (!confirmado) return;

  const key = backupKey();
  const form = new FormData();
  form.append('archivo', archivo);

  try {
    const res  = await fetch('/api/backup/restaurar', { method: 'POST', headers: { 'x-backup-key': key }, body: form });
    const data = await res.json();

    if (!res.ok) {
      alert('❌ Error al restaurar:\n' + data.error);
      return;
    }

    toast('✅ Base de datos restaurada. Recargando…');
    setTimeout(() => location.reload(), 2000);
  } catch(e) {
    alert('Error de conexión: ' + e.message);
  }
}
