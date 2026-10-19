# Seguridad y protección de datos – Casino QR

Revisión del aplicativo frente a: exposición de datos personales en la web, ataques de saturación (denegación de servicio) y cumplimiento de la ley colombiana de protección de datos (Ley 1581 de 2012).

> Esto es una revisión técnica, no una asesoría legal. Antes de vender el servicio conviene que un abogado revise el contrato y los textos de autorización.

---

## 1. Qué se encontró y qué se corrigió

| # | Riesgo encontrado | Gravedad | Qué se hizo |
|---|---|---|---|
| 1 | **El PIN se podía adivinar.** Un PIN de 4 dígitos son 10.000 combinaciones y no había límite de intentos: con un programa se podía descubrir y descargar nombres y cédulas de todos. | Alta | Después de **5 intentos fallidos el PIN se bloquea 15 minutos**. El cliente de ejemplo ahora se crea con PIN de 6 dígitos al azar. |
| 2 | **QR ajeno con solo la cédula.** Si alguien escribía la cédula de otra persona ya registrada, recibía su QR y su nombre. | Alta | Si la cédula ya está registrada hoy, solo se devuelve el QR si **el nombre también coincide**. Si no, sale: "Esta cédula ya tiene un registro hoy…". |
| 3 | **Fórmulas escondidas en el nombre.** Un nombre como `=IMPORTXML(...)` se guardaba en la planilla como fórmula y podía sacar datos hacia afuera. Igual en los CSV que se abren en Excel. | Alta | El servidor guarda esos textos como texto (con apóstrofo delante) y los CSV que se descargan también. |
| 4 | **Sin límite de solicitudes.** Un ataque de saturación podía agotar la cuota diaria de Google y tumbar el servicio de **todos** los clientes. | Alta | Límite de **120 solicitudes por minuto** y **40 registros por minuto** por cliente, contados en caché **sin tocar la planilla**. Las solicitudes de más de 200 KB se rechazan. |
| 5 | **Todas las solicitudes hacían fila.** Hasta las de solo lectura esperaban turno, así que un ataque bloqueaba todo. | Media | Solo esperan turno las que escriben (registrar, validar, guardar), y como máximo 8 segundos. Si no hay turno, responde "El sistema está ocupado…" en vez de quedarse colgado. |
| 6 | **Datos inventados.** Se podía mandar cualquier texto como área, una cédula de 500 caracteres o una "firma" de varios MB. | Media | El área y el área visitada tienen que estar en la lista del cliente. La cédula va de 5 a 15 caracteres, el nombre hasta 80 y la firma hasta ~110 KB. |
| 7 | **Mensajes de error con detalles internos** (nombres de funciones, columnas). | Baja | Al público solo le llega un mensaje genérico. El detalle queda en el registro de ejecuciones de Apps Script. |
| 8 | **La cédula quedaba guardada en el celular** (para volver a mostrar el QR). En una tablet compartida de portería quedaba a la vista. | Media | En el celular ya no se guarda la cédula, solo lo necesario para mostrar el QR. |
| 9 | **Páginas sin protecciones del navegador.** | Media | Se agregó *Content-Security-Policy* (solo se cargan scripts de los sitios autorizados y solo se conecta al servidor de Google), `no-referrer` (el link con el código del cliente no se filtra a otros sitios) y `noindex` (Google no indexa las páginas). |
| 10 | **Los datos se guardaban para siempre.** La ley dice que se guarden solo el tiempo necesario. | Media | El día 1 de cada mes se **borran solos los registros y las firmas de más de 12 meses** (`RETENCION_MESES` en `Code.gs`). |
| 11 | **El aviso de privacidad no decía dónde se guardan los datos** ni los plazos completos. | Media | Ahora dice que se guardan en la nube de Google (servidores que pueden estar fuera de Colombia), quién es el encargado, las medidas de seguridad, los 12 meses de conservación y las prórrogas de los plazos de respuesta. |

### Lo que ya estaba bien
- Todo viaja cifrado (HTTPS) entre los celulares, GitHub Pages y Google.
- **El QR no lleva datos personales**, solo un código al azar que vale un día.
- En el lector del casino solo se ven **los últimos 4 dígitos de la cédula**.
- Las páginas no pintan datos como HTML (no hay inyección de código en pantalla).
- Las firmas quedan en tu Drive **sin compartir**. Quien ve la planilla en vivo ve el link, pero no puede abrir la imagen.
- Las páginas públicas (GitHub Pages) **no tienen datos**: los datos solo existen en tu cuenta de Google y salen únicamente con el PIN.
- La autorización de datos **no viene marcada** y sin ella no se puede registrar, ni desde la pantalla ni saltándosela.

---

## 2. ¿Qué pasa ante un ataque de denegación de servicio?

**Las páginas (GitHub Pages o Cloudflare Pages):** están en redes de distribución grandes que aguantan tráfico masivo. Es muy difícil tumbarlas.

**El servidor (Google Apps Script):** Google absorbe el tráfico, pero cada cuenta tiene **cuotas diarias** de uso. El riesgo real no es que "se caiga Google", sino que un ataque **gaste la cuota del día** y la app deje de responder hasta el día siguiente.

**Qué lo frena ahora:**
- Límite por minuto por cliente, que se revisa en caché antes de abrir cualquier planilla. Las solicitudes de más se rechazan en milisegundos.
- Solicitudes grandes o mal formadas se rechazan sin procesarlas.
- Códigos de cliente con caracteres raros se rechazan antes de buscar nada.
- El registro se cierra a la hora tope, así que después de esa hora nadie puede llenar la planilla con basura.

**Lo que falta por hacer (recomendado):**
1. **Cuenta de Google Workspace** para el servidor en vez de una cuenta gratis. Las cuotas son bastante más altas (cuesta unos USD 6–7 al mes).
2. **Si creces mucho:** poner el servidor detrás de Cloudflare (plan gratis) con reglas de límite por IP, o pasar a un servidor propio.
3. **Plan B en el casino:** si un día el sistema no responde, el encargado anota en la plantilla Excel (`plantillas/Registro_Casino.xlsx`) y luego se sube. Que esté escrito en el contrato.
4. **Revisar las ejecuciones:** en el editor de Apps Script, la sección **Ejecuciones** muestra errores y los avisos de "PIN bloqueado". Si ves muchos, alguien está intentando entrar.

**¿Me pueden multar por un ataque?** Un ataque por sí solo no es una infracción. Lo que la ley exige es tener **medidas de seguridad razonables** (art. 17 y 18 de la Ley 1581) y **reportar los incidentes** a la SIC. Si el ataque solo deja el servicio sin funcionar un rato, no hay datos expuestos. Si hubiera acceso a datos, se reporta (ver punto 4).

---

## 3. Revisión frente a la ley colombiana

| Requisito | Norma | ¿Cómo lo cumple la app? |
|---|---|---|
| Autorización **previa, expresa e informada** del titular | Ley 1581, art. 9; Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) | Casilla obligatoria **sin marcar por defecto**, con resumen de para qué se usan los datos y link al aviso completo. Sin marcarla no se registra (también lo revisa el servidor). ✅ |
| **Prueba** de la autorización | Ley 1581, art. 17 lit. b | En la planilla queda la columna `Autorizacion` con la versión del texto aceptado, la fecha y la hora. ✅ Guarda una copia de cada versión del texto cuando lo cambies. |
| **Aviso de privacidad** con responsable, finalidades, derechos y cómo conocer la política | Decreto 1377, art. 14 y 15 | `politica.html` lo tiene. Los datos del responsable salen de la hoja Licencias de cada cliente. ✅ |
| Finalidad **legítima y limitada** | Ley 1581, art. 4 | Control de ingreso, del casino y seguridad en planta. No se usan para nada más. ✅ |
| **Datos mínimos** | Ley 1581, art. 4 (principio de finalidad) | Nombre, cédula, área, horas y firma. No se piden datos sensibles. ✅ |
| Derechos del titular: conocer, actualizar, rectificar, suprimir, revocar | Ley 1581, art. 8 | Explicados en el aviso, con el correo del cliente para ejercerlos. ✅ |
| Plazos: consultas 10 días hábiles (+5) y reclamos 15 días hábiles (+8) | Ley 1581, art. 14 y 15 | En el aviso. ✅ (corregido: faltaban las prórrogas) |
| **Seguridad** de la información | Ley 1581, art. 4 lit. g y art. 17 lit. d | Ver punto 1. ✅ |
| **Conservación limitada** | Decreto 1377, art. 11 | Se borran a los 12 meses. ✅ (nuevo) |
| **Encargado del tratamiento** con contrato | Ley 1581, art. 18; Decreto 1377, art. 25 | Tú eres el encargado (los datos quedan en tu cuenta). ⚠️ Falta el **contrato de transmisión de datos** con cada cliente. |
| Datos en servidores fuera de Colombia (Google) | Ley 1581, art. 26; Decreto 1377, art. 24 y 25 | Google actúa como subencargado. Va dicho en el aviso. ⚠️ Inclúyelo en el contrato con el cliente. |
| **Política de Tratamiento** escrita del responsable | Decreto 1377, art. 13 | ⚠️ Cada cliente debe tener la suya. El aviso dice que se puede pedir. |
| **Registro Nacional de Bases de Datos (RNBD)** | Decreto 090 de 2018 | ⚠️ Están obligadas las sociedades y entidades sin ánimo de lucro con activos de más de 100.000 UVT, y todas las entidades públicas. Si tu cliente está obligado, debe inscribir esta base. |
| **Reporte de incidentes** de seguridad a la SIC | Circular Única SIC (RNBD) | ⚠️ Dentro de los 15 días hábiles siguientes a enterarse. Ver punto 4. |

**Sanciones:** la SIC puede imponer multas de hasta 2.000 salarios mínimos mensuales, además de suspensión o cierre de actividades (Ley 1581, art. 23). Verifica el valor actualizado en la página de la SIC. Las multas casi siempre vienen de **no tener autorización, no atender reclamos, no tener medidas de seguridad o no reportar incidentes**: justo lo que se reforzó.

### ¿Está bien el texto de autorización que pusimos?
Sí, cumple lo básico:
- dice quién trata los datos y qué datos son
- dice para qué
- dice los derechos del titular y dónde ejercerlos
- es previa (antes de registrar), expresa (casilla que la persona marca) e informada (resumen más el aviso completo)

Se le agregaron las prórrogas de los plazos, la nube de Google, el encargado y los 12 meses de conservación.

**Lo que debe hacer cada cliente:**
1. Poner sus datos reales en la hoja Licencias (razón social, NIT, dirección, correo y teléfono para temas de datos).
2. Tener su Política de Tratamiento de Datos y, si está obligado, inscribir la base en el RNBD.
3. Si es una empresa grande con área jurídica, que ellos aprueben el texto. Si cambian el texto, sube `VERSION_AUTORIZACION` en `js/config.js`.

---

## 4. Si pasa algo (plan de incidente)

1. **Cambia el PIN** del cliente en la hoja Licencias y, si hace falta, suspéndelo con el menú.
2. **Revisa Ejecuciones** en Apps Script para ver qué pasó y desde cuándo.
3. **Avísale al cliente**, que es el responsable, el mismo día.
4. El responsable **reporta el incidente a la SIC** en el RNBD dentro de los **15 días hábiles** siguientes a enterarse. Tú, como encargado, le das la información.
5. Deja por escrito qué pasó, qué datos se vieron afectados y qué se hizo.

---

## 5. Recomendaciones para ti como dueño
- **PIN de 6 dígitos o más, distinto para cada cliente.** Nada de 1234, 0000 o el año.
- **Verificación en dos pasos** en tu cuenta de Google (es la llave de todo).
- **No compartas** la planilla de Licencias ni la carpeta "Casino QR - Clientes". Para que un cliente vea en vivo, usa la columna CorreosLectura, que comparte solo su planilla y en solo lectura.
- Si tienes la plantilla Excel en el celular o el computador, protégela: tiene nombres y cédulas.
- Contrato con cada cliente, con la cláusula de transmisión de datos (ver README, sección de venta).
