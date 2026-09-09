# Receptor GPS con NestJS y Bun

[modulo.js](modulo.js) utiliza **NestJS** para gestionar un proveedor único y **Bun.connect** para recibir el stream real de **192.168.0.8:9067**. El programa conserva 30 líneas de lógica, con comentarios JSDoc. La [copia sin comentarios](modulo-sin-comentarios.js.txt) es solo de consulta.

## Ejecutar

En una copia nueva del repositorio:

```powershell
bun install --frozen-lockfile
$env:GATE_MODULO_ID = '6'
bun start
```

La variable `GATE_MODULO_ID` es el ID con el que **nuestro cliente** solicita registrarse. Debe contener un byte entero de 0 a 255. El código no tiene un ID predeterminado: si falta, termina antes de abrir TCP.

El valor `6` del comando es el ejemplo del PDF y el ID que se utilizó para verificar el stream. Que el servidor lo haya aceptado en esa observación no constituye un catálogo de IDs disponibles; usar el asignado a este cliente cuando el administrador lo indique.

La variable permanece en esa sesión de PowerShell. En una terminal nueva, definirla otra vez antes de iniciar. No se necesita un archivo de configuración adicional.

**Ctrl+C** cierra la aplicación y su socket. Ejecutar una sola instancia por ID. Si se corta la conexión, volver a ejecutar `bun start`.

## Qué significa «módulo»

| Dato | Significado y procedencia |
| --- | --- |
| `GateModule` | Clase que organiza el proveedor dentro de NestJS. No es un ID de GATE. |
| `modulo_receptor_id` | ID de nuestra sesión TCP, tomado de `GATE_MODULO_ID` y enviado en el LOGIN. |
| `maquina` | Identificador del equipo que generó el GPS, leído de Datos[1]. |
| `linea` | Línea del equipo, leída de Datos[2]. |
| `modulo_origen_id` | `null`: la instrucción GPS documentada no contiene el ID de otro módulo. |

El PDF define los módulos como **programas externos conectados al GATE**. Las posiciones GPS las generan las boleteras. La cabecera GPS es **12-Máquina-Línea**. Por eso el cliente recibe muchas máquinas y líneas sin que cada posición pertenezca a un módulo de software diferente.

Bun entrega los bytes recibidos; no agrega identificadores que no estén en ellos. Para relacionar una posición con otro módulo haría falta un campo adicional documentado o un catálogo del sistema. El programa no inventa esa relación.

## Cómo recibe GPS

1. `NestFactory.createApplicationContext` crea `GateModule` y su proveedor `GATE_TCP`, mediante `crearReceptor`.
2. El proveedor abre un socket con `Bun.connect` al GATE y espera su confirmación.
3. Al recibir Datos `[200, 0]`, construye y envía LOGIN: `[124, 5, 200, ID_CLIENTE, 2, 12, 104, CRC_bajo, CRC_alto]`.
4. Los filtros solicitan **12** (GPS) y **104** (diagnósticos de módulo). El GATE reenvía las instrucciones de la suscripción.
5. `data` reconstruye tramas completas, comprueba el CRC y decodifica cada GPS válido.
6. Cada posición se imprime en JSON. Al cerrar Nest, `onModuleDestroy` termina el socket.

El receptor utiliza los ocho eventos: `open`, `data`, `drain`, `close`, `error`, `connectError`, `end` y `timeout`. `drain` completa escrituras parciales; el timeout de inactividad es de 120 segundos.

La confirmación literal del PDF se admite como compatibilidad. El CRC comprobado con este GATE usa polinomio `0x1021`, inicio cero, cobertura de Datos y orden bajo/alto.

## Decodificación

Offsets desde cero dentro de **Datos**, después de retirar ID, Count y CRC:

| Campo | Bytes | Tratamiento |
| --- | --- | --- |
| Instrucción | 0 | Se selecciona 12. |
| Máquina / línea | 1 / 2 | Se conservan los valores recibidos, sin filtro fijo. |
| Latitud / longitud | 3–6 / 7–10 | Enteros big-endian divididos por `-100000`. |
| Fecha | 11–16 | Día, mes, año, hora, minuto y segundos; segundos con `& 127`. |
| Velocidad | 17 | Valor original, sin conversión. |

Se exige el bloque GPS fijo de 22 bytes y se ignoran las extensiones. Un ACK corto no contiene una posición. Se descartan CRC, fechas y coordenadas inválidos.

La hora del dispositivo se conserva sin asignarle zona horaria. La velocidad no recibe una unidad que el PDF no especifica. El GATE puede reenviar posiciones acumuladas: «tiempo real» describe su procesamiento al llegar.

## Salida y alcance

En la terminal se muestra un JSON con un campo por línea. Para guardar el stream:

```powershell
bun run modulo.js 1> gps.ndjson 2> gate-eventos.log
```

La redirección reemplaza los archivos anteriores. `stdout` contiene posiciones y `stderr` diagnósticos.

Nest funciona como contexto de aplicación, sin adaptador HTTP, controladores, interfaz visual ni mapas. La conexión es única y el reinicio es manual.

## Evidencia de esta versión

La verificación del **9 de septiembre de 2026** recibió **490 posiciones** de **451 combinaciones máquina/línea** en 15 segundos: **0 errores CRC** y **3 GPS rechazados** por coordenadas fuera de rango. El ID de registro usado fue 6, como configuración de la sesión de prueba. Todas las posiciones guardadas proceden del stream real.

- [verificacion-nest-gate.json](verificacion-nest-gate.json): posiciones completas, diagnósticos y SHA-256 del código verificado.
- [verificacion-nest-gate.md](verificacion-nest-gate.md): resumen de esa observación.
- [Guía del PDF al código](docs/GUIA_MODULO.md): recorrido de las ocho secciones del protocolo.
- [entregable_modulo_v1.json](entregable_modulo_v1.json): código, explicación y supuestos según el [esquema](esquema_modulo_v1.json).
- [Flujo Git](docs/GITFLOW.md): rama `wea` e integración posterior.

Los informes acreditan una observación concreta. `bun start` imprime el stream y no reemplaza esos archivos. Las evidencias de versiones anteriores permanecen en el historial de Git; la evidencia actual de Nest está en los archivos nuevos.

Referencias: **Detalle de Tramas de GATE**, secciones 5, 6.2 y 8; [contexto de aplicación de NestJS](https://docs.nestjs.com/standalone-applications), [proveedores de NestJS](https://docs.nestjs.com/fundamentals/custom-providers) y [TCP de Bun](https://bun.com/docs/runtime/networking/tcp).
