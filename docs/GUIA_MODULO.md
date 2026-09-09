# Del PDF al programa de 30 líneas

**GATE** concentra los datos de las boleteras. Un **módulo** es un cliente que se conecta al GATE para recibir las instrucciones que solicita en su LOGIN. Una **trama** es un mensaje binario; TCP puede entregarla en varios fragmentos o junto a otras tramas.

Nuestro módulo usa ID **6**. Ese número identifica al cliente receptor. La **máquina** y la **línea** se leen de cada trama GPS; no son el ID del módulo.

## Las ocho secciones del PDF en modulo.js

| Sección | Aplicación en el programa |
| --- | --- |
| 1. Tramas | El bucle de `data` extrae mensajes completos de `Count + 4` bytes. |
| 2. Identificador | Se reconocen los valores 123 y 124; el LOGIN utiliza 124. |
| 3. Número de datos | `buffer[1]` indica cuántos bytes hay en Datos, sin contar envoltura ni CRC. |
| 4. CRC | `crc(datos)` calcula la integridad. El perfil del GATE real utiliza inicio cero, polinomio 0x1021 y orden bajo/alto. |
| 5. Datos | `trama.subarray(2, -2)` retira ID, Count y los dos bytes CRC. |
| 6. Instrucciones | La instrucción 12 contiene GPS: origen, coordenadas, fecha y velocidad. |
| 7. Consola | La instrucción 80 corresponde a consola; esta actividad solicita GPS. |
| 8. Módulos | El LOGIN registra el módulo 6 con filtros 12 y 104, tras la confirmación del servidor. |

## Recorrido de una posición

`Bun.connect → open → data(confirmación) → enviar(LOGIN) → data(GPS) → app.locals.gps → console.log`

El cliente espera la confirmación de GATE antes de transmitir el LOGIN. Se admite la confirmación del servidor real y, como compatibilidad, la secuencia literal del PDF. La solicitud se prepara una sola vez por conexión; `drain` permite completar sus bytes si una escritura fue parcial.

`buffer` conserva los fragmentos TCP. El bucle espera la longitud completa y comprueba el CRC antes de interpretar los campos. Los valores máquina 100 y línea 8 que aparecen en el PDF son un caso de referencia: el código acepta cualquier origen en la instrucción 12.

La latitud y longitud se leen en big-endian y se dividen por `-100000`. La fecha usa los bytes 11–16; `& 127` retira el bit adicional del byte de segundos. Se utiliza UTC solo para comprobar que los componentes de la fecha son válidos; la salida conserva el texto sin zona horaria.

**La velocidad proviene directamente de `datos[17]`.** No se obtiene midiendo la distancia entre posiciones. Los campos posteriores no se muestran en esta actividad.

Los eventos `open`, `data`, `drain`, `close`, `error`, `connectError`, `end` y `timeout` son callbacks del socket de Bun. Express conserva la última posición; Bun realiza la conexión TCP.

Consulta [README.md](../README.md) para ejecutar el programa y revisar la evidencia real.
