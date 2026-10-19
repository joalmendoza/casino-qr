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

**Hora tope de registro:** por defecto el registro se cierra a las **9:30 a. m.** Después de esa hora la página muestra "Registro cerrado" y el servidor rechaza registros nuevos. La hora se cambia desde `reporte.html` (con el PIN) y aplica de inmediato para todos. Quien ya se registró puede seguir mostrando su QR en el casino.

Si alguien intenta registrarse dos veces el mismo día con la misma cédula, se le devuelve su mismo QR (no se crea otro), aunque escriba el nombre distinto.

---

## Estructura

```
casino-qr/
├── index.html          Menú con las 3 pantallas
├── registro.html       Formulario de ingreso + firma + genera el QR
├── casino.html         Lector de QR con la cámara (pide PIN)
├── reporte.html        Resumen del día + descarga CSV (pide PIN)
├── politica.html       Aviso de privacidad (Ley 1581 de 2012)
├── css/
│   └── estilos.css
├── js/
│   ├── config.js       ← aquí va la URL del Apps Script, áreas y nombre empresa
│   └── api.js          Conexión con el backend (y modo demo sin backend)
├── plantillas/
│   └── Registro_Casino.xlsx  Planilla Excel para el encargado del casino
└── apps-script/
    ├── Code.gs         Backend: registrar, validar, resumen
    └── appsscript.json Zona horaria (America/Bogota) y permisos
```

**Planilla (hoja `Registros`):**

| ID | Fecha | HoraIngreso | Nombre | Area | Firma | Almorzo | HoraAlmuerzo | AreaVisita | Cedula | Autorizacion |
|----|-------|-------------|--------|------|-------|---------|--------------|------------|--------|--------------|
| C261016-4F2A9B | 2026-10-16 | 07:52 | Juan Pérez | Mantenimiento | (link a Drive) | SI | 13:05 | | 1020304050 | SI v1-2026-10 2026-10-16 07:52 |
| C261016-9D31CE | 2026-10-16 | 10:15 | Ana Rojas | Visitante | (link a Drive) | NO | | Control calidad | 52123456 | SI v1-2026-10 2026-10-16 10:15 |

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

### 2. Crear TU planilla de licencias y el servidor
Todo queda en **tu** cuenta Google. Los clientes nunca ven el código del servidor ni pueden saltarse el bloqueo.

1. Crea una planilla nueva en Google Sheets llamada **"Licencias Casino QR"**.
2. Menú **Extensiones → Apps Script**.
3. Borra lo que trae y pega el contenido de `apps-script/Code.gs`.
4. Arriba del código, cambia `CONTACTO_PROVEEDOR` (tu correo / WhatsApp, es lo que ve el cliente cuando se le suspende) y `URL_APP` si publicas en otro lado.
5. En **Configuración del proyecto** (engranaje) marca "Mostrar archivo de manifiesto appsscript.json" y pega el contenido de `apps-script/appsscript.json` (zona horaria de Colombia, America/Bogota).
6. Selecciona la función `instalar` y presiona **Ejecutar**. Acepta los permisos. Se crea la hoja **Licencias** con un cliente de ejemplo (`DEMO01`, PIN `1234`).

### 3. Publicar el servidor
1. **Implementar → Nueva implementación → tipo: Aplicación web**.
2. Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier usuario**.
3. Copia la URL que termina en `/exec`, pégala en `API_URL` de `js/config.js` y sube el cambio.

### 4. Dar de alta un cliente
En la hoja **Licencias** agrega una fila:

| Columna | Qué va |
|---|---|
| Codigo | Código corto único, va en los links. Ej: `ABC01` |
| Cliente | Nombre comercial |
| Estado | `Activo` o `Suspendido` |
| Vence | Fecha hasta la que está pagado (dd/mm/aaaa) |
| PIN | PIN del casino y del reporte de ese cliente |
| HoraTope | Hora de cierre del registro (el cliente la cambia desde el reporte). Vacío = 09:30 |
| Areas | Áreas separadas por coma. Vacío = las áreas por defecto |
| RazonSocial, NIT, Direccion, Ciudad, CorreoDatos, Telefono | Datos del cliente para la autorización de datos y el aviso de privacidad |
| HojaDatos | No la toques: se llena sola con la planilla de datos del cliente |
| Notas | Lo que quieras (plan, valor, contacto) |
| CorreoReportes | Correos que reciben el Excel diario y el mensual (separados por coma) |
| CorreosLectura | Correos que pueden ver la planilla en vivo, solo lectura (separados por coma) |

Recarga la planilla y aparece el menú **Casino QR**. Selecciona la fila del cliente y usa **Ver links del cliente**: te da los 3 links con su código (`registro.html?c=ABC01`, etc.) y su PIN para entregárselos.

La planilla con los registros de cada cliente se crea sola en tu Drive (carpeta **Casino QR - Clientes**) la primera vez que alguien se registra. Si el cliente la quiere ver, compártesela como lector.

### 5. Imprimir el afiche de entrada
Genera un QR que apunte al link de registro **con el código del cliente** (ej: `.../registro.html?c=ABC01`) y pégalo en portería. El celular recuerda el código, así que si después abren el link sin `?c=` sigue funcionando.

> Si cambias `js/` o `css/`, sube el número `?v=` en los `<script>` y `<link>` de las páginas para que los celulares no se queden con la versión vieja guardada.

> Ojo: cada vez que cambies `Code.gs` hay que hacer **Implementar → Gestionar implementaciones → Editar → Nueva versión**, si no sigue corriendo la versión anterior.

---

## Reportes automáticos en Excel
Una vez montado el servidor, en la planilla de licencias usa **Casino QR → Activar reportes automáticos** (solo una vez). Desde ahí:

- **Todos los días a las 3:00 p. m.** se genera un Excel por cliente con la lista del día (cédula, nombre, área, visita a, hora de ingreso, si almorzó y a qué hora) y una hoja de resumen con totales y por área.
- **El día 1 de cada mes a las 6:00 a. m.** sale el Excel del mes anterior: almuerzos por día, resumen por área y el detalle completo. Sirve para cuadrar con el proveedor del casino.
- Se guardan en tu Drive: `Casino QR - Clientes / <Cliente> / Reportes / 2026-10 / Casino_ABC01_2026-10-19.xlsx`.
- Si el cliente tiene correos en la columna **CorreoReportes**, se los manda adjuntos.
- A los clientes suspendidos no se les generan.
- La hora se cambia en `HORA_REPORTE` (arriba en `Code.gs`) y luego se vuelve a usar **Activar reportes automáticos**.
- Para probar sin esperar: selecciona la fila del cliente y usa **Generar Excel de hoy ahora**.

## Ver los registros en tiempo real desde varios equipos
- La planilla de cada cliente tiene una pestaña **"Hoy"** con los registros del día (los más recientes arriba) y los totales: ingresaron, almorzaron y sin almorzar. Se actualiza sola con cada registro y cada escaneo.
- Escribe los correos en la columna **CorreosLectura** y usa **Casino QR → Compartir planilla en vivo**. Esas personas la abren desde el computador o desde la app de Google Sheets en el celular, en **solo lectura**, y ven cómo va entrando la gente sin recargar.
- El **reporte de la app** (`reporte.html`) también se actualiza solo cada 30 segundos, así que se puede dejar abierto en una pantalla del casino o de portería.
- No se recomienda conectar un Excel de escritorio "en vivo": exige publicar los datos en internet y quedarían expuestos nombres y cédulas.

## Suscripción mensual y bloqueo por no pago
Cada cliente tiene una fila en la hoja **Licencias** con su fecha de vencimiento. El servidor la revisa en cada registro y en cada escaneo:

| Situación | Qué pasa |
|---|---|
| Al día | Funciona normal |
| Faltan 5 días o menos | El encargado ve un aviso amarillo en el reporte y en el casino. Las personas que se registran no ven nada |
| Venció hace 3 días o menos (gracia) | Sigue funcionando, con aviso de que se va a suspender |
| Más de 3 días vencido, o Estado = Suspendido | Registro y casino bloqueados con el mensaje "Servicio suspendido. Contacta al proveedor" |
| Pagó | Menú **Casino QR → Renovar 1 mes** sobre su fila. Se reactiva al instante |

- El **reporte sigue abriendo** aunque esté suspendido, para que el cliente pueda ver y descargar sus datos. Los datos nunca se borran.
- Los días de aviso y de gracia se cambian arriba en `Code.gs` (`AVISO_DIAS`, `GRACIA_DIAS`).
- **Renovar 1 mes** suma un mes desde la fecha de vencimiento (si todavía no ha pasado) o desde hoy (si ya pasó), y deja el estado en Activo.

Para ver cómo se ve sin conectar nada, en modo demo usa estos links:
`registro.html?c=DEMO-SUSPENDIDO`, `casino.html?c=DEMO-SUSPENDIDO`, `reporte.html?c=DEMO-VENCE`, `reporte.html?c=DEMO-GRACIA`. Para volver a la normalidad abre cualquier página con `?c=DEMO01`.

## Mantener el código privado sin pagar
- Los repos **privados en GitHub son gratis**. Lo que cobra GitHub es publicar Pages desde un repo privado.
- Solución gratis: **Cloudflare Pages**. Pon el repo en privado (Settings → General → Danger Zone → Change visibility → Private), entra a https://pages.cloudflare.com con una cuenta gratis, **Create → Pages → Connect to Git**, elige `casino-qr`, sin comando de build y carpeta de salida `/`. Te queda en `https://casino-qr.pages.dev` y se actualiza solo con cada cambio en GitHub.
- Después de pasar a Cloudflare cambia `URL_APP` en `Code.gs` y desactiva GitHub Pages.
- Igual, lo que de verdad protege el negocio es que el servidor y la hoja de licencias están en tu cuenta: sin eso la app no funciona aunque alguien copie las páginas.

## Límites del plan gratis (de sobra para una planta)
- Apps Script: ~20.000 llamadas al día y 6 min por ejecución. Cada registro o escaneo es una llamada.
- Google Sheets: 10 millones de celdas. Con 8 columnas alcanza para más de un millón de registros.
- Drive: 15 GB. Cada firma pesa unos 5–10 KB.

## Cosas que se pueden agregar después
- Lista de trabajadores precargada para elegir en vez de escribir.
- Turnos de almuerzo (bloques horarios por área) para ordenar mejor la fila.
- Cierre automático: un activador diario en Apps Script que mande el resumen por correo a las 15:00.
- Que el QR expire a cierta hora.

## Tratamiento de datos personales (Colombia)
- El registro pide nombre, cédula, área, firma y guarda fecha y hora. Son datos personales, así que aplica la **Ley 1581 de 2012** y el **Decreto 1377 de 2013** (compilado en el Decreto 1074 de 2015).
- Antes de registrarse, la persona ve un resumen de para qué se usan sus datos y tiene que marcar la casilla de **autorización**. Sin eso no se puede registrar (lo valida también el servidor).
- En la planilla queda la constancia en la columna `Autorizacion`: versión del texto aceptado, fecha y hora.
- `politica.html` es el aviso de privacidad completo: responsable, datos, finalidades, derechos y cómo ejercerlos.
- **Antes de usarla:** completa en la hoja Licencias la razón social, NIT, dirección, ciudad, correo y teléfono de cada cliente (cada cliente es el responsable del tratamiento de los datos de su gente).
- Como los datos quedan en tu cuenta, tú eres **encargado del tratamiento**: en el contrato con cada cliente incluye una cláusula de transmisión de datos personales. Lo ideal es que el área jurídica o quien maneje la política de datos de la empresa revise el texto.
- Si cambias el texto de la autorización, sube `VERSION_AUTORIZACION` en `js/config.js`.
- En el casino solo se muestran los últimos 4 dígitos de la cédula.

## Seguridad (lo básico)
- El PIN del casino y del reporte se valida en el servidor, no queda en la página.
- El QR solo trae un código aleatorio, no datos personales.
- La planilla y las firmas quedan en tu Drive, solo tú (y a quien compartas) las ve.
- No es un sistema de control de asistencia legal; es para ordenar el casino.
