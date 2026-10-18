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

// Para mostrar en el casino sin exponer la cédula completa
function cedulaOculta(c) {
  c = String(c || '');
  return c ? '•••' + c.slice(-4) : '';
}

// '09:30' -> '9:30 a. m.'
function hora12(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (isNaN(h)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
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

  _tope() {
    try { return localStorage.getItem('casino_tope') || CONFIG.HORA_TOPE_DEFECTO; } catch { return CONFIG.HORA_TOPE_DEFECTO; }
  },

  config() {
    const tope = this._tope(), ahora = horaActual();
    return { ok: true, horaTope: tope, horaServidor: ahora, abierto: ahora <= tope };
  },

  guardarTope({ pin, horaTope }) {
    if (pin !== CONFIG.PIN_DEMO) return { ok: false, error: 'PIN incorrecto' };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horaTope || '')) return { ok: false, error: 'Hora inválida' };
    try { localStorage.setItem('casino_tope', horaTope); } catch {}
    return { ok: true, horaTope };
  },

  registrar({ nombre, cedula, area, visita, firma, autoriza, version }) {
    if (!autoriza) return { ok: false, error: 'Falta la autorización de tratamiento de datos' };
    const filas = this._leer();
    const fecha = hoyISO();
    // Una cédula = un registro por día, aunque escriba el nombre distinto
    const existente = filas.find(f => f.fecha === fecha && f.cedula === cedula);
    if (existente) {
      const { firma: _, ...sinFirma } = existente;
      return { ok: true, repetido: true, ...sinFirma };
    }
    // Pasada la hora tope ya no se aceptan registros nuevos
    if (horaActual() > this._tope()) return { ok: false, cerrado: true, error: 'El registro de hoy cerró a las ' + hora12(this._tope()) };

    const fila = {
      id: 'C' + fecha.replace(/-/g, '').slice(2) + '-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      fecha, hora: horaActual(), nombre: nombre.trim(), cedula, area, visita: visita || '', firma,
      almorzo: false, horaAlmuerzo: '',
      autorizacion: `SI ${version} ${fecha} ${horaActual()}`
    };
    filas.push(fila);
    this._guardar(filas);
    const { firma: _, ...sinFirma } = fila;
    return { ok: true, ...sinFirma };
  },

  validar({ id, pin }) {
    if (pin !== CONFIG.PIN_DEMO) return { ok: false, error: 'PIN incorrecto' };
    const filas = this._leer();
    const fila = filas.find(f => f.id === id);
    if (!fila) return { ok: false, error: 'QR no registrado' };
    if (fila.fecha !== hoyISO()) return { ok: false, error: 'QR de otro día (' + fila.fecha + ')', nombre: fila.nombre };
    if (fila.almorzo) return { ok: false, error: 'Ya almorzó a las ' + fila.horaAlmuerzo, nombre: fila.nombre, doc: cedulaOculta(fila.cedula), area: fila.area, visita: fila.visita };
    fila.almorzo = true;
    fila.horaAlmuerzo = horaActual();
    this._guardar(filas);
    return { ok: true, nombre: fila.nombre, doc: cedulaOculta(fila.cedula), area: fila.area, visita: fila.visita, horaIngreso: fila.hora, horaAlmuerzo: fila.horaAlmuerzo };
  },

  resumen({ pin }) {
    if (pin !== CONFIG.PIN_DEMO) return { ok: false, error: 'PIN incorrecto' };
    const filas = this._leer().filter(f => f.fecha === hoyISO())
      .map(({ firma, ...resto }) => resto);
    return { ok: true, fecha: hoyISO(), filas };
  }
};
