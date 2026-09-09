# GPS del GATE en 30 líneas

[modulo.js](modulo.js) conecta al GATE real **192.168.0.8:9067**, se registra como **módulo 6** y muestra posiciones GPS en JSON. Todo el programa está en ese archivo: Express es la única dependencia y Bun proporciona el socket TCP.

`modulo.js` conserva las 30 líneas de lógica y sus comentarios JSDoc. [modulo-sin-comentarios.js.txt](modulo-sin-comentarios.js.txt) es una copia de consulta con esas mismas 30 líneas, sin comentarios. Se mantiene un único punto de ejecución: `bun start` inicia `modulo.js`; la copia no se importa ni se incluye en los comandos de ejecución.

## Ejecutar

Con Bun instalado y acceso a la red del GATE, desde la carpeta del proyecto:

```powershell
bun install --frozen-lockfile
bun start
```

**Ctrl+C** detiene la recepción. Ejecutar una sola instancia del módulo 6. Si la conexión termina, volver a ejecutar `bun start`.

## Cómo funciona

1. `Bun.connect` abre la conexión y espera la confirmación del GATE.
2. El programa envía el LOGIN del módulo 6 con filtros **12** (GPS) y **104** (errores de módulo).
3. Acumula bytes TCP hasta completar cada trama: `ID + Count + Datos + CRC`.
4. Comprueba el CRC y decodifica las tramas de instrucción 12.
5. Guarda la última posición en `app.locals.gps` de Express y la imprime por consola.

El flujo es **boletera/GPS → GATE → módulo 6 → JSON**. `modulo_id` identifica nuestro cliente; `maquina` y `linea` identifican el origen de cada posición. Recibir máquinas diferentes en el mismo módulo es correcto.

La suscripción utiliza estos datos: `[200, 6, 2, 12, 104]`. El programa calcula el CRC y transmite `124-5-200-6-2-12-104-175-208` como bytes, después de la confirmación. El CRC del servidor comprobado usa polinomio `0x1021`, inicio cero, cobertura de Datos y orden bajo/alto.

## Datos GPS

Los offsets se cuentan desde cero dentro de **Datos**:

| Campo | Bytes | Conversión |
| --- | --- | --- |
| Instrucción | 0 | Solo se extrae GPS de la instrucción 12. |
| Máquina / línea | 1 / 2 | Valores de cada trama. |
| Latitud / longitud | 3–6 / 7–10 | Enteros big-endian divididos por `-100000`. |
| Fecha | 11–16 | Día, mes, año, hora, minuto y segundos; segundos con `& 127`. |
| Velocidad | 17 | Valor recibido, sin calcularlo ni convertirlo. |

La fecha conserva la hora del equipo, sin asignarle zona horaria. La velocidad conserva su valor original; la unidad no está especificada en el PDF. El GATE también puede reenviar posiciones acumuladas: recibirlas ahora no cambia la fecha GPS.

En la terminal el JSON aparece con un campo por línea. Los diagnósticos salen por `stderr`. Para guardar todas las posiciones recibidas:

```powershell
bun run modulo.js 1> gps.ndjson 2> gate-eventos.log
```

Esta redirección reemplaza los archivos si ya existen. Al redirigir, cada posición ocupa una línea JSON.

## Alcance de esta versión

El programa conserva los ocho manejadores TCP, las tramas fragmentadas o concatenadas, el envío parcial del LOGIN mediante `drain`, el CRC y la validación de fecha y coordenadas. El timeout por inactividad es de 120 segundos.

La versión reducida tiene conexión única, sin reconexión automática ni opciones por variables de entorno. Express conserva la última posición; no se inicia un servidor HTTP, mapa o interfaz visual.

## Evidencia y documentación

La observación real del **9 de septiembre de 2026** recibió **301 posiciones en 15 segundos**, con **0 errores CRC** y **2 registros GPS rechazados** por coordenadas fuera de rango. La conexión utilizada para comprobarlo se cerró al finalizar la observación.

- [verificacion-gate.json](verificacion-gate.json): todas las posiciones observadas y huella SHA-256 del código.
- [verificacion-gate.md](verificacion-gate.md): resumen legible de esa observación.
- [Guía del PDF al código](docs/GUIA_MODULO.md): conceptos y relación con las ocho secciones.
- [entregable_modulo_v1.json](entregable_modulo_v1.json): copia del código de 30 líneas, explicación y supuestos según el [esquema solicitado](esquema_modulo_v1.json).
- [Flujo Git](docs/GITFLOW.md): trabajo en `wea` e integración posterior en `develop`.

Los informes son evidencia de una ejecución concreta. `bun start` imprime el stream; no genera ni reemplaza estos informes. Los scripts auxiliares de la versión anterior se retiraron.

Referencias: **Detalle de Tramas de GATE**, entregado para la actividad; observaciones del servidor real; [API TCP de Bun](https://bun.com/docs/runtime/networking/tcp).
