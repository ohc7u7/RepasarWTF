# Del PDF al receptor NestJS + Bun

**GATE** recibe datos de las boleteras. Un **módulo GATE** es un programa externo que se registra para recibir instrucciones. **GateModule**, en cambio, es la clase organizativa de NestJS: los dos conceptos no comparten un ID.

La instrucción GPS contiene **máquina y línea**. El ID de nuestro receptor se configura antes del LOGIN; el ID de otros módulos no aparece en esa instrucción y se representa como desconocido, `null`.

## Las ocho secciones en el código

| Sección del PDF | Aplicación en modulo.js |
| --- | --- |
| 1. Tramas | El bucle de `data` reconstruye mensajes de `Count + 4` bytes. |
| 2. Identificador | Reconoce 123/124; el registro del módulo utiliza 124. |
| 3. Número de datos | `buffer[1]` contiene Count. Si falta parte de la trama, espera otra recepción. |
| 4. CRC | `crc(datos)` verifica la integridad con el perfil comprobado contra el GATE real. |
| 5. Datos | `trama.subarray(2, -2)` deja instrucción, máquina, línea y parámetros. |
| 6. Instrucciones | Decodifica GPS 12 de cualquier máquina y línea. |
| 7. Consola | No se solicita instrucción 80 porque la actividad obtiene GPS. |
| 8. Módulos | Tras la confirmación, envía LOGIN con el ID configurado y filtros 12 y 104. |

## Funciones y NestJS

- `log`: escribe diagnósticos estructurados en stderr.
- `crc`: calcula los 16 bits de integridad sobre el campo Datos.
- `crearReceptor`: fábrica del proveedor único `GATE_TCP`; valida el ID y abre la conexión.
- `enviar`: transmite el LOGIN por `socket.write`; `drain` permite completar lo pendiente.
- `fallar`: registra un error, fija salida 1 y termina el socket.
- `data`: atiende el saludo, valida tramas y convierte los bytes GPS en JSON.
- `onModuleDestroy`: hook que Nest invoca para cerrar el socket al finalizar.
- `GateModule`: agrupa el proveedor; `createApplicationContext` lo inicia sin servidor HTTP.

Los demás eventos TCP anuncian apertura y cierre, atienden el fin remoto y cierran ante errores o inactividad. El código incluye comentarios JSDoc breves en cada parte.

## Dónde se solicita el registro

`crearReceptor → Bun.connect → open → data([200,0]) → enviar(LOGIN) → data(GPS) → consola`

En `registro` se preparan `[200, ID_CLIENTE, 2, 12, 104]`. La condición `datos[0] === 200 && datos[1] === 0` dentro de `data` construye la envoltura y llama a `enviar(socket)`. Desde entonces, GATE reenvía las instrucciones suscritas; no hay una consulta periódica por cada posición.

## Origen de los valores

Latitud y longitud son enteros de cuatro bytes big-endian divididos por `-100000`. La fecha procede de los bytes 11–16 y conserva la hora del dispositivo. `datos[16] & 127` retira el bit adicional de los segundos; UTC se usa únicamente para comprobar la fecha.

**Velocidad es `datos[17]`**, sin cálculo por distancia ni unidad supuesta. **Máquina y línea** son `datos[1]` y `datos[2]`. `modulo_receptor_id` procede de la configuración local; `modulo_origen_id: null` indica que no se recibió ese dato.

Consulta [README.md](../README.md) para ejecutar y revisar la evidencia del stream real.
