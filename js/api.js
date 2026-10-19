// Capa de conexión. Todas las pantallas llaman a api(accion, datos).
// Con API_URL configurada habla con Apps Script; sin ella usa localStorage (demo).

// Código del cliente: viene en el link (?c=ABC01) y queda recordado en el celular
const CLIENTE = (() => {
  const enLink = (new URLSearchParams(location.search).get('c') || '').trim().toUpperCase();
  try {
    if (enLink) localStorage.setItem('casino_cliente', enLink);
    return enLink || localStorage.getItem('casino_cliente') || '';
  } catch {
    return enLink;
  }
})();

async function api(accion, datos = {}) {
  if (CONFIG.API_URL) {
    // Sin headers a propósito: así el navegador manda text/plain y Apps Script no reclama por CORS.
    const resp = await fetch(CONFIG.API_URL, {
      method: 'POST',
      body: JSON.stringify({ accion, cliente: CLIENTE, ...datos })
    });
    return resp.json();
  }
  if (!demo[accion]) return { ok: false, error: 'Acción desconocida' };
  const lic = demo._licencia();
  if (lic.bloqueado && (accion === 'registrar' || accion === 'validar')) {
    return { ok: false, suspendido: true, error: lic.mensaje, licencia: lic };
  }
  return { ...demo[accion](datos), licencia: lic };
}

// Trae la configuración del cliente (áreas, datos de la empresa, hora tope y estado de la licencia)
async function cargarConfig() {
  const r = await api('config');
  if (r.ok) {
    if (r.areas && r.areas.length) CONFIG.AREAS = r.areas;
    if (r.empresa) {
      for (const [k, v] of Object.entries(r.empresa)) if (v) CONFIG[k] = v;
    }
  }
  return r;
}

// Muestra el aviso de la suscripción (por vencer, en gracia o suspendida) en el elemento indicado
function mostrarLicencia(lic, el) {
  if (!el) return;
  if (!lic || !lic.mensaje || lic.estado === 'activo') { el.classList.add('hidden'); return; }
  el.textContent = lic.mensaje;
  el.className = 'aviso-lic ' + (lic.bloqueado ? 'lic-mal' : 'lic-aviso');
}

// Agrega el código de cliente a un link interno
function conCliente(url) {
  return CLIENTE ? url + (url.includes('?') ? '&' : '?') + 'c=' + encodeURIComponent(CLIENTE) : url;
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

// Lunes de la semana de una fecha 'aaaa-mm-dd'
function lunesDe(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  const dia = new Date(y, m - 1, d).getDay();
  return sumarDias(fecha, dia === 0 ? -6 : 1 - dia);
}

function sumarDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// Mismo primer nombre y al menos 2 palabras en común, sin tildes ni mayúsculas (igual que el servidor)
function mismoNombre(a, b) {
  const t = x => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/).filter(Boolean);
  const x = t(a), y = t(b);
  if (!x.length || !y.length || x[0] !== y[0]) return false;
  return y.filter(p => x.includes(p)).length >= Math.min(2, x.length, y.length);
}

function horaActual() {
  return new Date().toTimeString().slice(0, 5);
}

// ---------- Modo demo (solo este navegador) ----------
const demo = {
  // En demo se puede ver cómo se comporta la app según la licencia usando estos códigos en el link:
  // ?c=DEMO-VENCE (por vencer) · ?c=DEMO-GRACIA (vencida, en gracia) · ?c=DEMO-SUSPENDIDO (bloqueada)
  _licencia() {
    const contacto = 'Contacta al proveedor del servicio.';
    if (CLIENTE === 'DEMO-SUSPENDIDO') return { estado: 'suspendido', bloqueado: true, mensaje: 'Servicio suspendido. ' + contacto };
    if (CLIENTE === 'DEMO-GRACIA') return { estado: 'gracia', bloqueado: false, mensaje: 'Tu suscripción venció. El servicio se suspenderá en 2 día(s) si no se registra el pago. ' + contacto };
    if (CLIENTE === 'DEMO-VENCE') return { estado: 'por_vencer', bloqueado: false, mensaje: 'Tu suscripción vence en 3 días. Renueva para no perder el servicio.' };
    return { estado: 'activo', bloqueado: false };
  },

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
    return { ok: true, cliente: 'Demo', horaTope: tope, horaServidor: ahora, abierto: ahora <= tope, areas: CONFIG.AREAS };
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
      if (!mismoNombre(existente.nombre, nombre)) {
        return { ok: false, error: 'Esta cédula ya tiene un registro hoy. Si eres tú, escribe tu nombre como la primera vez o acércate a portería.' };
      }
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

  _diario() {
    let hora = '15:00', activo = true;
    try {
      hora = localStorage.getItem('casino_hora_reporte') || hora;
      activo = localStorage.getItem('casino_diario_activo') !== 'NO';
    } catch {}
    return { hora, activo };
  },

  guardarHoraReporte({ pin, hora, activo }) {
    if (pin !== CONFIG.PIN_DEMO) return { ok: false, error: 'PIN incorrecto' };
    if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { ok: false, error: 'Hora inválida' };
    try {
      if (hora) localStorage.setItem('casino_hora_reporte', hora);
      if (typeof activo === 'boolean') localStorage.setItem('casino_diario_activo', activo ? 'SI' : 'NO');
    } catch {}
    const d = this._diario();
    return { ok: true, horaReporte: d.hora, diarioActivo: d.activo };
  },

  resumenMeses({ pin }) {
    if (pin !== CONFIG.PIN_DEMO) return { ok: false, error: 'PIN incorrecto' };
    const d = new Date();
    const meses = [0, 1, 2].map(k => {
      const x = new Date(d.getFullYear(), d.getMonth() - k, 1);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
    });
    const filas = this._leer();
    return { ok: true, meses: meses.map(m => {
      const del = filas.filter(f => f.fecha.slice(0, 7) === m);
      return { mes: m, registros: del.length, almuerzos: del.filter(f => f.almorzo).length };
    }) };
  },

  resumenMes({ pin, mes }) {
    if (pin !== CONFIG.PIN_DEMO) return { ok: false, error: 'PIN incorrecto' };
    const filas = this._leer().filter(f => f.fecha.slice(0, 7) === mes).map(({ firma, ...resto }) => resto);
    return { ok: true, mes, filas };
  },

  generarDiario({ pin }) {
    if (pin !== CONFIG.PIN_DEMO) return { ok: false, error: 'PIN incorrecto' };
    return { ok: true, mensaje: 'En modo demo no hay servidor para guardar y enviar el Excel. Usa "Descargar el de hoy aquí".' };
  },

  resumenSemana({ pin, semana }) {
    if (pin !== CONFIG.PIN_DEMO) return { ok: false, error: 'PIN incorrecto' };
    let lunes = lunesDe(hoyISO());
    if (semana === 'anterior') lunes = sumarDias(lunes, -7);
    const domingo = sumarDias(lunes, 6);
    const filas = this._leer().filter(f => f.fecha >= lunes && f.fecha <= domingo)
      .map(({ firma, ...resto }) => resto);
    return { ok: true, desde: lunes, hasta: domingo, filas };
  },

  resumen({ pin }) {
    if (pin !== CONFIG.PIN_DEMO) return { ok: false, error: 'PIN incorrecto' };
    const filas = this._leer().filter(f => f.fecha === hoyISO())
      .map(({ firma, ...resto }) => resto);
    const d = this._diario(), tope = this._tope();
    return { ok: true, fecha: hoyISO(), filas, horaReporte: d.hora, diarioActivo: d.activo, correosReporte: [],
      horaTope: tope, abierto: horaActual() <= tope };
  }
};
