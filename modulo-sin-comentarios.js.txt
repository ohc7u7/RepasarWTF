import express from 'express';
const app = express(), modulo = 6, log = (evento, detalle) => console.error(JSON.stringify({ evento, detalle }));
function crc(datos) {
  let valor = 0; for (const byte of datos) { valor ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) valor = ((valor << 1) ^ (valor & 0x8000 ? 0x1021 : 0)) & 65535; } return valor;
}
const registro = Uint8Array.from([200, modulo, 2, 12, 104]), control = crc(registro);
let buffer = Buffer.alloc(0), pendiente = new Uint8Array(), registrado = false;
function enviar(socket) { if (!pendiente.length) return; const n = socket.write(pendiente); if (n < 0) throw Error('Socket cerrado'); pendiente = pendiente.subarray(n); }
const fallar = (socket, error) => { log('error_socket', String(error)); process.exitCode = 1; socket.terminate(); };
await Bun.connect({ hostname: '192.168.0.8', port: 9067, socket: {
  open(socket) { socket.timeout(120); log('conexion_abierta', { modulo, filtros: [12, 104] }); },
  data(socket, bytes) {
    socket.timeout(120); buffer = Buffer.concat([buffer, bytes]);
    while (buffer.length >= 4) {
      if (![123, 124].includes(buffer[0]) || buffer[1] < 1 || buffer[1] > 124) { buffer = buffer.subarray(1); continue; }
      const total = buffer[1] + 4; if (buffer.length < total) break;
      const trama = buffer.subarray(0, total), datos = trama.subarray(2, -2);
      if (crc(datos) !== trama.readUInt16LE(total - 2) && trama.toString('hex') !== '7c02c800fb03') { log('crc_invalido'); buffer = buffer.subarray(1); continue; }
      buffer = buffer.subarray(total);
      if (datos[0] === 200 && datos.length === 2 && datos[1] === 0 && !registrado) { registrado = true; pendiente = Uint8Array.from([124, 5, ...registro, control & 255, control >> 8]); enviar(socket); }
      if (datos[0] === 104) log('error_modulo_gate', [...datos]); if (datos[0] !== 12 || datos.length < 22) continue;
      const latitud = datos.readUInt32BE(3) / -100000, longitud = datos.readUInt32BE(7) / -100000;
      const [d, m, a, h, min, s] = [...datos.subarray(11, 16), datos[16] & 127].map(n => String(n).padStart(2, '0'));
      const fecha = `20${a}-${m}-${d}T${h}:${min}:${s}`, fechaUTC = new Date(fecha + 'Z');
      if (latitud < -90 || longitud < -180 || isNaN(+fechaUTC) || fechaUTC.toISOString().slice(0, 19) !== fecha) { log('gps_invalido', { maquina: datos[1], linea: datos[2], latitud, longitud, fecha }); continue; }
      app.locals.gps = { modulo_id: modulo, instruccion: 12, maquina: datos[1], linea: datos[2], latitud, longitud, fecha, velocidad: datos[17] };
      console.log(JSON.stringify(app.locals.gps, null, process.stdout.isTTY ? 2 : undefined));
    } }, drain: enviar, error: fallar, connectError: fallar, close() { log('conexion_cerrada'); }, end(socket) { socket.end(); }, timeout(socket) { fallar(socket, Error('Tiempo de espera agotado')); }
} }).catch(error => { log('conexion_fallida', String(error)); process.exitCode = 1; });
