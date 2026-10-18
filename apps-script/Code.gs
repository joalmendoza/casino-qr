/**
 * Backend gratuito del Casino QR (Google Apps Script + Google Sheets + Drive).
 *
 * Hoja "Registros":
 *   A ID | B Fecha | C HoraIngreso | D Nombre | E Area | F Firma (link Drive) | G Almorzo | H HoraAlmuerzo | I AreaVisita
 *
 * Instalación: ver README.md (sección "Paso a paso").
 */

const PIN_CASINO = '1234';          // cámbialo antes de publicar
const HOJA = 'Registros';
const CARPETA_FIRMAS = 'Firmas Casino QR';

function doPost(e) {
  let datos;
  try {
    datos = JSON.parse(e.postData.contents);
  } catch (err) {
    return responder({ ok: false, error: 'Solicitud inválida' });
  }

  const acciones = { registrar, validar, resumen };
  const fn = acciones[datos.accion];
  if (!fn) return responder({ ok: false, error: 'Acción desconocida' });

  // Evita que dos lecturas simultáneas del mismo QR pasen las dos
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return responder(fn(datos));
  } catch (err) {
    return responder({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return responder({ ok: true, msg: 'Casino QR activo' });
}

// ---------------- Acciones ----------------

function registrar({ nombre, area, visita, firma }) {
  nombre = String(nombre || '').trim();
  area = String(area || '').trim();
  visita = String(visita || '').trim();
  if (nombre.length < 3 || !area) return { ok: false, error: 'Faltan datos' };
  if (area === 'Visitante' && !visita) return { ok: false, error: 'Falta el área que visita' };
  if (!firma || firma.indexOf('data:image/png;base64,') !== 0) return { ok: false, error: 'Falta la firma' };

  const hoja = obtenerHoja();
  const fecha = hoy();

  // Si ya se registró hoy con el mismo nombre, devolvemos su mismo QR
  const filas = hoja.getDataRange().getDisplayValues();
  for (let i = 1; i < filas.length; i++) {
    if (filas[i][1] === fecha && filas[i][3].toLowerCase() === nombre.toLowerCase()) {
      return { ok: true, repetido: true, id: filas[i][0], fecha, hora: filas[i][2], nombre: filas[i][3], area: filas[i][4], visita: filas[i][8] };
    }
  }

  const id = 'C' + fecha.replace(/-/g, '').slice(2) + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
  const hora = Utilities.formatDate(new Date(), zona(), 'HH:mm');
  const linkFirma = guardarFirma(id, nombre, firma);

  hoja.appendRow([id, fecha, hora, nombre, area, linkFirma, 'NO', '', visita]);
  return { ok: true, id, fecha, hora, nombre, area, visita };
}

function validar({ id, pin }) {
  if (pin !== PIN_CASINO) return { ok: false, error: 'PIN incorrecto' };
  id = String(id || '').trim().toUpperCase();

  const hoja = obtenerHoja();
  const filas = hoja.getDataRange().getDisplayValues();
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    if (f[0] !== id) continue;

    if (f[1] !== hoy()) return { ok: false, error: 'QR de otro día (' + f[1] + ')', nombre: f[3] };
    if (f[6] === 'SI') return { ok: false, error: 'Ya almorzó a las ' + f[7], nombre: f[3], area: f[4], visita: f[8] };

    const horaAlm = Utilities.formatDate(new Date(), zona(), 'HH:mm');
    hoja.getRange(i + 1, 7, 1, 2).setValues([['SI', horaAlm]]);
    return { ok: true, nombre: f[3], area: f[4], visita: f[8], horaIngreso: f[2], horaAlmuerzo: horaAlm };
  }
  return { ok: false, error: 'QR no registrado' };
}

function resumen({ pin }) {
  if (pin !== PIN_CASINO) return { ok: false, error: 'PIN incorrecto' };
  const fecha = hoy();
  const filas = obtenerHoja().getDataRange().getDisplayValues().slice(1)
    .filter(f => f[1] === fecha)
    .map(f => ({ id: f[0], fecha: f[1], hora: f[2], nombre: f[3], area: f[4], almorzo: f[6] === 'SI', horaAlmuerzo: f[7], visita: f[8] || '' }));
  return { ok: true, fecha, filas };
}

// ---------------- Utilidades ----------------

function obtenerHoja() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(HOJA);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA);
    hoja.appendRow(['ID', 'Fecha', 'HoraIngreso', 'Nombre', 'Area', 'Firma', 'Almorzo', 'HoraAlmuerzo', 'AreaVisita']);
    hoja.setFrozenRows(1);
    // Fecha y horas como texto, así Sheets no las transforma
    hoja.getRange('B:C').setNumberFormat('@');
    hoja.getRange('H:H').setNumberFormat('@');
  }
  return hoja;
}

function guardarFirma(id, nombre, dataUrl) {
  const props = PropertiesService.getScriptProperties();
  let carpetaId = props.getProperty('CARPETA_ID');
  let carpeta;
  try {
    carpeta = carpetaId ? DriveApp.getFolderById(carpetaId) : null;
  } catch (e) {
    carpeta = null;
  }
  if (!carpeta) {
    carpeta = DriveApp.createFolder(CARPETA_FIRMAS);
    props.setProperty('CARPETA_ID', carpeta.getId());
  }
  const bytes = Utilities.base64Decode(dataUrl.split(',')[1]);
  const archivo = carpeta.createFile(Utilities.newBlob(bytes, 'image/png', id + '_' + nombre + '.png'));
  return archivo.getUrl();
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

// Ejecútalo una vez desde el editor para dar permisos y crear la hoja
function instalar() {
  obtenerHoja();
  Logger.log('Listo. Zona horaria: ' + zona());
}
