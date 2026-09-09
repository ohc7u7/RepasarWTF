# GPS del GATE con NestJS y Bun

[modulo.js](modulo.js) conecta al stream real de **192.168.0.8:9067**, se registra como módulo y muestra las posiciones GPS en JSON. NestJS gestiona el receptor y su cierre.

Toda la lógica ocupa **30 líneas en `modulo.js`**, sin comentarios ni archivos auxiliares de código. Las explicaciones están en este documento y en la [guía del programa](docs/GUIA_MODULO.md).

## Ejecutar

Desde la carpeta del proyecto:

```powershell
bun install --frozen-lockfile
bun start
```

**Ctrl+C** detiene la recepción. Ejecutar una sola instancia por ID. Si la conexión termina, volver a ejecutar `bun start`.

## Cambiar el ID

Editar únicamente esta constante en la **línea 4** de [modulo.js](modulo.js):

```javascript
const ID_MODULO = 6;
```

No se usa `.env` ni una variable de entorno para configurar el ID. El valor debe ser un entero entre 0 y 255. El 6 fue aceptado en la verificación registrada; utilizar el ID asignado a este cliente cuando se indique.

El programa calcula el LOGIN y su CRC a partir de esta constante. `bun start` ejecuta únicamente `modulo.js`; se retiró la copia de consulta `modulo-sin-comentarios.js.txt`.

## La función connect

La conexión utiliza la función de la biblioteca nativa de Bun:

```javascript
import { connect } from 'bun';
```

Dentro de `crearReceptor`, la línea 12 llama a `await connect` con `hostname: '192.168.0.8'` y `port: 9067`. Es la misma función que `Bun.connect`; no requiere instalar otro paquete. Véase la [API oficial de conexión TCP](https://bun.com/reference/bun/connect).

## Cómo leer el programa

| Función | Qué hace |
| --- | --- |
| `registrar` | Escribe diagnósticos JSON en stderr. |
| `calcularCRC` | Comprueba la integridad de los bytes mediante CRC-16. |
| `crearReceptor` | Abre la conexión y organiza sus ocho eventos. |
| `enviar` | Envía LOGIN y conserva lo pendiente si la escritura fue parcial. |
| `fallar` | Registra el fallo y termina la conexión. |
| `data` | Reconstruye tramas, envía LOGIN, obtiene GPS y lo imprime. |

Las líneas 28–30 crean el contexto de Nest. `GateModule` agrupa el proveedor `GATE_TCP`: Nest invoca `crearReceptor` una vez y, al cerrar la aplicación, `onModuleDestroy` termina el socket.

## Registro y recepción

1. `connect` abre TCP y `open` espera la confirmación del GATE.
2. `data` recibe bytes y espera a tener una trama completa.
3. Cuando Datos contiene `[200, 0]`, se envía LOGIN con el ID del cliente y filtros **12** (GPS) y **104** (diagnósticos).
4. El GATE reenvía las instrucciones de esa suscripción; no se consulta cada posición por separado.
5. El programa valida el CRC, decodifica GPS y muestra un objeto JSON por posición válida.

Una trama tiene `ID + Count + Datos + CRC` y ocupa `Count + 4` bytes. `buffer` conserva fragmentos y permite procesar varias tramas concatenadas.

El CRC del GATE comprobado usa polinomio `0x1021`, inicio cero, cobertura de Datos y orden bajo/alto. Se admite también la confirmación literal del PDF como compatibilidad.

## Identificar el origen

| Campo de salida | Procedencia |
| --- | --- |
| `modulo_receptor_id` | ID_MODULO: identifica nuestro cliente. |
| `maquina` y `linea` | Datos[1] y Datos[2]: identifican el origen GPS. |
| `modulo_origen_id` | `null`: el protocolo documentado no incluye el ID de otro módulo en GPS. |

Un módulo GATE es un programa externo conectado al servidor; `GateModule` es una clase de NestJS. El mismo cliente recibe posiciones de muchas máquinas y líneas.

Offsets desde cero dentro de Datos:

| Campo | Bytes | Conversión |
| --- | --- | --- |
| Instrucción | 0 | Se selecciona 12. |
| Latitud / longitud | 3–6 / 7–10 | Enteros big-endian divididos por -100000. |
| Fecha | 11–16 | Día, mes, año, hora, minuto y segundos; segundos con `& 127`. |
| Velocidad | 17 | Valor recibido, sin conversión. |

Se exige el bloque GPS fijo de 22 bytes; se ignoran los ACK cortos y las extensiones. Se rechazan CRC, coordenadas y fechas inválidos. La fecha conserva la hora del dispositivo sin asignarle zona horaria, y la velocidad no recibe una unidad que el PDF no especifica.

## Salida y verificación

La terminal muestra un JSON con un campo por línea. Para guardar las posiciones y los diagnósticos separados:

```powershell
bun run modulo.js 1> gps.ndjson 2> gate-eventos.log
```

La redirección reemplaza archivos anteriores. El programa no abre un servidor HTTP ni una visualización. Tiene timeout de inactividad de 120 segundos y reinicio manual.

La última observación real recibió **484 posiciones de 442 combinaciones máquina/línea en 15 segundos**, con **0 errores CRC** y **4 GPS rechazados** por coordenadas fuera de rango.

- [verificacion-nest-gate.json](verificacion-nest-gate.json): todas las posiciones y SHA-256 del código observado.
- [verificacion-nest-gate.md](verificacion-nest-gate.md): resumen legible.
- [entregable_modulo_v1.json](entregable_modulo_v1.json): código y explicación según el [esquema](esquema_modulo_v1.json).
- [Flujo Git](docs/GITFLOW.md): entrega en wea e integración posterior.

Los informes acreditan una ejecución concreta y no se reemplazan al ejecutar `bun start`.

Referencias: **Detalle de Tramas de GATE**, secciones 5, 6.2 y 8; [NestJS sin servidor HTTP](https://docs.nestjs.com/standalone-applications) y [TCP de Bun](https://bun.com/docs/runtime/networking/tcp).
