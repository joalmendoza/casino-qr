// Configuración general de la app.
// Cuando publiques el Apps Script, pega aquí la URL que termina en /exec.
// Si se deja vacía, la app funciona en MODO DEMO (guarda todo en este navegador, sirve solo para probar).
const CONFIG = {
  API_URL: '',
  AREAS: ['Producción', 'Mantenimiento', 'Control calidad', 'Logística', 'Seguridad', 'HSE', 'Gestión Humana', 'Contabilidad', 'Visitante'],
  // Si elige esta área, se pide además a qué área viene de visita
  AREA_VISITANTE: 'Visitante',
  // PIN que pide la pantalla del casino y el reporte. En modo real lo valida el servidor.
  PIN_DEMO: '1234',
  // Hora tope de registro si nadie la ha cambiado desde el reporte (formato 24 h)
  HORA_TOPE_DEFECTO: '09:30',

  // Datos del responsable del tratamiento (Ley 1581 de 2012). Completa con los datos reales de la empresa.
  EMPRESA: 'NOMBRE DE LA EMPRESA S.A.S.',
  NIT: '000.000.000-0',
  DIRECCION: 'Dirección de la empresa',
  CIUDAD: 'Ciudad, Colombia',
  CORREO_DATOS: 'datospersonales@empresa.com',
  TELEFONO: '(+57) 000 000 0000',
  // Si cambias el texto de la autorización, sube esta versión para saber qué texto aceptó cada persona
  VERSION_AUTORIZACION: 'v1-2026-10'
};
