/**
 * Casino QR – servidor multicliente con licencias (Google Apps Script).
 *
 * Este script va pegado en TU planilla "Licencias Casino QR" (Extensiones → Apps Script).
 * Cada fila de la hoja "Licencias" es un cliente. Los datos de cada cliente quedan en su
 * propia planilla, que se crea sola en tu Drive la primera vez que se usa.
 *
 * Hoja "Licencias" (una fila por cliente):
 *   Codigo | Cliente | Estado | Vence | PIN | HoraTope | Areas | RazonSocial | NIT |
 *   Direccion | Ciudad | CorreoDatos | Telefono | HojaDatos | Notas
 *
 * Planilla de cada cliente, hoja "Registros":
 *   A ID | B Fecha | C HoraIngreso | D Nombre | E Area | F Firma (link Drive) | G Almorzo | H HoraAlmuerzo
 *   I AreaVisita | J Cedula | K Autorizacion
 *
 * Zona horaria: America/Bogota (ver appsscript.json).
 */

// ---- Ajusta esto ----
const CONTACTO_PROVEEDOR = 'tu-correo@ejemplo.com · WhatsApp 300 000 0000';
const URL_APP = 'https://joalmendoza.github.io/casino-qr/';   // cámbiala si publicas en Cloudflare Pages
const AVISO_DIAS = 5;      // días antes del vencimiento en que empieza el aviso
const GRACIA_DIAS = 3;     // días después del vencimiento en que todavía funciona (con aviso)

const HORA_TOPE_DEFECTO = '09:30';
const AREAS_DEFECTO = 'Producción, Mantenimiento, Control calidad, Logística, Seguridad, HSE, Gestión Humana, Contabilidad, Visitante';
const HOJA_LIC = 'Licencias';
const HOJA_REG = 'Registros';
const CARPETA_RAIZ = 'Casino QR - Clientes';
const COLS = ['Codigo', 'Cliente', 'Estado', 'Vence', 'PIN', 'HoraTope', 'Areas', 'RazonSocial', 'NIT',
  'Direccion', 'Ciudad', 'CorreoDatos', 'Telefono', 'HojaDatos', 'Notas'];

// ================= Entrada web =================

function doPost(e) {
  let datos;
  try {
    datos = JSON.parse(e.postData.contents);
  } catch (err) {
    return responder({ ok: false, error: 'Solicitud inválida' });
  }

  const acciones = { config, registrar, validar, resumen, guardarTope };
  const fn = acciones[datos.accion];
  if (!fn) return responder({ ok: false, error: 'Acción desconocida' });

  // Evita que dos lecturas simultáneas del mismo QR pasen las dos
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const lic = buscarLicencia(datos.cliente);
    if (!lic) return responder({ ok: false, error: 'Código de cliente no válido. Revisa el link que te entregaron.' });
    const estado = estadoLicencia(lic);
    const r = fn(datos, lic, estado);
    r.licencia = estado;
    return responder(r);
  } catch (err) {
    return responder({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return responder({ ok: true, msg: 'Casino QR activo' });
}

// ================= Acciones =================

function config(datos, lic) {
  const ahora = horaAhora();
  const tope = lic.HoraTope || HORA_TOPE_DEFECTO;
  return {
    ok: true,
    cliente: lic.Cliente,
    horaTope: tope,
    horaServidor: ahora,
    abierto: ahora <= tope,
    areas: String(lic.Areas || AREAS_DEFECTO).split(',').map(a => a.trim()).filter(String),
    empresa: {
      EMPRESA: lic.RazonSocial || lic.Cliente, NIT: lic.NIT, DIRECCION: lic.Direccion,
      CIUDAD: lic.Ciudad, CORREO_DATOS: lic.CorreoDatos, TELEFONO: lic.Telefono
    }
  };
}

function registrar({ nombre, cedula, area, visita, firma, autoriza, version }, lic, estado) {
  if (estado.bloqueado) return { ok: false, suspendido: true, error: estado.mensaje };

  nombre = String(nombre || '').trim();
  cedula = String(cedula || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  area = String(area || '').trim();
  visita = String(visita || '').trim();
  if (autoriza !== true) return { ok: false, error: 'Falta la autorización de tratamiento de datos' };
  if (nombre.length < 3 || !area) return { ok: false, error: 'Faltan datos' };
  if (cedula.length < 5) return { ok: false, error: 'Falta la cédula' };
  if (area === 'Visitante' && !visita) return { ok: false, error: 'Falta el área que visita' };
  if (!firma || firma.indexOf('data:image/png;base64,') !== 0) return { ok: false, error: 'Falta la firma' };

  const hoja = hojaRegistros(lic);
  const fecha = hoy();

  // Una cédula = un registro por día: si ya está, devolvemos su mismo QR
  const filas = hoja.getDataRange().getDisplayValues();
  for (let i = 1; i < filas.length; i++) {
    if (filas[i][1] === fecha && filas[i][9] === cedula) {
      return { ok: true, repetido: true, id: filas[i][0], fecha, hora: filas[i][2], nombre: filas[i][3], cedula, area: filas[i][4], visita: filas[i][8] };
    }
  }

  // Pasada la hora tope ya no se aceptan registros nuevos
  const hora = horaAhora();
  const tope = lic.HoraTope || HORA_TOPE_DEFECTO;
  if (hora > tope) return { ok: false, cerrado: true, error: 'El registro de hoy cerró a las ' + hora12(tope) };

  const id = 'C' + fecha.replace(/-/g, '').slice(2) + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
  const linkFirma = guardarFirma(lic, id, nombre, firma);
  const autorizacion = 'SI ' + String(version || '').slice(0, 30) + ' ' + fecha + ' ' + hora;

  hoja.appendRow([id, fecha, hora, nombre, area, linkFirma, 'NO', '', visita, cedula, autorizacion]);
  return { ok: true, id, fecha, hora, nombre, cedula, area, visita };
}

function validar({ id, pin }, lic, estado) {
  if (pin !== String(lic.PIN)) return { ok: false, error: 'PIN incorrecto' };
  if (estado.bloqueado) return { ok: false, suspendido: true, error: estado.mensaje };
  id = String(id || '').trim().toUpperCase();

  const hoja = hojaRegistros(lic);
  const filas = hoja.getDataRange().getDisplayValues();
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    if (f[0] !== id) continue;

    if (f[1] !== hoy()) return { ok: false, error: 'QR de otro día (' + f[1] + ')', nombre: f[3] };
    if (f[6] === 'SI') return { ok: false, error: 'Ya almorzó a las ' + f[7], nombre: f[3], doc: cedulaOculta(f[9]), area: f[4], visita: f[8] };

    const horaAlm = horaAhora();
    hoja.getRange(i + 1, 7, 1, 2).setValues([['SI', horaAlm]]);
    return { ok: true, nombre: f[3], doc: cedulaOculta(f[9]), area: f[4], visita: f[8], horaIngreso: f[2], horaAlmuerzo: horaAlm };
  }
  return { ok: false, error: 'QR no registrado' };
}

// El reporte sigue funcionando aunque la licencia esté suspendida, para que el cliente pueda sacar sus datos
function resumen({ pin }, lic) {
  if (pin !== String(lic.PIN)) return { ok: false, error: 'PIN incorrecto' };
  const fecha = hoy();
  const filas = hojaRegistros(lic).getDataRange().getDisplayValues().slice(1)
    .filter(f => f[1] === fecha)
    .map(f => ({ id: f[0], fecha: f[1], hora: f[2], nombre: f[3], area: f[4], almorzo: f[6] === 'SI', horaAlmuerzo: f[7], visita: f[8] || '', cedula: f[9] || '' }));
  return { ok: true, fecha, filas };
}

function guardarTope({ pin, horaTope }, lic) {
  if (pin !== String(lic.PIN)) return { ok: false, error: 'PIN incorrecto' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horaTope || '')) return { ok: false, error: 'Hora inválida' };
  escribirLicencia(lic, 'HoraTope', horaTope);
  return { ok: true, horaTope };
}

// ================= Licencias =================

function hojaLicencias() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(HOJA_LIC);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_LIC, 0);
    hoja.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
    hoja.setFrozenRows(1);
    hoja.getRange('A:A').setNumberFormat('@');
    hoja.getRange('D:D').setNumberFormat('dd/mm/yyyy');
    hoja.getRange('E:F').setNumberFormat('@');
    const estados = SpreadsheetApp.newDataValidation().requireValueInList(['Activo', 'Suspendido'], true).build();
    hoja.getRange('C2:C1000').setDataValidation(estados);
  }
  return hoja;
}

function buscarLicencia(codigo) {
  codigo = String(codigo || '').trim().toUpperCase();
  if (!codigo) return null;
  const hoja = hojaLicencias();
  const valores = hoja.getDataRange().getValues();
  const cab = valores[0].map(String);
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][0]).trim().toUpperCase() !== codigo) continue;
    const lic = { _fila: i + 1, _cab: cab };
    cab.forEach((c, j) => lic[c] = valores[i][j]);
    lic.HoraTope = textoHora(lic.HoraTope);
    return lic;
  }
  return null;
}

function escribirLicencia(lic, columna, valor) {
  const j = lic._cab.indexOf(columna);
  if (j < 0) throw new Error('Falta la columna ' + columna + ' en la hoja Licencias');
  hojaLicencias().getRange(lic._fila, j + 1).setValue(valor);
}

function estadoLicencia(lic) {
  const suspendido = { estado: 'suspendido', bloqueado: true, mensaje: 'Servicio suspendido. Contacta al proveedor: ' + CONTACTO_PROVEEDOR };
  if (String(lic.Estado).trim().toLowerCase() === 'suspendido') return suspendido;

  const vence = leerFecha(lic.Vence);
  if (!vence) return { estado: 'activo', bloqueado: false };

  const venceTxt = Utilities.formatDate(vence, zona(), 'yyyy-MM-dd');
  const dias = Math.round((new Date(venceTxt + 'T00:00:00') - new Date(hoy() + 'T00:00:00')) / 86400000);
  const venceLindo = Utilities.formatDate(vence, zona(), 'dd/MM/yyyy');

  if (dias > AVISO_DIAS) return { estado: 'activo', bloqueado: false, vence: venceTxt, dias };
  if (dias >= 0) return { estado: 'por_vencer', bloqueado: false, vence: venceTxt, dias,
    mensaje: 'Tu suscripción vence el ' + venceLindo + (dias === 0 ? ' (hoy)' : ' (en ' + dias + ' día' + (dias === 1 ? '' : 's') + ')') + '. Renueva para no perder el servicio.' };
  if (-dias <= GRACIA_DIAS) return { estado: 'gracia', bloqueado: false, vence: venceTxt, dias,
    mensaje: 'Tu suscripción venció el ' + venceLindo + '. El servicio se suspenderá en ' + (GRACIA_DIAS + dias + 1) + ' día(s) si no se registra el pago. Contacto: ' + CONTACTO_PROVEEDOR };
  return Object.assign(suspendido, { vence: venceTxt, dias });
}

// ================= Datos de cada cliente =================

function hojaRegistros(lic) {
  let ss = null;
  if (lic.HojaDatos) {
    try { ss = SpreadsheetApp.openById(String(lic.HojaDatos)); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('Casino QR - ' + lic.Cliente + ' (' + lic.Codigo + ')');
    DriveApp.getFileById(ss.getId()).moveTo(carpetaRaiz());
    escribirLicencia(lic, 'HojaDatos', ss.getId());
    lic.HojaDatos = ss.getId();
  }
  let hoja = ss.getSheetByName(HOJA_REG);
  if (!hoja) {
    hoja = ss.getSheets()[0];
    hoja.setName(HOJA_REG);
    hoja.getRange(1, 1, 1, 11).setValues([['ID', 'Fecha', 'HoraIngreso', 'Nombre', 'Area', 'Firma', 'Almorzo', 'HoraAlmuerzo', 'AreaVisita', 'Cedula', 'Autorizacion']]);
    hoja.setFrozenRows(1);
    // Fechas, horas y cédula como texto para que Sheets no las transforme
    hoja.getRange('B:C').setNumberFormat('@');
    hoja.getRange('H:H').setNumberFormat('@');
    hoja.getRange('J:J').setNumberFormat('@');
  }
  return hoja;
}

function carpetaRaiz() {
  return carpetaGuardada('CARPETA_RAIZ', () => DriveApp.createFolder(CARPETA_RAIZ));
}

function guardarFirma(lic, id, nombre, dataUrl) {
  const carpeta = carpetaGuardada('FIRMAS_' + lic.Codigo, () => carpetaRaiz().createFolder('Firmas - ' + lic.Cliente + ' (' + lic.Codigo + ')'));
  const bytes = Utilities.base64Decode(dataUrl.split(',')[1]);
  return carpeta.createFile(Utilities.newBlob(bytes, 'image/png', id + '_' + nombre + '.png')).getUrl();
}

function carpetaGuardada(clave, crear) {
  const props = PropertiesService.getScriptProperties();
  const idGuardado = props.getProperty(clave);
  if (idGuardado) {
    try { return DriveApp.getFolderById(idGuardado); } catch (e) { /* la borraron, se crea de nuevo */ }
  }
  const carpeta = crear();
  props.setProperty(clave, carpeta.getId());
  return carpeta;
}

// ================= Menú para ti (dueño) =================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Casino QR')
    .addItem('Renovar 1 mes (fila seleccionada)', 'menuRenovar')
    .addItem('Suspender (fila seleccionada)', 'menuSuspender')
    .addItem('Activar (fila seleccionada)', 'menuActivar')
    .addSeparator()
    .addItem('Ver links del cliente (fila seleccionada)', 'menuLinks')
    .addToUi();
}

function filaSeleccionada() {
  const hoja = hojaLicencias();
  const fila = hoja.getActiveCell().getRow();
  if (SpreadsheetApp.getActiveSheet().getName() !== HOJA_LIC || fila < 2) {
    SpreadsheetApp.getUi().alert('Selecciona una celda en la fila del cliente, en la hoja Licencias.');
    return null;
  }
  return buscarLicencia(hoja.getRange(fila, 1).getValue());
}

function menuRenovar() {
  const lic = filaSeleccionada();
  if (!lic) return;
  // Renueva desde la fecha de vencimiento si todavía no ha pasado; si ya pasó, desde hoy
  const actual = leerFecha(lic.Vence);
  const base = actual && actual > new Date() ? actual : new Date();
  const nueva = new Date(base.getFullYear(), base.getMonth() + 1, base.getDate());
  escribirLicencia(lic, 'Vence', nueva);
  escribirLicencia(lic, 'Estado', 'Activo');
  SpreadsheetApp.getUi().alert(lic.Cliente + ' renovado hasta el ' + Utilities.formatDate(nueva, zona(), 'dd/MM/yyyy'));
}

function menuSuspender() {
  const lic = filaSeleccionada();
  if (lic) escribirLicencia(lic, 'Estado', 'Suspendido');
}

function menuActivar() {
  const lic = filaSeleccionada();
  if (lic) escribirLicencia(lic, 'Estado', 'Activo');
}

function menuLinks() {
  const lic = filaSeleccionada();
  if (!lic) return;
  const c = '?c=' + encodeURIComponent(lic.Codigo);
  SpreadsheetApp.getUi().alert(
    'Links de ' + lic.Cliente + '\n\n' +
    'Registro (para el QR de portería):\n' + URL_APP + 'registro.html' + c + '\n\n' +
    'Lector del casino:\n' + URL_APP + 'casino.html' + c + '\n\n' +
    'Reporte:\n' + URL_APP + 'reporte.html' + c + '\n\n' +
    'PIN: ' + lic.PIN);
}

// Ejecútalo una vez desde el editor para dar permisos y crear la hoja Licencias con un cliente de ejemplo
function instalar() {
  const hoja = hojaLicencias();
  if (hoja.getLastRow() < 2) {
    const vence = new Date();
    vence.setMonth(vence.getMonth() + 1);
    hoja.appendRow(['DEMO01', 'Cliente de prueba', 'Activo', vence, '1234', HORA_TOPE_DEFECTO, AREAS_DEFECTO,
      'EMPRESA DE PRUEBA S.A.S.', '900.000.000-0', 'Calle 1 # 2-3', 'Bogotá, Colombia',
      'datos@empresa.com', '(+57) 300 000 0000', '', 'Fila de ejemplo']);
  }
  Logger.log('Listo. Zona horaria: ' + zona());
}

// ================= Utilidades =================

function leerFecha(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const s = String(v || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);           // dd/mm/aaaa
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);                  // aaaa-mm-dd
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

function textoHora(v) {
  if (v instanceof Date) return Utilities.formatDate(v, zona(), 'HH:mm');
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? m[1].padStart(2, '0') + ':' + m[2] : '';
}

function cedulaOculta(c) {
  c = String(c || '');
  return c ? '•••' + c.slice(-4) : '';
}

function hora12(hhmm) {
  const p = String(hhmm).split(':').map(Number);
  return (p[0] % 12 || 12) + ':' + String(p[1]).padStart(2, '0') + (p[0] < 12 ? ' a. m.' : ' p. m.');
}

function horaAhora() {
  return Utilities.formatDate(new Date(), zona(), 'HH:mm');
}

function hoy() {
  return Utilities.formatDate(new Date(), zona(), 'yyyy-MM-dd');
}

function zona() {
  return Session.getScriptTimeZone();
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
