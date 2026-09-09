/**
 * @file Módulo 6: conecta a GATE, envía LOGIN con filtros y recibe GPS en JSON.
 * Flujo: conexión → confirmación de GATE → LOGIN → tramas GPS → consola.
 */
import express from 'express';
/** Express conserva la última posición; modulo identifica a este cliente.
 * @function log
 * @param {string} evento - Suceso que se escribe como JSON en stderr.
 * @param {*} [detalle] - Información adicional del diagnóstico.
 */
const app = express(), modulo = 6, log = (evento, detalle) => console.error(JSON.stringify({ evento, detalle }));
/** Calcula CRC-16 del GATE: polinomio 0x1021, inicio cero, solo sobre Datos.
 * @param {Uint8Array} datos - Bytes cuya integridad se comprueba.
 * @returns {number} CRC de 16 bits; al transmitirlo se usa orden bajo/alto.
 */
function crc(datos) {
  let valor = 0; for (const byte of datos) { valor ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) valor = ((valor << 1) ^ (valor & 0x8000 ? 0x1021 : 0)) & 65535; } return valor;
}
/** Prepara la solicitud: 200=LOGIN, modulo=6, 2 filtros, 12=GPS y 104=errores. Aún no se envía. */
const registro = Uint8Array.from([200, modulo, 2, 12, 104]), control = crc(registro);
/** buffer acumula recepción; pendiente conserva bytes por enviar; registrado evita repetir la solicitud. */
let buffer = Buffer.alloc(0), pendiente = new Uint8Array(), registrado = false;
/** Transmite LOGIN con socket.write; conserva lo no escrito para el evento drain.
 * @param {object} socket - Conexión TCP de Bun.
 * @throws {Error} Si el socket ya está cerrado.
 */
function enviar(socket) { if (!pendiente.length) return; const n = socket.write(pendiente); if (n < 0) throw Error('Socket cerrado'); pendiente = pendiente.subarray(n); }
/** Registra el fallo, establece código de salida 1 y termina la conexión.
 * @param {object} socket - Socket que se cierra.
 * @param {Error} error - Causa del fallo.
 */
const fallar = (socket, error) => { log('error_socket', String(error)); process.exitCode = 1; socket.terminate(); };
/** Abre el socket al servidor GATE; este programa actúa como módulo receptor. */
await Bun.connect({ hostname: '192.168.0.8', port: 9067, socket: {
  /** open: anuncia la apertura TCP y activa 120 s de inactividad; espera la confirmación para enviar LOGIN. */
  open(socket) { socket.timeout(120); log('conexion_abierta', { modulo, filtros: [12, 104] }); },
  /** data: acumula fragmentos TCP y procesa todas las tramas completas recibidas.
   * @param {object} socket - Conexión por la que también se responde al GATE.
   * @param {Buffer} bytes - Fragmento del stream; puede contener parte de una trama o varias.
   */
  data(socket, bytes) {
    socket.timeout(120); buffer = Buffer.concat([buffer, bytes]);
    while (buffer.length >= 4) {
      /** Busca ID válido y Count de 1 a 124; cada trama ocupa Count + 4 bytes (ID, Count, Datos y CRC). */
      if (![123, 124].includes(buffer[0]) || buffer[1] < 1 || buffer[1] > 124) { buffer = buffer.subarray(1); continue; }
      const total = buffer[1] + 4; if (buffer.length < total) break;
      /** Retira ID, Count y CRC para acceder al bloque Datos. Si faltaban bytes, se esperó al siguiente data. */
      const trama = buffer.subarray(0, total), datos = trama.subarray(2, -2);
      /** Comprueba el CRC bajo/alto; la secuencia hexadecimal es la confirmación literal del PDF, admitida por compatibilidad. */
      if (crc(datos) !== trama.readUInt16LE(total - 2) && trama.toString('hex') !== '7c02c800fb03') { log('crc_invalido'); buffer = buffer.subarray(1); continue; }
      buffer = buffer.subarray(total);
      /** Solicitud de registro: Datos [200, 0] confirma la conexión desde GATE.
       * Se arma [124, 5, 200, 6, 2, 12, 104, CRC bajo, CRC alto] y enviar(socket) lo transmite una vez.
       * GATE reenvía las instrucciones suscritas a esta sesión; no se pide cada posición por separado.
       */
      if (datos[0] === 200 && datos.length === 2 && datos[1] === 0 && !registrado) { registrado = true; pendiente = Uint8Array.from([124, 5, ...registro, control & 255, control >> 8]); enviar(socket); }
      /** Registra errores 104; solo decodifica GPS 12 con su bloque fijo de al menos 22 bytes. */
      if (datos[0] === 104) log('error_modulo_gate', [...datos]); if (datos[0] !== 12 || datos.length < 22) continue;
      /** Lee coordenadas de cuatro bytes big-endian y aplica el divisor documentado -100000. */
      const latitud = datos.readUInt32BE(3) / -100000, longitud = datos.readUInt32BE(7) / -100000;
      /** Extrae día, mes, año, hora y minuto; & 127 obtiene segundos y map añade ceros para formar la fecha. */
      const [d, m, a, h, min, s] = [...datos.subarray(11, 16), datos[16] & 127].map(n => String(n).padStart(2, '0'));
      const fecha = `20${a}-${m}-${d}T${h}:${min}:${s}`, fechaUTC = new Date(fecha + 'Z');
      /** Descarta coordenadas o fechas inválidas. UTC solo comprueba la fecha; la salida conserva la hora original sin zona. */
      if (latitud < -90 || longitud < -180 || isNaN(+fechaUTC) || fechaUTC.toISOString().slice(0, 19) !== fecha) { log('gps_invalido', { maquina: datos[1], linea: datos[2], latitud, longitud, fecha }); continue; }
      /** modulo_id viene de nuestra sesión; máquina y línea vienen del GPS. Velocidad es datos[17], sin conversión. */
      app.locals.gps = { modulo_id: modulo, instruccion: 12, maquina: datos[1], linea: datos[2], latitud, longitud, fecha, velocidad: datos[17] };
      /** Imprime JSON legible en terminal o una posición por línea al redirigir; Express conserva la última. */
      console.log(JSON.stringify(app.locals.gps, null, process.stdout.isTTY ? 2 : undefined));
    /** drain reanuda enviar; error y connectError utilizan fallar para errores de socket y de conexión.
     * close registra el cierre; end responde al fin remoto cerrando el socket.
     * timeout llama a fallar por inactividad; cada data renueva los 120 segundos.
     */
    } }, drain: enviar, error: fallar, connectError: fallar, close() { log('conexion_cerrada'); }, end(socket) { socket.end(); }, timeout(socket) { fallar(socket, Error('Tiempo de espera agotado')); }
/** catch: registra el rechazo de Bun.connect y establece código de salida 1; no realiza reintentos. */
} }).catch(error => { log('conexion_fallida', String(error)); process.exitCode = 1; });
