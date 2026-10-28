const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// Detrás del proxy de Railway: así req.ip es la IP real de quien consulta (para bloquear intentos de clave repetidos)
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/paramedicos', require('./routes/paramedicos'));
app.use('/api/ambulancias', require('./routes/ambulancias'));
app.use('/api/empresas',    require('./routes/empresas'));
app.use('/api/turnos',      require('./routes/turnos'));
app.use('/api/extras',      require('./routes/extras'));
app.use('/api/exportar',    require('./routes/exportar'));
app.use('/api/pdf',         require('./routes/pdf'));
app.use('/api/importar',    require('./routes/importar'));
app.use('/api/backup',      require('./routes/backup'));
app.use('/api/externo',     require('./routes/externo'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sistema de Turnos - Fundación Campbell`);
  console.log(`Corriendo en puerto ${PORT}`);
});
