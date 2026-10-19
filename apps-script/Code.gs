/**
 * Casino QR – servidor multicliente con licencias (Google Apps Script).
 *
 * Este script va pegado en TU planilla "Licencias Casino QR" (Extensiones → Apps Script).
 * Cada fila de la hoja "Licencias" es un cliente. Los datos de cada cliente quedan en su
 * propia planilla, que se crea sola en tu Drive la primera vez que se usa.
 *
 * Hoja "Licencias" (una fila por cliente):
 *   Codigo | Cliente | Estado | Vence | PIN | HoraTope | Areas | RazonSocial | NIT |
 *   Direccion | Ciudad | CorreoDatos | Telefono | HojaDatos | Notas | CorreoReportes | CorreosLectura
 *
 *   CorreoReportes: a quién se le manda el Excel semanal y mensual (varios separados por coma)
 *   CorreosLectura: quiénes pueden ver la planilla en vivo, solo lectura (varios separados por coma)
 *   HoraReporte: hora en que se genera y envía el Excel del día (el cliente la cambia desde el reporte). Vacío = 15:00
 *   DiarioActivo: SI / NO. Si es NO no se genera el Excel diario automático (el cliente lo prende o apaga desde el reporte)
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
const HORA_REPORTE = 6;    // hora (0-23) en que se generan los Excel: el semanal cada lunes y el mensual el día 1
const HORA_DIARIO_DEFECTO = '15:00';   // hora del Excel diario si el cliente no ha elegido otra

// ---- Seguridad ----
const MAX_INTENTOS_PIN = 5;          // intentos fallidos de PIN antes de bloquear
const BLOQUEO_PIN_MIN = 15;          // minutos de bloqueo tras fallar el PIN esas veces
const MAX_SOLICITUDES_MIN = 120;     // solicitudes por minuto por cliente (frena abusos y ataques de saturación)
const MAX_REGISTROS_MIN = 40;        // registros nuevos por minuto por cliente
const MAX_TAMANO_SOLICITUD = 200000; // bytes; una firma normal pesa 5-20 KB
const RETENCION_MESES = 12;          // los registros y firmas más viejos que esto se borran solos (0 = nunca)
const ACCIONES_CON_PIN = ['validar', 'resumen', 'resumenSemana', 'resumenMeses', 'resumenMes', 'guardarTope', 'guardarHoraReporte', 'generarDiario'];
const ACCIONES_QUE_ESCRIBEN = ['registrar', 'validar', 'guardarTope', 'guardarHoraReporte', 'generarDiario'];

const HORA_TOPE_DEFECTO = '09:30';
const AREAS_DEFECTO = 'Producción, Mantenimiento, Control calidad, Logística, Seguridad, HSE, Gestión Humana, Contabilidad, Visitante';
const HOJA_LIC = 'Licencias';
const HOJA_REG = 'Registros';
const CARPETA_RAIZ = 'Casino QR - Clientes';
const COLS = ['Codigo', 'Cliente', 'Estado', 'Vence', 'PIN', 'HoraTope', 'Areas', 'RazonSocial', 'NIT',
  'Direccion', 'Ciudad', 'CorreoDatos', 'Telefono', 'HojaDatos', 'Notas', 'CorreoReportes', 'CorreosLectura', 'HoraReporte', 'DiarioActivo'];

// ================= Entrada web =================

function doPost(e) {
  // Solicitudes vacías o demasiado grandes se rechazan antes de hacer cualquier trabajo
  const cuerpo = e && e.postData ? e.postData.contents : '';
  if (!cuerpo || cuerpo.length > MAX_TAMANO_SOLICITUD) return responder({ ok: false, error: 'Solicitud inválida' });
  let datos;
  try {
    datos = JSON.parse(cuerpo);
  } catch (err) {
    return responder({ ok: false, error: 'Solicitud inválida' });
  }

  const acciones = { config, registrar, validar, resumen, resumenSemana, resumenMeses, resumenMes, guardarTope, guardarHoraReporte, generarDiario };
  const fn = acciones[datos.accion];
  if (!fn) return responder({ ok: false, error: 'Acción desconocida' });

  const codigo = String(datos.cliente || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(codigo)) return responder({ ok: false, error: 'Código de cliente no válido. Revisa el link que te entregaron.' });

  // Límite de solicitudes por minuto por cliente (sin tocar la planilla, para aguantar ataques de saturación)
  if (superaLimite('sol_' + codigo, MAX_SOLICITUDES_MIN)) return responder({ ok: false, error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' });
  if (datos.accion === 'registrar' && superaLimite('reg_' + codigo, MAX_REGISTROS_MIN)) {
    return responder({ ok: false, error: 'Hay muchos registros al mismo tiempo. Intenta de nuevo en un minuto.' });
  }

  // Solo las acciones que escriben esperan turno (evita que dos lecturas del mismo QR pasen las dos)
  const escribe = ACCIONES_QUE_ESCRIBEN.indexOf(datos.accion) >= 0;
  const lock = LockService.getScriptLock();
  if (escribe && !lock.tryLock(8000)) return responder({ ok: false, error: 'El sistema está ocupado. Intenta de nuevo en unos segundos.' });
  try {
    const lic = buscarLicencia(codigo);
    if (!lic) return responder({ ok: false, error: 'Código de cliente no válido. Revisa el link que te entregaron.' });

    // PIN con bloqueo por intentos fallidos (evita que adivinen el PIN probando combinaciones)
    if (ACCIONES_CON_PIN.indexOf(datos.accion) >= 0) {
      const fallo = revisarPin(lic, datos.pin);
      if (fallo) return responder({ ok: false, error: fallo });
    }

    const estado = estadoLicencia(lic);
    const r = fn(datos, lic, estado);
    r.licencia = estado;
    return responder(r);
  } catch (err) {
    // El detalle queda en el registro de ejecuciones; al público solo un mensaje genérico
    console.error(err);
    return responder({ ok: false, error: 'No se pudo completar la operación. Intenta de nuevo.' });
  } finally {
    if (escribe) lock.releaseLock();
  }
}

// Cuenta solicitudes por minuto en la caché. true = ya pasó el límite
function superaLimite(clave, maximo) {
  const cache = CacheService.getScriptCache();
  const k = clave + '_' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(n), 120);
  return n > maximo;
}

// Devuelve un mensaje de error si el PIN no sirve, o '' si está bien
function revisarPin(lic, pin) {
  const cache = CacheService.getScriptCache();
  const kBloq = 'pinbloq_' + lic.Codigo, kFal = 'pinfal_' + lic.Codigo;
  if (cache.get(kBloq)) return 'Demasiados intentos con PIN incorrecto. Espera ' + BLOQUEO_PIN_MIN + ' minutos.';
  if (String(pin || '') === String(lic.PIN) && String(lic.PIN).length > 0) {
    cache.remove(kFal);
    return '';
  }
  const fallos = Number(cache.get(kFal) || 0) + 1;
  if (fallos >= MAX_INTENTOS_PIN) {
    cache.put(kBloq, '1', BLOQUEO_PIN_MIN * 60);
    cache.remove(kFal);
    console.warn('PIN bloqueado por intentos fallidos: ' + lic.Codigo);
    return 'Demasiados intentos con PIN incorrecto. Espera ' + BLOQUEO_PIN_MIN + ' minutos.';
  }
  cache.put(kFal, String(fallos), BLOQUEO_PIN_MIN * 60);
  return 'PIN incorrecto';
}

// Texto seguro para la planilla: sin caracteres de control y sin que empiece como fórmula (=, +, -, @)
function textoSeguro(s, max) {
  s = String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 100);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Compara nombres sin tildes ni mayúsculas: mismo primer nombre y al menos 2 palabras en común (o todas si tiene una)
function mismoNombre(a, b) {
  const t = x => String(x).replace(/^'/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/).filter(String);
  const x = t(a), y = t(b);
  if (!x.length || !y.length || x[0] !== y[0]) return false;
  const comunes = y.filter(p => x.indexOf(p) >= 0).length;
  return comunes >= Math.min(2, x.length, y.length);
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

  nombre = textoSeguro(nombre, 80);
  cedula = String(cedula || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  area = String(area || '').trim();
  visita = String(visita || '').trim();
  if (autoriza !== true) return { ok: false, error: 'Falta la autorización de tratamiento de datos' };
  if (nombre.length < 3 || !area) return { ok: false, error: 'Faltan datos' };
  if (cedula.length < 5 || cedula.length > 15) return { ok: false, error: 'Revisa el número de cédula' };
  // Área y área visitada tienen que ser de la lista del cliente
  const areas = config({}, lic).areas;
  if (areas.indexOf(area) < 0) return { ok: false, error: 'Área no válida' };
  if (area === 'Visitante' && (!visita || areas.indexOf(visita) < 0 || visita === 'Visitante')) return { ok: false, error: 'Falta el área que visita' };
  if (area !== 'Visitante') visita = '';
  if (!firma || firma.indexOf('data:image/png;base64,') !== 0 || firma.length > 150000) return { ok: false, error: 'Falta la firma' };

  const hoja = hojaRegistros(lic);
  const fecha = hoy();

  // Una cédula = un registro por día. Si ya está, solo le devolvemos su QR si el nombre coincide,
  // para que nadie saque el QR de otra persona sabiendo solo su cédula
  const filas = hoja.getDataRange().getDisplayValues();
  for (let i = 1; i < filas.length; i++) {
    if (filas[i][1] === fecha && filas[i][9] === cedula) {
      if (!mismoNombre(filas[i][3], nombre)) {
        return { ok: false, error: 'Esta cédula ya tiene un registro hoy. Si eres tú, escribe tu nombre como la primera vez o acércate a portería.' };
      }
      return { ok: true, repetido: true, id: filas[i][0], fecha, hora: filas[i][2], nombre: filas[i][3].replace(/^'/, ''), cedula, area: filas[i][4], visita: filas[i][8] };
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
  return { ok: true, id, fecha, hora, nombre: nombre.replace(/^'/, ''), cedula, area, visita };
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
  const tope = lic.HoraTope || HORA_TOPE_DEFECTO;
  return { ok: true, fecha, filas, horaReporte: lic.HoraReporte, diarioActivo: lic.DiarioActivo,
    correosReporte: listaCorreos(lic.CorreoReportes), horaTope: tope, abierto: horaAhora() <= tope };
}

// Totales de los últimos 3 meses (el actual y los 2 anteriores) para la pestaña Reportes
function resumenMeses({ pin }, lic) {
  if (pin !== String(lic.PIN)) return { ok: false, error: 'PIN incorrecto' };
  const d = new Date();
  const meses = [0, 1, 2].map(k => Utilities.formatDate(new Date(d.getFullYear(), d.getMonth() - k, 1), zona(), 'yyyy-MM'));
  const tot = {};
  meses.forEach(m => tot[m] = { mes: m, registros: 0, almuerzos: 0 });
  hojaRegistros(lic).getDataRange().getDisplayValues().slice(1).forEach(f => {
    const t = tot[f[1].slice(0, 7)];
    if (!t) return;
    t.registros++;
    if (f[6] === 'SI') t.almuerzos++;
  });
  return { ok: true, meses: meses.map(m => tot[m]) };
}

// Registros de un mes 'aaaa-mm' para descargar desde el reporte
function resumenMes({ pin, mes }, lic) {
  if (pin !== String(lic.PIN)) return { ok: false, error: 'PIN incorrecto' };
  if (!/^\d{4}-\d{2}$/.test(mes || '')) return { ok: false, error: 'Mes inválido' };
  const filas = registrosDe(lic, f => f[1].slice(0, 7) === mes)
    .map(f => ({ id: f[0], fecha: f[1], hora: f[2], nombre: f[3], area: f[4], almorzo: f[6] === 'SI', horaAlmuerzo: f[7], visita: f[8] || '', cedula: f[9] || '' }));
  return { ok: true, mes, filas };
}

// Cambia la hora del Excel diario y/o lo prende o apaga (activo: true / false)
function guardarHoraReporte({ pin, hora, activo }, lic) {
  if (pin !== String(lic.PIN)) return { ok: false, error: 'PIN incorrecto' };
  if (typeof activo === 'boolean') escribirLicencia(lic, 'DiarioActivo', activo ? 'SI' : 'NO');
  if (!hora) return { ok: true, horaReporte: lic.HoraReporte, diarioActivo: typeof activo === 'boolean' ? activo : lic.DiarioActivo };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { ok: false, error: 'Hora inválida' };
  escribirLicencia(lic, 'HoraReporte', hora);
  // Si se cambia la hora, que el de hoy pueda volver a salir a la hora nueva
  PropertiesService.getScriptProperties().deleteProperty('DIARIO_' + lic.Codigo);
  return { ok: true, horaReporte: hora, diarioActivo: typeof activo === 'boolean' ? activo : lic.DiarioActivo };
}

// Botón "Generar ahora" del reporte: arma el Excel del día, lo guarda en Drive y lo envía
function generarDiario({ pin }, lic, estado) {
  if (pin !== String(lic.PIN)) return { ok: false, error: 'PIN incorrecto' };
  if (estado.bloqueado) return { ok: false, suspendido: true, error: estado.mensaje };
  return { ok: true, mensaje: reporteDiarioCliente(lic, hoy()) };
}

// Registros de una semana (lunes a domingo) para descargar desde el reporte. semana: 'actual' o 'anterior'
function resumenSemana({ pin, semana }, lic) {
  if (pin !== String(lic.PIN)) return { ok: false, error: 'PIN incorrecto' };
  let lunes = lunesDe(hoy());
  if (semana === 'anterior') lunes = sumarDias(lunes, -7);
  const domingo = sumarDias(lunes, 6);
  const filas = registrosDe(lic, f => f[1] >= lunes && f[1] <= domingo)
    .map(f => ({ id: f[0], fecha: f[1], hora: f[2], nombre: f[3], area: f[4], almorzo: f[6] === 'SI', horaAlmuerzo: f[7], visita: f[8] || '', cedula: f[9] || '' }));
  return { ok: true, desde: lunes, hasta: domingo, filas };
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
  // Si la hoja se creó con una versión anterior, agrega las columnas nuevas al final
  const cab = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(String);
  const faltan = COLS.filter(c => cab.indexOf(c) < 0);
  if (faltan.length) {
    hoja.getRange(1, cab.length + 1, 1, faltan.length).setValues([faltan])
      .setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
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
    lic.HoraReporte = textoHora(lic.HoraReporte) || HORA_DIARIO_DEFECTO;
    lic.DiarioActivo = String(lic.DiarioActivo || 'SI').trim().toUpperCase() !== 'NO';
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

  if (dias > AVISO_DIAS) return { estado: 'activo', bloqueado: false, vence: venceTxt, dias, venceLindo };
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
    ss.setSpreadsheetTimeZone(zona());
    DriveApp.getFileById(ss.getId()).moveTo(carpetaCliente(lic));
    escribirLicencia(lic, 'HojaDatos', ss.getId());
    lic.HojaDatos = ss.getId();
    compartirEnVivo(lic, ss);
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
  if (!ss.getSheetByName('Hoy')) crearHojaHoy(ss);
  return hoja;
}

// Pestaña "Hoy": muestra solo los registros del día con totales. Se actualiza sola con cada registro
function crearHojaHoy(ss) {
  const h = ss.insertSheet('Hoy', 0);
  const hoyTxt = 'TEXT(TODAY(),"yyyy-mm-dd")';
  h.getRange('A1').setValue('Registros de hoy').setFontSize(14).setFontWeight('bold');
  h.getRange('A2').setFormula('=TEXT(TODAY(),"dd/mm/yyyy")');
  h.getRange('C1:C3').setValues([['Ingresaron'], ['Almorzaron'], ['Sin almorzar']]).setFontWeight('bold');
  h.getRange('D1').setFormula('=COUNTIF(Registros!B:B,' + hoyTxt + ')');
  h.getRange('D2').setFormula('=COUNTIFS(Registros!B:B,' + hoyTxt + ',Registros!G:G,"SI")');
  h.getRange('D3').setFormula('=D1-D2');
  h.getRange('A5').setFormula('=IFERROR(QUERY(Registros!A2:K,"select J, D, E, I, C, G, H where B = \'"&' + hoyTxt +
    '&"\' order by C desc label J \'Cédula\', D \'Nombre\', E \'Área\', I \'Visita a\', C \'Ingreso\', G \'Almorzó\', H \'Hora almuerzo\'",0),"Todavía no hay registros hoy")');
  h.getRange('A5:G5').setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
  h.setFrozenRows(5);
  h.setColumnWidths(1, 7, 120);
  h.setColumnWidth(2, 220);
}

// Comparte la planilla del cliente como solo lectura con los correos de la columna CorreosLectura
function compartirEnVivo(lic, ss) {
  const correos = listaCorreos(lic.CorreosLectura);
  if (correos.length) ss.addViewers(correos);
  return correos;
}

function listaCorreos(txt) {
  return String(txt || '').split(/[,;\s]+/).map(c => c.trim()).filter(c => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c));
}

function carpetaCliente(lic) {
  return carpetaGuardada('CLIENTE_' + lic.Codigo, () => carpetaRaiz().createFolder(lic.Cliente + ' (' + lic.Codigo + ')'));
}

function carpetaRaiz() {
  return carpetaGuardada('CARPETA_RAIZ', () => DriveApp.createFolder(CARPETA_RAIZ));
}

function guardarFirma(lic, id, nombre, dataUrl) {
  const carpeta = carpetaGuardada('FIRMAS_' + lic.Codigo, () => carpetaCliente(lic).createFolder('Firmas'));
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
    .addItem('Compartir planilla en vivo (fila seleccionada)', 'menuCompartir')
    .addSeparator()
    .addItem('Generar Excel de hoy (fila seleccionada)', 'menuDiaHoy')
    .addItem('Generar Excel de esta semana (fila seleccionada)', 'menuSemanaActual')
    .addItem('Generar Excel de la semana pasada (fila seleccionada)', 'menuSemanaPasada')
    .addItem('Activar reportes automáticos (diario y mensual)', 'activarReportes')
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

function menuCompartir() {
  const lic = filaSeleccionada();
  if (!lic) return;
  const ss = hojaRegistros(lic).getParent();
  const correos = compartirEnVivo(lic, ss);
  SpreadsheetApp.getUi().alert(correos.length
    ? 'Compartida como solo lectura con:\n' + correos.join('\n') + '\n\nLink de la planilla (pestaña "Hoy"):\n' + ss.getUrl()
    : 'Escribe primero los correos en la columna CorreosLectura (separados por coma).');
}

function menuDiaHoy() {
  const lic = filaSeleccionada();
  if (lic) SpreadsheetApp.getUi().alert(reporteDiarioCliente(lic, hoy()));
}

function menuSemanaActual() {
  const lic = filaSeleccionada();
  if (lic) SpreadsheetApp.getUi().alert(reporteSemanalCliente(lic, lunesDe(hoy())));
}

function menuSemanaPasada() {
  const lic = filaSeleccionada();
  if (lic) SpreadsheetApp.getUi().alert(reporteSemanalCliente(lic, sumarDias(lunesDe(hoy()), -7)));
}

// ================= Reportes automáticos en Excel =================

// Crea los activadores: revisión cada hora para el Excel diario (cada cliente a su hora),
// Excel semanal (lunes a domingo) cada lunes y mensual el día 1
function activarReportes() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['reportesDiarios', 'reportesSemanales', 'reportesMensuales'].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('reportesDiarios').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('reportesSemanales').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(HORA_REPORTE).inTimezone(zona()).create();
  ScriptApp.newTrigger('reportesMensuales').timeBased().onMonthDay(1).atHour(HORA_REPORTE).inTimezone(zona()).create();
  const msg = 'Reportes automáticos activados:\n' +
    '• Excel del día: a la hora que elija cada cliente en su reporte (por defecto ' + hora12(HORA_DIARIO_DEFECTO) + ').\n' +
    '• Excel de la semana anterior: cada lunes a eso de las ' + hora12(String(HORA_REPORTE).padStart(2, '0') + ':00') + '\n' +
    '• Excel del mes anterior: el día 1 a eso de las ' + hora12(String(HORA_REPORTE).padStart(2, '0') + ':00');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

// Corre cada hora: a cada cliente le genera el Excel del día cuando ya pasó su HoraReporte (una sola vez al día)
function reportesDiarios() {
  const fecha = hoy(), ahora = horaAhora();
  const props = PropertiesService.getScriptProperties();
  clientesParaReporte().forEach(lic => {
    if (!lic.DiarioActivo || ahora < lic.HoraReporte || props.getProperty('DIARIO_' + lic.Codigo) === fecha) return;
    try {
      Logger.log(reporteDiarioCliente(lic, fecha));
      props.setProperty('DIARIO_' + lic.Codigo, fecha);
    } catch (e) { Logger.log(lic.Codigo + ': ' + e); }
  });
}

function reporteDiarioCliente(lic, fecha) {
  return reportePeriodo(lic, fecha, fecha, 'día ' + fechaLinda(fecha), 'Casino_' + lic.Codigo + '_' + fecha, fecha.slice(0, 7));
}

// Corre los lunes: reporte de la semana que acaba de terminar (lunes a domingo)
function reportesSemanales() {
  const lunes = sumarDias(lunesDe(hoy()), -7);
  clientesParaReporte().forEach(lic => {
    try { Logger.log(reporteSemanalCliente(lic, lunes)); } catch (e) { Logger.log(lic.Codigo + ': ' + e); }
  });
}

function reportesMensuales() {
  if (RETENCION_MESES > 0) {
    clientesConDatos().forEach(lic => {
      try { Logger.log(borrarRegistrosViejos(lic)); } catch (e) { console.error(lic.Codigo + ': ' + e); }
    });
  }
  const d = new Date();
  const anterior = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const mes = Utilities.formatDate(anterior, zona(), 'yyyy-MM');
  clientesParaReporte().forEach(lic => {
    try { Logger.log(reporteMensualCliente(lic, mes)); } catch (e) { Logger.log(lic.Codigo + ': ' + e); }
  });
}

// Todos los clientes que ya tienen planilla de datos (incluye suspendidos)
function clientesConDatos() {
  const valores = hojaLicencias().getDataRange().getValues();
  const lista = [];
  for (let i = 1; i < valores.length; i++) {
    const lic = buscarLicencia(valores[i][0]);
    if (lic && lic.HojaDatos) lista.push(lic);
  }
  return lista;
}

// Ley 1581: los datos se guardan solo el tiempo necesario. Borra filas y firmas más viejas que RETENCION_MESES
function borrarRegistrosViejos(lic) {
  const d = new Date();
  const limite = Utilities.formatDate(new Date(d.getFullYear(), d.getMonth() - RETENCION_MESES, 1), zona(), 'yyyy-MM-dd');
  const hoja = hojaRegistros(lic);
  const filas = hoja.getDataRange().getDisplayValues();
  // Las filas se agregan en orden, así que las viejas están arriba
  let n = 0;
  while (n + 1 < filas.length && filas[n + 1][1] && filas[n + 1][1] < limite) n++;
  if (!n) return lic.Codigo + ': nada que borrar';
  for (let i = 1; i <= n; i++) {
    const m = String(filas[i][5]).match(/\/d\/([\w-]+)/) || String(filas[i][5]).match(/id=([\w-]+)/);
    if (m) { try { DriveApp.getFileById(m[1]).setTrashed(true); } catch (e) { /* ya no existe */ } }
  }
  hoja.deleteRows(2, n);
  return lic.Codigo + ': ' + n + ' registros anteriores a ' + limite + ' borrados';
}

// Clientes con planilla de datos y licencia no bloqueada
function clientesParaReporte() {
  const valores = hojaLicencias().getDataRange().getValues();
  const lista = [];
  for (let i = 1; i < valores.length; i++) {
    const lic = buscarLicencia(valores[i][0]);
    if (lic && lic.HojaDatos && !estadoLicencia(lic).bloqueado) lista.push(lic);
  }
  return lista;
}

function reporteSemanalCliente(lic, lunes) {
  const domingo = sumarDias(lunes, 6);
  const titulo = 'semana del ' + fechaLinda(lunes) + ' al ' + fechaLinda(domingo);
  const nombre = 'Casino_' + lic.Codigo + '_semana_' + lunes + '_al_' + domingo;
  return reportePeriodo(lic, lunes, domingo, titulo, nombre, lunes.slice(0, 7));
}

function reporteMensualCliente(lic, mes) {
  const [anio, m] = mes.split('-').map(Number);
  const nombreMes = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][m - 1];
  const ultimo = mes + '-' + String(new Date(anio, m, 0).getDate()).padStart(2, '0');
  return reportePeriodo(lic, mes + '-01', ultimo, nombreMes + ' ' + anio, 'Casino_' + lic.Codigo + '_' + mes + '_mensual', mes);
}

// Excel de un rango de fechas: hoja por día, resumen por área y detalle completo
function reportePeriodo(lic, desde, hasta, titulo, nombre, carpetaMes) {
  const filas = registrosDe(lic, f => f[1] >= desde && f[1] <= hasta);
  const alm = filas.filter(f => f[6] === 'SI').length;

  const dias = [['Fecha', 'Día', 'Registrados', 'Almorzaron', 'Sin almorzar']];
  const nombresDia = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    const delDia = filas.filter(x => x[1] === f);
    const almDia = delDia.filter(x => x[6] === 'SI').length;
    const [y, mo, d] = f.split('-').map(Number);
    dias.push([fechaLinda(f), nombresDia[new Date(y, mo - 1, d).getDay()], delDia.length, almDia, delDia.length - almDia]);
  }
  dias.push(['Total', '', filas.length, alm, filas.length - alm]);

  const resumen = [['Cliente', lic.Cliente, '', ''], ['Periodo', titulo, '', ''],
    ['Total registros', filas.length, '', ''], ['Total almuerzos', alm, '', ''],
    ['Visitantes', filas.filter(f => f[4] === 'Visitante').length, '', ''], ['', '', '', ''],
    ['Área', 'Registrados', 'Almorzaron', 'Visitas recibidas']]
    .concat(porArea(filas).map(a => [a.area, a.reg, a.alm, a.visitas]));

  // En el reporte de un solo día la hoja "Por día" sobra
  const hojas = desde === hasta
    ? [{ nombre: 'Registro', texto: true, filas: [COLS_DETALLE].concat(filas.map(filaDetalle)) }, { nombre: 'Resumen', filas: resumen }]
    : [{ nombre: 'Por día', filas: dias }, { nombre: 'Resumen', filas: resumen },
       { nombre: 'Detalle', texto: true, filas: [COLS_DETALLE].concat(filas.map(filaDetalle)) }];
  const blob = crearExcel(nombre, hojas);
  const archivo = carpetaReportes(lic, carpetaMes).createFile(blob);

  const asunto = 'Casino ' + lic.Cliente + ' – ' + titulo + ': ' + alm + (alm === 1 ? ' almuerzo' : ' almuerzos');
  const cuerpo = '<p>Reporte del casino, <b>' + titulo + '</b>.</p><ul><li>Total registros: <b>' + filas.length +
    '</b></li><li>Total almuerzos: <b>' + alm + '</b></li><li>Sin almorzar: <b>' + (filas.length - alm) + '</b></li></ul>' +
    '<p>El detalle va en el Excel adjunto.</p>';
  const enviado = enviarReporte(lic, asunto, cuerpo, blob);
  return lic.Codigo + ': Excel (' + titulo + ') guardado (' + archivo.getName() + ')' + (enviado ? ' y enviado a ' + enviado : '');
}

const COLS_DETALLE = ['Cédula', 'Nombre', 'Área', 'Visita a', 'Fecha', 'Hora ingreso', 'Almorzó', 'Hora almuerzo'];

function filaDetalle(f) {
  return [f[9], f[3], f[4], f[8], f[1].split('-').reverse().join('/'), f[2], f[6], f[7]];
}

function registrosDe(lic, filtro) {
  return hojaRegistros(lic).getDataRange().getDisplayValues().slice(1).filter(filtro)
    .sort((a, b) => (a[1] + a[2]).localeCompare(b[1] + b[2]));
}

function porArea(filas) {
  const areas = {};
  filas.forEach(f => {
    const a = areas[f[4]] = areas[f[4]] || { area: f[4], reg: 0, alm: 0, visitas: 0 };
    a.reg++;
    if (f[6] === 'SI') a.alm++;
    if (f[8]) (areas[f[8]] = areas[f[8]] || { area: f[8], reg: 0, alm: 0, visitas: 0 }).visitas++;
  });
  return Object.keys(areas).sort().map(k => areas[k]);
}

function carpetaReportes(lic, mes) {
  const reportes = carpetaGuardada('REPORTES_' + lic.Codigo, () => carpetaCliente(lic).createFolder('Reportes'));
  const sub = reportes.getFoldersByName(mes);
  return sub.hasNext() ? sub.next() : reportes.createFolder(mes);
}

// Arma una planilla temporal, la exporta como .xlsx y la borra
function crearExcel(nombre, hojas) {
  const ss = SpreadsheetApp.create(nombre);
  ss.setSpreadsheetTimeZone(zona());
  hojas.forEach((h, k) => {
    const sh = k === 0 ? ss.getSheets()[0].setName(h.nombre) : ss.insertSheet(h.nombre);
    const ancho = Math.max.apply(null, h.filas.map(f => f.length));
    const datos = h.filas.map(f => f.concat(Array(ancho - f.length).fill('')));
    const rango = sh.getRange(1, 1, datos.length, ancho);
    if (h.texto) rango.setNumberFormat('@');   // cédulas y horas tal cual
    rango.setValues(datos);
    sh.getRange(1, 1, 1, ancho).setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, ancho);
  });
  SpreadsheetApp.flush();
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
  const blob = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } })
    .getBlob().setName(nombre + '.xlsx');
  DriveApp.getFileById(ss.getId()).setTrashed(true);
  return blob;
}

function enviarReporte(lic, asunto, cuerpo, blob) {
  const correos = listaCorreos(lic.CorreoReportes);
  if (!correos.length) return '';
  MailApp.sendEmail({ to: correos.join(','), subject: asunto, htmlBody: cuerpo, attachments: [blob], name: 'Casino QR' });
  return correos.join(', ');
}

// Ejecútalo una vez desde el editor para dar permisos y crear la hoja Licencias con un cliente de ejemplo
function instalar() {
  const hoja = hojaLicencias();
  if (hoja.getLastRow() < 2) {
    const vence = new Date();
    vence.setMonth(vence.getMonth() + 1);
    // PIN de 6 dígitos al azar: no uses PIN cortos ni fáciles (1234, 0000, el año…)
    const pinEjemplo = String(Math.floor(100000 + Math.random() * 900000));
    hoja.appendRow(['DEMO01', 'Cliente de prueba', 'Activo', vence, pinEjemplo, HORA_TOPE_DEFECTO, AREAS_DEFECTO,
      'EMPRESA DE PRUEBA S.A.S.', '900.000.000-0', 'Calle 1 # 2-3', 'Bogotá, Colombia',
      'datos@empresa.com', '(+57) 300 000 0000', '', 'Fila de ejemplo', '', '']);
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

// Lunes de la semana de una fecha 'aaaa-mm-dd'
function lunesDe(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  const dia = new Date(y, m - 1, d).getDay();          // 0 = domingo
  return sumarDias(fecha, dia === 0 ? -6 : 1 - dia);
}

function sumarDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

function fechaLinda(fecha) {
  return fecha.split('-').reverse().join('/');
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
