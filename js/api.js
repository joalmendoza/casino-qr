// Capa de conexión. Todas las pantallas llaman a api(accion, datos).
// Con API_URL configurada habla con Apps Script; sin ella usa localStorage (demo).

async function api(accion, datos = {}) {
  if (CONFIG.API_URL) {
    // Sin headers a propósito: así el navegador manda text/plain y Apps Script no reclama por CORS.
    const resp = await fetch(CONFIG.API_URL, {
      method: 'POST',
      body: JSON.stringify({ accion, ...datos })
    });
    return resp.json();
  }
  return demo[accion] ? demo[accion](datos) : { ok: false, error: 'Acción desconocida' };
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function horaActual() {
  return new Date().toTimeString().slice(0, 5);
}

// ---------- Modo demo (solo este navegador) ----------
const demo = {
  _leer() {
    try { return JSON.parse(localStorage.getItem('casino_demo') || '[]'); } catch { return []; }
  },
  _guardar(filas) {
    try { localStorage.setItem('casino_demo', JSON.stringify(filas)); } catch {}
  },

  registrar({ nombre, area, visita, firma }) {
    const filas = this._leer();
    const fecha = hoyISO();
    const existente = filas.find(f => f.fecha === fecha && f.nombre.toLowerCase() === nombre.trim().toLowerCase());
    if (existente) return { ok: true, repetido: true, ...existente };

    const fila = {
      id: 'C' + fecha.replace(/-/g, '').slice(2) + '-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      fecha, hora: horaActual(), nombre: nombre.trim(), area, visita: visita || '', firma,
      almorzo: false, horaAlmuerzo: ''
    };
    filas.push(fila);
    this._guardar(filas);
    return { ok: true, ...fila };
  },

  validar({ id, pin }) {
    if (pin !== CONFIG.PIN_DEMO) return { ok: false, error: 'PIN incorrecto' };
    const filas = this._leer();
    const fila = filas.find(f => f.id === id);
    if (!fila) return { ok: false, error: 'QR no registrado' };
    if (fila.fecha !== hoyISO()) return { ok: false, error: 'QR de otro día (' + fila.fecha + ')', nombre: fila.nombre };
    if (fila.almorzo) return { ok: false, error: 'Ya almorzó a las ' + fila.horaAlmuerzo, nombre: fila.nombre, area: fila.area, visita: fila.visita };
    fila.almorzo = true;
    fila.horaAlmuerzo = horaActual();
    this._guardar(filas);
    return { ok: true, nombre: fila.nombre, area: fila.area, visita: fila.visita, horaIngreso: fila.hora, horaAlmuerzo: fila.horaAlmuerzo };
  },

  resumen({ pin }) {
    if (pin !== CONFIG.PIN_DEMO) return { ok: false, error: 'PIN incorrecto' };
    const filas = this._leer().filter(f => f.fecha === hoyISO())
      .map(({ firma, ...resto }) => resto);
    return { ok: true, fecha: hoyISO(), filas };
  }
};
