# Receptor GPS del GATE con Bun y Express

Cliente TCP que se registra como módulo en **192.168.0.8:9067**, recibe el stream de instrucciones GPS y emite posiciones JSON. La recepción se realiza mediante **Bun.connect**. Express conserva el estado de la sesión en `app.locals.gate`.

Para aprender cómo cada sección del PDF se convierte en código, consultar la [guía del módulo para principiantes](docs/GUIA_MODULO.md) y los comentarios JSDoc de [modulo.js](modulo.js). Incluyen parámetros, retornos, ejemplos de bytes y los ocho eventos TCP.

**Se comprobó el funcionamiento contra el GATE real.** La evidencia de la última ejecución está en [verificacion-gate.json](verificacion-gate.json). El programa obtiene datos; no incorpora mapas, HTML, un servidor HTTP ni una base de datos.

## Control de versiones

La entrega se publica en `wea`, rama de trabajo basada en `develop`. Consulta [el flujo de integración](docs/GITFLOW.md) para crear la rama remota `develop` desde la base inicial y hacer el merge. `main` queda fuera de esta entrega.

## Ejecución

En PowerShell:

```powershell
git clone --branch wea https://github.com/ohc7u7/RepasarWTF.git
Set-Location -LiteralPath 'RepasarWTF'
bun install --frozen-lockfile
bun start
```

Requisitos: Bun instalado y acceso TCP a `192.168.0.8:9067`. El entorno de validación utiliza Bun 1.4.2. Para instalar Bun, consultar la [documentación oficial](https://bun.sh/docs/installation).

`bun start` mantiene la conexión activa y escribe cada posición recibida en la consola. **Ctrl+C** detiene el cliente y los reintentos de conexión. No hay una página web que abrir.

Los datos GPS salen por `stdout`; los eventos operativos y errores salen por `stderr`. En una terminal se usa JSON con un campo por línea para evitar que la velocidad quede cortada visualmente al borde de la pantalla. Al redirigir, el formato automático produce un objeto por línea (NDJSON). Para conservarlos por separado de forma explícita:

```powershell
$env:GATE_OUTPUT = 'ndjson'
bun run modulo.js 1> gps.ndjson 2> gate-eventos.log
```

La redirección es opcional y la realiza la terminal. `>` reemplaza los archivos de una ejecución anterior.

Para una demostración legible, incluso con una tubería de PowerShell:

```powershell
$env:GATE_OUTPUT = 'pretty'
bun start
```

La velocidad mantiene el mismo valor numérico; solo cambia la presentación. Para volver a la selección automática: `$env:GATE_OUTPUT = 'auto'`.

## Verificación automática contra el GATE real

```powershell
bun run verify:gate
```

Este comando ejecuta el mismo cliente TCP durante 15 segundos, muestra diagnósticos y el resumen final, y guarda `verificacion-gate.json` con:

- Inicio y fin de la observación.
- Servidor, ID de módulo y perfil CRC utilizado.
- Conexiones, LOGIN enviados, tramas y posiciones recibidas.
- Cantidad de CRC inválidos y registros GPS rechazados.
- Todas las posiciones válidas de la observación en el campo `posiciones`, sin el límite anterior de cinco muestras.
- Todos los diagnósticos relevantes, con origen, tamaño y campos inválidos identificados.
- Número de posiciones guardadas y un resumen por máquina/línea.
- Huella SHA-256 del archivo `modulo.js` probado.

Finaliza con código `0` si recibió posiciones GPS y `1` si no las recibió. Los contadores de errores deben revisarse por separado: recibir posiciones no implica que todas las tramas de origen sean válidas.

El archivo describe una sesión concreta y se reemplaza en cada verificación. La prueba cierra su conexión al terminar. Para recibir continuamente, utilizar `bun start`.

Se genera además [verificacion-gate.md](verificacion-gate.md), un resumen legible de los contadores, errores y posiciones por origen. Los bytes del diagnóstico se muestran como una cadena decimal, no como un array vertical de decenas de líneas. El nuevo informe sustituye `muestras` por `posiciones`; los informes anteriores de cinco muestras no permiten recuperar retroactivamente las posiciones omitidas.

Ejecutar una sola instancia por ID de módulo para evitar interferencias entre sesiones del mismo cliente.

## Qué se corrigió al conectar con el servidor

La documentación describe la estructura del protocolo mediante tramas de referencia. Los identificadores de máquina `100` y línea `8` son valores del caso ilustrado; **el receptor acepta cualquier máquina y línea** presentes en la instrucción `12`.

La conexión real permitió comprobar otros dos aspectos:

1. El CRC del GATE es CRC-16 con polinomio `0x1021`, inicio `0x0000`, calculado exclusivamente sobre los datos y transmitido en orden **byte bajo, byte alto**. Este perfil se usa por defecto.
2. Algunas posiciones contienen bytes adicionales después del bloque GPS fijo. El receptor interpreta los campos documentados y omite las extensiones; no exige que todas las tramas tengan exactamente 22 o 54 bytes de datos.

La variante CCITT-FALSE proporcionada inicialmente se conserva como opción explícita, pero no es la utilizada por el servidor comprobado. No se desactiva la validación CRC ni se aceptan automáticamente varias variantes para las posiciones GPS.

## Identidad del módulo y origen de los datos

```text
Boletera/GPS -> GATE -> sesión TCP del módulo -> decodificación -> JSON
```

| Identificador | Significado |
| --- | --- |
| `192.168.0.8:9067` | Destino TCP fijo del cliente de producción. |
| `200` | Instrucción LOGIN MODULO. |
| `6` | ID del módulo por defecto; configurable. |
| `12` | Instrucción Datos GPS solicitada al GATE. |
| `104` | Instrucción de error de módulo, incluida en la suscripción. |
| `maquina` | Identificador de la boletera obtenido de cada trama. |
| `linea` | Identificador de línea obtenido de cada trama. |

El ID del módulo pertenece al registro de la conexión. La cabecera GPS tiene la forma **12-Máquina-Línea**; no incluye el ID del módulo destinatario. Por eso `modulo_id` se incorpora desde la configuración de la sesión, mientras `maquina` y `linea` se leen de los bytes recibidos.

No se envían solicitudes GPS periódicas: el cliente recibe las tramas que el GATE reenvía a su suscripción. La instrucción `104` se registra como diagnóstico; no se interpreta como una posición.

## Handshake y CRC

Secuencia aplicada a cada nueva conexión:

1. `open` registra la apertura TCP y espera la confirmación del GATE.
2. `data` reconstruye y valida la confirmación.
3. El cliente calcula y envía un único LOGIN binario para su ID y los filtros `12` y `104`.
4. `drain` completa el envío si la escritura fue parcial.
5. Las instrucciones GPS válidas se decodifican y se imprimen.

La confirmación observada en el GATE real fue:

```text
124-2-200-0-253-159
```

Para el módulo `6`, el LOGIN aceptado durante la captura fue:

```text
124-5-200-6-2-12-104-175-208
```

| Bytes | Contenido |
| --- | --- |
| `124` | Identificador de envoltura. |
| `5` | Cantidad de bytes de datos. |
| `200-6-2-12-104` | LOGIN, ID del módulo, cantidad de filtros y filtros. |
| `175-208` | CRC calculado sobre esos cinco bytes de datos. |

Se utiliza `Uint8Array`: los guiones son una representación para lectura humana, no caracteres enviados por TCP.

El PDF imprime otra confirmación, `124-2-200-0-251-3`, que se conserva como excepción literal de compatibilidad. Las demás tramas deben superar el CRC del perfil configurado.

El estado `login_enviado` acredita que se completó la escritura. El estado `recibiendo_gps` acredita recepción de telemetría. No se inventa un ACK de aceptación del registro ni se envía el ACK GPS que el PDF atribuye al GATE.

## Decodificación y salida

El encuadre de las tramas es:

```text
ID (1 byte) | Count (1 byte) | Datos (Count bytes) | CRC (2 bytes)
```

`Receptor` conserva fragmentos y extrae tramas completas de `Count + 4` bytes. Admite ID `123` o `124` y un tamaño total máximo de 128 bytes. Una lectura TCP puede contener parte de una trama o varias concatenadas.

Offsets relativos al inicio de **Datos**, numerados desde cero:

| Offset | Campo | Tratamiento |
| --- | --- | --- |
| `0` | Instrucción | Se selecciona `12`. |
| `1` | Máquina | Valor recibido, sin filtro fijo. |
| `2` | Línea | Valor recibido, sin filtro fijo. |
| `3–6` | Latitud | Entero de 32 bits big-endian dividido por `-100000`. |
| `7–10` | Longitud | Entero de 32 bits big-endian dividido por `-100000`. |
| `11–13` | Día, mes, año | Año interpretado como `2000 + aa`. |
| `14–15` | Hora y minuto | Se conservan los valores recibidos. |
| `16` | Segundos y bit de dirección | Segundos calculados con `byte & 127`. |
| `17` | Velocidad | Valor original, sin conversión. |
| `18–21` | Máxima, pDOP, dirección y flags | No se incluyen en la salida. |
| `22` en adelante | Contadores u otras extensiones | No se interpretan en esta etapa. |

Se exige el bloque fijo de 22 bytes para una posición. El ACK de tres bytes `12-Máquina-Línea` se ignora. Los campos se validan antes de emitir el JSON: fecha válida, coordenadas geográficas en rango y longitud suficiente.

Una posición obtenida durante la verificación real:

```json
{"modulo_id":6,"instruccion":12,"maquina":129,"linea":3,"latitud":-38.77264,"longitud":-72.58555,"fecha":"2026-09-08T13:47:47","velocidad":16}
```

La fecha es la del dispositivo. No se le añade zona horaria porque la trama no la indica. Tampoco se asigna una unidad a la velocidad que el PDF no especifica.

`velocidad: datos[17]` copia la velocidad enviada por la boletera y reenviada por el GATE. No se calcula a partir de la distancia entre coordenadas. Es el byte 17 de Datos (el byte 19 al contar desde cero en la trama completa), distinto de la velocidad máxima del byte 18 de Datos.

«Tiempo real» describe el procesamiento continuo de los bytes que llegan por TCP. El GATE puede reenviar posiciones antiguas o acumuladas; el cliente conserva su fecha de origen y no las presenta como mediciones tomadas al momento de recibirlas.

## Conexión persistente y diagnósticos

| Manejador | Comportamiento |
| --- | --- |
| `open` | Abre la sesión y espera la confirmación. |
| `data` | Reconstruye, valida y decodifica tramas; responde al handshake. |
| `drain` | Completa escrituras parciales del LOGIN. |
| `close` | Limpia el estado de la sesión y programa reconexión. |
| `error` | Registra el error, termina el socket y habilita el reintento. |
| `connectError` | Registra el fallo de conexión y habilita el reintento. |
| `end` | Procesa el fin remoto y habilita la reconexión. |
| `timeout` | Cierra la conexión inactiva y habilita el reintento. |

Se esperan como máximo 10 segundos para la confirmación. El timeout de inactividad TCP es de 120 segundos y se renueva al recibir bytes. La demora entre reintentos comienza en un segundo y aumenta hasta 30 segundos ante fallos consecutivos de conexión. Una conexión abierta restablece esa demora.

Un CRC inválido o un encuadre incorrecto se registra; el receptor intenta localizar la siguiente trama. Una posición con campos inválidos se descarta sin interrumpir la recepción de las demás.

Durante las pruebas reales se observó una trama de la máquina `86`, línea `1`, cuyas coordenadas excedían los rangos geográficos al aplicar el divisor documentado. Se registra como `gps_invalido`; no se cambia la escala por conjetura. Su formato requiere confirmación del proveedor si también se necesita interpretar esa variante.

El diagnóstico distingue `longitud_bytes` (tamaño del bloque) de `campos_invalidos.longitud_decodificada` (coordenada geográfica). También incluye máquina, línea, valores calculados y rangos válidos. Que pase el CRC solo acredita la comprobación de integridad; no garantiza que el contenido corresponda a la escala documentada.

| Evento | Interpretación |
| --- | --- |
| `conexion_abierta` | TCP está conectado. |
| `login_enviado` | La trama LOGIN terminó de escribirse. |
| `conexion_fallida` | No pudo establecerse la conexión. |
| `reconexion_programada` | Se realizará un nuevo intento. |
| `crc_invalido` | La verificación de integridad no coincide. |
| `gps_invalido` | Campos GPS incompletos o fuera de rango. |
| `error_modulo_gate` | El GATE reenvió la instrucción `104`. |

## Configuración opcional

Los valores predeterminados funcionan con el servidor comprobado; no es necesario definir variables para iniciar el programa.

| Variable | Predeterminado | Uso |
| --- | --- | --- |
| `GATE_MODULO_ID` | `6` | ID de módulo entre 1 y 255. |
| `GATE_CRC_PROFILE` | `gate` | Perfil real; `ccitt-false` queda disponible para un servidor que use expresamente esa variante. |
| `GATE_DEBUG` | Desactivado | `1` registra también los bytes TCP recibidos en `stderr`. |
| `GATE_OUTPUT` | `auto` | `pretty`: JSON por campos; `ndjson`: un objeto por línea; `auto`: elige según terminal o redirección. |

La IP y el puerto de producción permanecen fijos. Para activar diagnóstico binario temporalmente:

```powershell
$env:GATE_DEBUG = '1'
bun start
```

Después de detenerlo:

```powershell
Remove-Item Env:GATE_DEBUG -ErrorAction SilentlyContinue
```

Express mantiene contadores, perfil CRC, estado y última posición en `app.locals.gate`. No se ejecuta `app.listen()` ni se crea un servidor HTTP en esta etapa.

## Validación con el stream real

La validación disponible es `bun run verify:gate`. Abre una conexión con `Bun.connect` a `192.168.0.8:9067`, registra el módulo y recibe tramas del servidor durante 15 segundos.

La evidencia está en `verificacion-gate.json` y su resumen en `verificacion-gate.md`. La huella SHA-256 identifica el archivo `modulo.js` que produjo esa recepción. Cada posición guardada procede del stream; la verificación no reproduce capturas almacenadas.

## Archivos y entrega

| Archivo | Función |
| --- | --- |
| [modulo.js](modulo.js) | Cliente de producción, CRC, parser, estado Express y reconexión. |
| [docs/GUIA_MODULO.md](docs/GUIA_MODULO.md) | Explicación para principiantes de las ocho secciones del PDF y su implementación. |
| [verificar-gate.js](verificar-gate.js) | Verificación de 15 segundos contra el GATE real. |
| [verificacion-gate.json](verificacion-gate.json) | Evidencia de recepción real más reciente. |
| [verificacion-gate.md](verificacion-gate.md) | Resumen de la verificación y diagnósticos legibles. |
| [package.json](package.json) | Dependencias y comandos disponibles. |
| [bun.lock](bun.lock) | Versiones resueltas de las dependencias. |
| [esquema_modulo_v1.json](esquema_modulo_v1.json) | Esquema del documento de entrega. |
| [entregable_modulo_v1.json](entregable_modulo_v1.json) | Código completo, explicación, supuestos y `next_action`. |
| [generar_entregable.py](generar_entregable.py) | Generación y validación del documento de entrega. |

El esquema valida el documento de entrega, no cada posición GPS. Python solo es necesario para regenerarlo:

```powershell
python -m pip install --target tmp/validation jsonschema
$env:PYTHONPATH = (Resolve-Path 'tmp/validation').Path
python generar_entregable.py
```

El helper contrasta las huellas del código con las evidencias disponibles y reemplaza el entregable después de validarlo con `jsonschema`. Si se modifica el receptor, las evidencias anteriores dejan de certificar esa revisión del archivo.

## Fuentes

- **Detalle de Tramas de GATE** (documento de referencia proporcionado para la actividad), secciones 1–4, 6.2 y 8: encuadre, campos GPS y protocolo de módulos.
- Captura del servidor `192.168.0.8:9067` del 8 de septiembre de 2026: CRC, confirmación, LOGIN y recepción de GPS reales.
- Aclaraciones del usuario: esquema del entregable y perfil CCITT-FALSE inicial, conservado como opción explícita.
- [TCP de Bun](https://bun.sh/docs/runtime/networking/tcp) y [Socket de Bun](https://bun.sh/reference/bun/Socket): eventos, timeout y escrituras parciales.
- [Aplicación Express](https://expressjs.com/en/5x/api/application/): estado de aplicación.
