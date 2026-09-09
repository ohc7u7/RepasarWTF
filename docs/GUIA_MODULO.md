# Guía breve del receptor

Todo el código ejecutable ocupa **30 líneas** en [modulo.js](../modulo.js), sin comentarios internos. Para cambiar el cliente que se registra, editar `const ID_MODULO = 6` en la línea 4. No hay configuración del ID por entorno.

## Recorrido principal

`NestFactory → GateModule → crearReceptor → connect → data → consola`

Nest crea el proveedor una sola vez y lo cierra al finalizar. La función `connect` se importa directamente de `bun`; es la API TCP nativa de Bun.

## Cómo se registra

La línea 9 prepara `registro` con Datos `[200, ID_MODULO, 2, 12, 104]`: instrucción LOGIN, ID del cliente, dos filtros, GPS y diagnósticos. `calcularCRC` calcula su verificación.

`open` anuncia la apertura TCP. Al recibir la confirmación `[200, 0]` del GATE, la línea 19 añade al registro el identificador 124, la longitud 5 y el CRC. Pone el LOGIN completo en `pendientes` y llama a `enviar`. Esta función transmite con `socket.write`; `drain` permite enviar el resto si la escritura fue parcial.

La variable `registroSolicitado` impide volver a solicitar el registro en la misma conexión. No representa un ACK de aceptación del módulo.

## Las ocho secciones del PDF

| Sección | Parte del programa |
| --- | --- |
| 1. Tramas | El bucle de data reconstruye cada mensaje. |
| 2. Identificador | Acepta 123/124; el LOGIN usa 124. |
| 3. Número de datos | buffer[1] contiene Count; total = Count + 4 delimita la trama. |
| 4. CRC | calcularCRC valida la integridad. |
| 5. Datos | trama.subarray(2, -2) retira la envoltura. |
| 6. Instrucciones | Las líneas 20–25 seleccionan e interpretan la instrucción 12. |
| 7. Consola | No se solicita instrucción 80 en esta actividad. |
| 8. Módulos | registro y enviar registran el cliente en GATE con sus filtros. |

## Qué hace cada evento

| Evento | Acción |
| --- | --- |
| open | Activa el timeout y anuncia la conexión. |
| data | Acumula bytes, valida tramas, envía LOGIN y obtiene GPS. |
| drain | Continúa el envío pendiente. |
| error / connectError | Llaman a fallar. |
| close | Registra el cierre. |
| end | Cierra el socket cuando el servidor termina el stream. |
| timeout | Cierra por inactividad mediante fallar. |

## De bytes a JSON

Dentro de `data`, las líneas 21–25 extraen máquina y línea de los bytes 1 y 2 de Datos. Las coordenadas son enteros big-endian de cuatro bytes divididos por -100000. La fecha usa los bytes 11–16; el segundo se obtiene con `& 127` y `padStart(2, '0')` completa cada componente con dos dígitos.

La validación UTC solo comprueba que la fecha sea válida; el texto emitido conserva la hora original sin zona. `velocidad` es el byte 17, sin cálculo por distancia ni unidad supuesta.

`modulo_receptor_id` procede de ID_MODULO. `modulo_origen_id: null` indica que la trama no contiene ese dato: las identidades de origen disponibles son máquina y línea.

`registrar` escribe diagnósticos; `calcularCRC` comprueba los bytes; `crearReceptor` reúne la conexión, `enviar` y `fallar`. Las líneas 28–30 inician Nest y habilitan el cierre. Consultar [README.md](../README.md) para ejecutar y revisar la evidencia real.
