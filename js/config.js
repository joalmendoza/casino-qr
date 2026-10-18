// Configuración general de la app.
// Cuando publiques el Apps Script, pega aquí la URL que termina en /exec.
// Si se deja vacía, la app funciona en MODO DEMO (guarda todo en este navegador, sirve solo para probar).
const CONFIG = {
  API_URL: '',
  EMPRESA: 'Mi Empresa',
  AREAS: ['Producción', 'Mantenimiento', 'Control calidad', 'Logística', 'Seguridad', 'HSE', 'Gestión Humana', 'Contabilidad', 'Visitante'],
  // Si elige esta área, se pide además a qué área viene de visita
  AREA_VISITANTE: 'Visitante',
  // PIN que pide la pantalla del casino y el reporte. En modo real lo valida el servidor.
  PIN_DEMO: '1234'
};
