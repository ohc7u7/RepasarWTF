/** @file Receptor NestJS + Bun: registro configurable en GATE y salida GPS de todas las máquinas y líneas. */
import 'reflect-metadata'; import { Module } from '@nestjs/common'; import { NestFactory } from '@nestjs/core';
/** Escribe diagnósticos JSON en stderr; stdout contiene solamente posiciones GPS. */
const log = (evento, detalle) => console.error(JSON.stringify({ evento, detalle }));
/** CRC-16 del GATE: polinomio 0x1021, inicio cero y cobertura de Datos; se transmite bajo/alto.
 * @param {Uint8Array} datos - Bytes sobre los que se calcula la integridad.
 * @returns {number} CRC de 16 bits.
 */
function crc(datos) { let c = 0; for (const b of datos) { c ^= b << 8; for (let i = 0; i < 8; i++) c = ((c << 1) ^ (c & 0x8000 ? 0x1021 : 0)) & 65535; } return c; }
/** Nest crea una única instancia de este proveedor y gestiona su cierre.
 * @returns {Promise<object>} Proveedor con el hook onModuleDestroy.
 */
async function crearReceptor() {
  /** ID de NUESTRO cliente, configurado por entorno; no se obtiene del GPS ni identifica las máquinas. */
  const valor = process.env.GATE_MODULO_ID, modulo = Number(valor);
  if (!valor?.trim() || !Number.isInteger(modulo) || modulo < 0 || modulo > 255) throw Error('Configure GATE_MODULO_ID con el ID de registro (0..255).');
  /** LOGIN: 200, ID de cliente, dos filtros (12 GPS y 104 errores). El buffer conserva fragmentos TCP. */
  const registro = Uint8Array.from([200, modulo, 2, 12, 104]), control = crc(registro); let buffer = Buffer.alloc(0), pendiente = new Uint8Array(), registrado = false;
  /** Envía LOGIN y conserva los bytes pendientes para drain. Un retorno negativo indica socket cerrado. */
  function enviar(socket) { if (!pendiente.length) return; const n = socket.write(pendiente); if (n < 0) throw Error('Socket cerrado'); pendiente = pendiente.subarray(n); }
  /** Registra errores, establece salida 1 y cierra la conexión. */
  const fallar = (socket, error) => { log('error_socket', String(error)); process.exitCode = 1; socket.terminate(); };
  /** Socket TCP nativo de Bun al puerto de módulos del GATE; Nest no abre un servidor HTTP. */
  const socket = await Bun.connect({ hostname: '192.168.0.8', port: 9067, socket: {
    /** open: activa timeout de 120 segundos y espera la confirmación del GATE. */
    open(socket) { socket.timeout(120); log('conexion_abierta', { modulo_receptor_id: modulo, filtros: [12, 104] }); },
    /** data: acumula bytes y procesa todas las tramas completas, incluso fragmentadas o concatenadas. */
    data(socket, bytes) { socket.timeout(120); buffer = Buffer.concat([buffer, bytes]);
      while (buffer.length >= 4) {
        /** ID y Count delimitan la trama; total = Count + 4. CRC inválido provoca búsqueda de otra cabecera. */
        if (![123, 124].includes(buffer[0]) || buffer[1] < 1 || buffer[1] > 124) { buffer = buffer.subarray(1); continue; }
        const total = buffer[1] + 4; if (buffer.length < total) break; const trama = buffer.subarray(0, total), datos = trama.subarray(2, -2);
        if (crc(datos) !== trama.readUInt16LE(total - 2) && trama.toString('hex') !== '7c02c800fb03') { log('crc_invalido'); buffer = buffer.subarray(1); continue; } buffer = buffer.subarray(total);
        /** Solicitud de registro: GATE confirma con [200,0] y enviar transmite el LOGIN una sola vez. */
        if (datos[0] === 200 && datos.length === 2 && datos[1] === 0 && !registrado) { registrado = true; pendiente = Uint8Array.from([124, 5, ...registro, control & 255, control >> 8]); enviar(socket); }
        /** 104 es diagnóstico. Para GPS se exige instrucción 12 y el bloque fijo de 22 bytes. */
        if (datos[0] === 104) log('error_modulo_gate', [...datos]); if (datos[0] !== 12 || datos.length < 22) continue;
        /** Coordenadas big-endian / -100000; fecha del equipo y segundos & 127. UTC se usa solo para validar. */
        const latitud = datos.readUInt32BE(3) / -100000, longitud = datos.readUInt32BE(7) / -100000;
        const [d, m, a, h, min, s] = [...datos.subarray(11, 16), datos[16] & 127].map(n => String(n).padStart(2, '0'));
        const fecha = `20${a}-${m}-${d}T${h}:${min}:${s}`, fechaUTC = new Date(fecha + 'Z');
        if (latitud < -90 || longitud < -180 || isNaN(+fechaUTC) || fechaUTC.toISOString().slice(0, 19) !== fecha) { log('gps_invalido', { maquina: datos[1], linea: datos[2], latitud, longitud, fecha }); continue; }
        /** Máquina y línea vienen del stream. El PDF no informa otro módulo de origen: null indica desconocido.
         * modulo_receptor_id identifica esta sesión; velocidad copia datos[17], sin inventar una unidad.
         */
        const posicion = { modulo_receptor_id: modulo, modulo_origen_id: null, instruccion: 12, maquina: datos[1], linea: datos[2], latitud, longitud, fecha, velocidad: datos[17] };
        console.log(JSON.stringify(posicion, null, process.stdout.isTTY ? 2 : undefined));
      /** drain completa LOGIN; error/connectError cierran por fallo; close informa y end atiende el fin remoto.
       * timeout cierra por inactividad; cada data renueva el plazo. No hay reconexión automática.
       */
      } }, drain: enviar, error: fallar, connectError: fallar, close() { log('conexion_cerrada'); }, end(socket) { socket.end(); }, timeout(socket) { fallar(socket, Error('Tiempo de espera agotado')); }
  /** Al cerrar Nest, onModuleDestroy termina el socket de este proveedor. */
  } }); return { onModuleDestroy: () => socket.terminate() };
}
/** GateModule organiza el proveedor de Nest; su clase no es un ID del protocolo GATE. */
class GateModule {} Module({ providers: [{ provide: 'GATE_TCP', useFactory: crearReceptor }] })(GateModule);
/** Único arranque: bun start. El contexto Nest gestiona el proveedor y las señales de cierre sin adaptador HTTP. */
if (import.meta.main) { try { const app = await NestFactory.createApplicationContext(GateModule, { logger: false, abortOnError: false }); app.enableShutdownHooks(['SIGINT', 'SIGTERM']); }
  catch (error) { log('inicio_fallido', String(error)); process.exitCode = 1; } }
