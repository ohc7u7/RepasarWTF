import 'reflect-metadata';
import { connect } from 'bun';
import { Module } from '@nestjs/common'; import { NestFactory } from '@nestjs/core';
const ID_MODULO = 6;
const registrar = (evento, detalle) => console.error(JSON.stringify({ evento, detalle }));
function calcularCRC(datos) { let crc = 0; for (const byte of datos) { crc ^= byte << 8; for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 65535; } return crc; }
async function crearReceptor() {
  if (!Number.isInteger(ID_MODULO) || ID_MODULO < 0 || ID_MODULO > 255) throw Error('ID_MODULO debe ser un entero entre 0 y 255');
  const registro = Uint8Array.from([200, ID_MODULO, 2, 12, 104]), crcLogin = calcularCRC(registro); let buffer = Buffer.alloc(0), pendientes = new Uint8Array(), registroSolicitado = false;
  function enviar(socket) { if (!pendientes.length) return; const enviados = socket.write(pendientes); if (enviados < 0) throw Error('Socket cerrado'); pendientes = pendientes.subarray(enviados); }
  function fallar(socket, error) { registrar('error_socket', String(error)); process.exitCode = 1; socket.terminate(); }
  const socket = await connect({ hostname: '192.168.0.8', port: 9067, socket: {
    open(socket) { socket.timeout(120); registrar('conexion_abierta', { modulo_receptor_id: ID_MODULO, filtros: [12, 104] }); },
    data(socket, bytes) { socket.timeout(120); buffer = Buffer.concat([buffer, bytes]);
      while (buffer.length >= 4) {
        if (![123, 124].includes(buffer[0]) || buffer[1] < 1 || buffer[1] > 124) { buffer = buffer.subarray(1); continue; }
        const total = buffer[1] + 4; if (buffer.length < total) break; const trama = buffer.subarray(0, total), datos = trama.subarray(2, -2);
        if (calcularCRC(datos) !== trama.readUInt16LE(total - 2) && trama.toString('hex') !== '7c02c800fb03') { registrar('crc_invalido'); buffer = buffer.subarray(1); continue; } buffer = buffer.subarray(total);
        if (datos[0] === 200 && datos.length === 2 && datos[1] === 0 && !registroSolicitado) { registroSolicitado = true; pendientes = Uint8Array.from([124, 5, ...registro, crcLogin & 255, crcLogin >> 8]); enviar(socket); }
        if (datos[0] === 104) registrar('error_modulo_gate', [...datos]); if (datos[0] !== 12 || datos.length < 22) continue;
        const latitud = datos.readUInt32BE(3) / -100000, longitud = datos.readUInt32BE(7) / -100000;
        const [dia, mes, anio, hora, minuto, segundo] = [...datos.subarray(11, 16), datos[16] & 127].map(numero => String(numero).padStart(2, '0'));
        const fecha = `20${anio}-${mes}-${dia}T${hora}:${minuto}:${segundo}`, fechaUTC = new Date(fecha + 'Z');
        if (latitud < -90 || longitud < -180 || isNaN(+fechaUTC) || fechaUTC.toISOString().slice(0, 19) !== fecha) { registrar('gps_invalido', { maquina: datos[1], linea: datos[2], latitud, longitud, fecha }); continue; }
        const gps = { modulo_receptor_id: ID_MODULO, modulo_origen_id: null, instruccion: 12, maquina: datos[1], linea: datos[2], latitud, longitud, fecha, velocidad: datos[17] }; console.log(JSON.stringify(gps, null, process.stdout.isTTY ? 2 : undefined));
      } }, drain: enviar, error: fallar, connectError: fallar, close() { registrar('conexion_cerrada'); }, end(socket) { socket.end(); }, timeout(socket) { fallar(socket, Error('Tiempo de espera agotado')); }
  } }); return { onModuleDestroy: () => socket.terminate() }; }
class GateModule {} Module({ providers: [{ provide: 'GATE_TCP', useFactory: crearReceptor }] })(GateModule);
if (import.meta.main) { try { const aplicacion = await NestFactory.createApplicationContext(GateModule, { logger: false, abortOnError: false }); aplicacion.enableShutdownHooks(['SIGINT', 'SIGTERM']); }
  catch (error) { registrar('inicio_fallido', String(error)); process.exitCode = 1; } }
