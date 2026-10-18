# Casino QR – Control de ingreso y almuerzo

App web sencilla para ordenar la entrada al casino. La persona se registra al llegar a la empresa, recibe un QR personal y ese mismo QR se escanea en el casino para poder almorzar. Un QR = un almuerzo, solo el día del registro.

**Costo: $0.** Las páginas van en GitHub Pages y los datos en una planilla de Google Sheets que se maneja con Apps Script (cuenta Google normal, sin tarjeta).

---

## Cómo funciona

```
 PORTERÍA / ENTRADA                    CASINO                         JEFATURA / RRHH
 ──────────────────                    ──────                         ───────────────
 Afiche con QR fijo                    Tablet o celular               reporte.html
 que abre registro.html                con casino.html                o la planilla directo
        │                                    │                              │
        ▼                                    ▼                              ▼
 Nombre + Área + Firma            Escanea QR de la persona          Ingresaron / almorzaron
 (fecha y hora automáticas)               │                         Descarga CSV
        │                                 │
        ▼                                 ▼
 Se genera QR personal ─────────► ✔ Puede almorzar  (verde)
 (queda en su celular)            ✖ Ya almorzó / otro día / no existe (rojo)
        │                                 │
        └──────────► Google Sheets ◄──────┘
                     (Apps Script)
                     Firmas en Google Drive
```

1. **Ingreso:** en la entrada hay un afiche con un QR fijo. La persona lo escanea con su celular, se abre `registro.html`, pone su nombre, elige su área y firma con el dedo. La fecha y la hora las pone el sistema (la del servidor, no la del celular, así nadie las cambia).
2. **QR personal:** al registrar, le aparece su QR del día. Queda guardado en el celular (si vuelve a abrir la página le sale de nuevo) y puede descargarlo o sacarle pantallazo.
3. **Casino:** en la entrada del casino hay un celular o tablet con `casino.html` abierto. Escanea el QR y la pantalla se pone verde con el nombre y el área, o roja si ya almorzó, si el QR es de otro día o si no existe.
4. **Reporte:** `reporte.html` muestra cuántos ingresaron, cuántos almorzaron y quiénes faltan. También se puede mirar la planilla directamente.

Si alguien intenta registrarse dos veces el mismo día con el mismo nombre, se le devuelve su mismo QR (no se crea otro).

---

## Estructura

```
casino-qr/
├── index.html          Menú con las 3 pantallas
├── registro.html       Formulario de ingreso + firma + genera el QR
├── casino.html         Lector de QR con la cámara (pide PIN)
├── reporte.html        Resumen del día + descarga CSV (pide PIN)
├── css/
│   └── estilos.css
├── js/
│   ├── config.js       ← aquí va la URL del Apps Script, áreas y nombre empresa
│   └── api.js          Conexión con el backend (y modo demo sin backend)
├── plantillas/
│   └── Registro_Casino.xlsx  Planilla Excel para el encargado del casino
└── apps-script/
    ├── Code.gs         Backend: registrar, validar, resumen
    └── appsscript.json Zona horaria (America/Santiago) y permisos
```

**Planilla (hoja `Registros`):**

| ID | Fecha | HoraIngreso | Nombre | Area | Firma | Almorzo | HoraAlmuerzo | AreaVisita |
|----|-------|-------------|--------|------|-------|---------|--------------|------------|
| C261016-4F2A9B | 2026-10-16 | 07:52 | Juan Pérez | Mantenimiento | (link a Drive) | SI | 13:05 | |
| C261016-9D31CE | 2026-10-16 | 10:15 | Ana Rojas | Visitante | (link a Drive) | NO | | Control calidad |

Si la persona elige **Visitante**, el formulario le muestra un segundo menú para elegir a qué área viene; eso queda en la columna `AreaVisita`.

Las firmas se guardan como imagen PNG en una carpeta de Drive llamada **Firmas Casino QR**, y en la planilla queda el link.

**Librerías (gratis, por CDN):** [qrcodejs](https://github.com/davidshimjs/qrcodejs) para crear el QR y [html5-qrcode](https://github.com/mebjas/html5-qrcode) para leerlo con la cámara.

---

## Probar ahora mismo (modo demo)

Sin configurar nada, la app ya funciona en **modo demo**: guarda los datos en el mismo navegador. Sirve para ver cómo se ve y mostrárselo a alguien.

- Abre `registro.html`, registra a alguien y anota el código que sale bajo el QR.
- En el mismo equipo abre `casino.html`, PIN `1234`, y valida (con la cámara o escribiendo el código).

En demo el registro y el casino tienen que ser el mismo equipo. Para uso real hay que conectar Google Sheets.

---

## Paso a paso para dejarlo funcionando

### 1. Crear el repositorio y publicar en GitHub Pages
1. En GitHub crea un repositorio nuevo, por ejemplo `casino-qr` (público, para que Pages sea gratis).
2. Sube el contenido de esta carpeta `casino-qr/` a la raíz del repo.
3. Ve a **Settings → Pages → Branch: main / (root) → Save**.
4. En un par de minutos queda en `https://TU_USUARIO.github.io/casino-qr/`.

### 2. Crear la planilla y el Apps Script
1. Crea una planilla nueva en Google Sheets (ej: "Casino QR").
2. Menú **Extensiones → Apps Script**.
3. Borra lo que trae y pega el contenido de `apps-script/Code.gs`.
4. Cambia `PIN_CASINO` por un PIN propio.
5. En **Configuración del proyecto** (engranaje) marca "Mostrar archivo de manifiesto appsscript.json" y pega el contenido de `apps-script/appsscript.json` (ahí está la zona horaria; cámbiala si no estás en Chile).
6. Selecciona la función `instalar` y presiona **Ejecutar**. Te pedirá permisos para la planilla y Drive: acepta.

### 3. Publicar el Apps Script
1. **Implementar → Nueva implementación → tipo: Aplicación web**.
2. Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier usuario**.
3. Copia la URL que termina en `/exec`.

### 4. Conectar
1. Abre `js/config.js`, pega la URL en `API_URL` y ajusta las áreas y el nombre de la empresa.
2. Sube el cambio a GitHub.

### 5. Imprimir el afiche de entrada
Genera un QR que apunte a `https://TU_USUARIO.github.io/casino-qr/registro.html` (cualquier generador gratis sirve, o el mismo `qrcodejs`) y pégalo en portería.

> Ojo: cada vez que cambies `Code.gs` hay que hacer **Implementar → Gestionar implementaciones → Editar → Nueva versión**, si no sigue corriendo la versión anterior.

---

## Límites del plan gratis (de sobra para una planta)
- Apps Script: ~20.000 llamadas al día y 6 min por ejecución. Cada registro o escaneo es una llamada.
- Google Sheets: 10 millones de celdas. Con 8 columnas alcanza para más de un millón de registros.
- Drive: 15 GB. Cada firma pesa unos 5–10 KB.

## Cosas que se pueden agregar después
- RUT o número de ficha en vez de solo el nombre (evita duplicados por nombres parecidos).
- Lista de trabajadores precargada para elegir en vez de escribir.
- Turnos de almuerzo (bloques horarios por área) para ordenar mejor la fila.
- Cierre automático: un activador diario en Apps Script que mande el resumen por correo a las 15:00.
- Que el QR expire a cierta hora.

## Seguridad (lo básico)
- El PIN del casino y del reporte se valida en el servidor, no queda en la página.
- El QR solo trae un código aleatorio, no datos personales.
- La planilla y las firmas quedan en tu Drive, solo tú (y a quien compartas) las ve.
- No es un sistema de control de asistencia legal; es para ordenar el casino.
