/**
 * @fileoverview Receptor GPS del GATE: guía de lectura para principiantes.
 *
 * GATE es el servidor que concentra las tramas de las boleteras. Este programa
 * es un módulo: un cliente externo que se registra en GATE para recibir datos.
 * Una trama es un mensaje binario; un byte es un número entre 0 y 255.
 * TCP transporta bytes en orden, pero una lectura puede traer una trama parcial
 * o varias juntas. Por eso recibir bytes y decodificar GPS son pasos separados.
 *
 * Relación de las OCHO SECCIONES del PDF con este archivo:
 * 1. TRAMAS: codificarTrama() construye mensajes; Receptor los reconstruye.
 *    Formato: [ID, Count, ...Datos, CRC_bajo, CRC_alto] con perfil "gate".
 * 2. IDENTIFICADOR: se reconoce 123 en el formato general y 124 en módulos.
 *    El ID de envoltura no es el ID del módulo ni la instrucción GPS.
 * 3. NÚMERO DE DATOS: Count mide solo Datos; tamaño total = Count + 4.
 *    Receptor.push() espera a tener todos esos bytes antes de procesarlos.
 * 4. CRC: calcularCRCGate() y checksum() permiten comprobar integridad.
 *    El polinomio procede del protocolo. El inicio cero, la cobertura de Datos
 *    y el orden bajo/alto se corroboraron con el GATE real, no con el PDF solo.
 * 5. DATOS: al retirar ID, Count y CRC quedan la instrucción y sus parámetros.
 *    Para GPS: [12, máquina, línea, coordenadas, fecha, velocidad, ...].
 * 6. LISTA DE INSTRUCCIONES: parseGPS() implementa Datos GPS (sección 6.2).
 *    Solo procesa instrucción 12; el ACK GPS de tres bytes no es una posición.
 * 7. TRAMAS DE CONSOLA: usan la instrucción 80 y otra estructura interna.
 *    Esta actividad no las solicita ni las decodifica: el alcance es GPS.
 * 8. MÓDULOS: iniciarCliente() conecta a GATE; crearLogin() prepara el registro
 *    [200, módulo, 2, 12, 104]; data() responde a la confirmación con ese LOGIN.
 *
 * Recorrido de una posición:
 * Bun.connect -> open -> data (confirmación) -> crearLogin/vaciar/socket.write
 * -> data (GPS) -> Receptor.push -> parseGPS -> emitir -> JSON por consola.
 *
 * "6" identifica nuestra sesión de módulo. Máquina y línea se leen de cada
 * trama: los valores 100 y 8 del PDF son una referencia, no un filtro fijo.
 * Express conserva estado en app.locals.gate; Bun realiza el transporte TCP.
 * La fecha emitida pertenece al GPS y puede ser anterior a la recepción.
 *
 * Los ocho eventos de Bun se documentan dentro de crearManejadores(). Son
 * callbacks de transporte y no corresponden uno a uno a las secciones del PDF.
 *
 * @see docs/GUIA_MODULO.md - Recorrido didáctico de las ocho secciones.
 * @see README.md - Instalación, ejecución y demostración.
 * @see https://bun.sh/docs/runtime/networking/tcp
 * @see https://jsdoc.app/about-getting-started
 */
import express from 'express';
import { Buffer } from 'node:buffer';

/**
 * @typedef {string} PerfilCRC
 * Nombre de la variante: "gate" (servidor comprobado) o "ccitt-false".
 * Ambas usan el polinomio 0x1021, pero cambian inicio, bytes cubiertos y orden.
 */

/**
 * Datos GPS ya decodificados, sin información de la sesión receptora.
 * @typedef {Object} DatosGPS
 * @property {number} instruccion - Siempre 12 para una posición GPS.
 * @property {number} maquina - Identificador de origen leído de la trama.
 * @property {number} linea - Línea de origen leída de la trama.
 * @property {number} latitud - Grados decimales, calculados con / -100000.
 * @property {number} longitud - Grados decimales, calculados con / -100000.
 * @property {string} fecha - Fecha del GPS, sin zona: AAAA-MM-DDTHH:mm:ss.
 * @property {number} velocidad - Byte original; el PDF no especifica la unidad.
 */

/**
 * Objeto que recibe emitir() y que se imprime como una línea JSON.
 * @typedef {Object} PosicionGPS
 * @property {number} modulo_id - ID local de la sesión; no viene en el GPS.
 * @property {number} instruccion - Instrucción 12.
 * @property {number} maquina - Máquina que produjo la posición.
 * @property {number} linea - Línea indicada por esa máquina.
 * @property {number} latitud - Latitud decodificada en grados.
 * @property {number} longitud - Longitud decodificada en grados.
 * @property {string} fecha - Fecha conservada del dispositivo, sin zona horaria.
 * @property {number} velocidad - Velocidad sin conversión de unidad.
 */

/**
 * Contadores y estado del cliente, compartidos mediante app.locals.gate.
 * @typedef {Object} EstadoGate
 * @property {string} servidor - Dirección IP y puerto de destino.
 * @property {number} modulo_id - ID con el que se solicita el registro.
 * @property {PerfilCRC} perfil_crc - Variante elegida para la sesión.
 * @property {string} estado - Fase actual: conectando, login_enviado, etc.
 * @property {boolean} conectado - Estado TCP; no equivale a aceptación del LOGIN.
 * @property {number} conexiones - Conexiones TCP abiertas por este cliente.
 * @property {number} login_enviados - LOGIN escritos completamente.
 * @property {number} bytes_recibidos - Total de bytes entregados por TCP.
 * @property {number} tramas_recibidas - Tramas aceptadas, incluidos controles.
 * @property {number} gps_recibidos - Posiciones válidas, no máquinas distintas.
 * @property {number} crc_invalidos - Comprobaciones CRC que no coinciden.
 * @property {number} gps_invalidos - Registros GPS rechazados por sus campos.
 * @property {?PosicionGPS} ultimo_gps - Última posición válida o null.
 */

/**
 * Callback: función que recibe una posición cuando el parser termina.
 * @callback EmitirGPS
 * @param {PosicionGPS} posicion - Posición con su origen y módulo receptor.
 * @returns {void}
 */

/**
 * Callback para diagnósticos, utilizado por consola e informe de recepción real.
 * @callback RegistrarEvento
 * @param {string} evento - Nombre del evento, por ejemplo "login_enviado".
 * @param {Object} [detalle] - Información adicional del evento.
 * @returns {void}
 */

/**
 * IP fija del servidor GATE requerido por la actividad.
 * @type {string}
 */
export const MODUL_IP = '192.168.0.8';
/**
 * Puerto dedicado a módulos; PDF, sección 8.
 * @type {number}
 */
export const MODUL_PORT = 9067;
/**
 * Aplicación Express que expone el estado a otros componentes del programa.
 * No se llama a app.listen(): en esta etapa no existe un servidor HTTP.
 * @type {Object}
 */
export const app = express();
/**
 * Confirmación literal impresa en la sección 8, admitida como compatibilidad.
 * El GATE real envió [124, 2, 200, 0, 253, 159], validable con el perfil "gate".
 * @type {Buffer}
 */
const CONFIRMACION_PDF = Buffer.from([124, 2, 200, 0, 251, 3]);

/**
 * Escribe un diagnóstico estructurado en stderr, separado de las posiciones.
 * JSON.stringify convierte un objeto JavaScript en texto JSON serializable.
 * Aquí la fecha sí es UTC del equipo receptor: toISOString() termina en Z.
 *
 * @param {string} evento - Identificador legible del suceso.
 * @param {Object} [detalle={}] - Campos adicionales, sin sobrescribir fecha/evento.
 * @returns {void}
 * @example
 * registrar('login_enviado', { modulo_id: 6, filtros: [12, 104] });
 */
export function registrar(evento, detalle = {}) {
  console.error(JSON.stringify({ fecha: new Date().toISOString(), evento, ...detalle }, null, process.stderr.isTTY ? 2 : undefined));
}

/**
 * Crea la salida GPS con presentación legible o formato de intercambio NDJSON.
 * "pretty" deja un campo por línea para que velocidad no quede al borde derecho.
 * "ndjson" conserva un objeto por línea para archivos y otros programas.
 * "auto" elige pretty en una terminal y ndjson cuando se redirige la salida.
 * El formato solo cambia espacios y saltos: los valores GPS son los mismos.
 *
 * @param {string} [formato='auto'] - "auto", "pretty" o "ndjson".
 * @param {Function} [escribir] - Destino del texto, por defecto console.log.
 * @param {boolean} [esTerminal] - Indica si el destino de salida es una terminal.
 * @returns {EmitirGPS} Callback que serializa cada posición.
 * @throws {Error} Si se solicita un formato inexistente.
 */
export function crearSalidaGPS(formato = 'auto', escribir = texto => console.log(texto), esTerminal = Boolean(process.stdout.isTTY)) {
  if (!['auto', 'pretty', 'ndjson'].includes(formato)) throw new Error('GATE_OUTPUT debe ser auto, pretty o ndjson');
  const sangria = formato === 'pretty' || (formato === 'auto' && esTerminal) ? 2 : undefined;
  return posicion => escribir(JSON.stringify(posicion, null, sangria));
}

/**
 * Calcula el valor numérico de un CRC de 16 bits con polinomio 0x1021.
 * El CRC detecta alteraciones de bytes; no cifra datos ni valida coordenadas.
 * El acumulador recorre ocho bits por byte. XOR (^) combina bits y la máscara
 * 0xFFFF conserva únicamente 16 bits después de cada desplazamiento.
 *
 * @private
 * @param {(number[]|Uint8Array)} bytes - Bytes que cubrirá el cálculo.
 * @param {number} inicial - Semilla: 0 para GATE o 65535 para CCITT-FALSE.
 * @returns {number} CRC entero entre 0 y 65535, aún sin orden de transmisión.
 * @see calcularCRCGate
 */
function crc16(bytes, inicial) {
  let crc = inicial;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

/**
 * Devuelve el CRC-16/CCITT-FALSE solicitado al inicio de la actividad.
 * Esta variante se conserva como opción explícita; no es el perfil por defecto
 * del GATE comprobado. checksum() le pasa ID + Count + Datos, sin CRC final.
 *
 * @param {(number[]|Uint8Array)} bytes - Base completa que se quiere verificar.
 * @returns {number[]} Dos bytes en orden [alto, bajo].
 * @example
 * calcularCRC1021(Buffer.from('123456789')); // [41, 177], valor 0x29B1.
 * @see checksum
 */
export function calcularCRC1021(bytes) {
  const crc = crc16(bytes, 0xFFFF);
  return [crc >> 8, crc & 255];
}

/**
 * Calcula los dos bytes CRC utilizados por el GATE real de esta actividad.
 * Sección 4 del PDF: el CRC ocupa los dos bytes finales. La captura real aclaró
 * los parámetros que el PDF no detalla: inicio 0, cobertura de solo Datos y
 * orden bajo/alto. No se incluyen ID, Count ni el propio CRC en este cálculo.
 *
 * @param {(number[]|Uint8Array)} datos - Campo Datos completo de una trama.
 * @returns {number[]} Dos bytes en orden [bajo, alto].
 * @example
 * calcularCRCGate([200, 0]); // [253, 159]: confirmación del servidor.
 * @example
 * calcularCRCGate([200, 6, 2, 12, 104]); // [175, 208]: LOGIN del módulo 6.
 * @see crc16
 */
export function calcularCRCGate(datos) {
  const crc = crc16(datos, 0);
  return [crc & 255, crc >> 8];
}

/**
 * Selecciona qué bytes comprobar y cómo serializar el CRC según el perfil.
 * subarray(2) omite los dos primeros bytes: ID y Count.
 *
 * @private
 * @param {Uint8Array} base - [ID, Count, ...Datos], todavía sin CRC.
 * @param {PerfilCRC} perfilCRC - "gate" o "ccitt-false".
 * @returns {number[]} Dos bytes CRC ya ordenados para enviar o comparar.
 * @throws {Error} Si el perfil no está admitido.
 */
function checksum(base, perfilCRC) {
  if (perfilCRC === 'gate') return calcularCRCGate(base.subarray(2));
  if (perfilCRC === 'ccitt-false') return calcularCRC1021(base);
  throw new Error('Perfil CRC no admitido');
}

/**
 * Convierte un campo Datos en una trama binaria completa.
 * PDF 1, 2 y 3: añade identificador y Count; PDF 4: añade los dos bytes CRC.
 * El máximo es 128 bytes en total: 1 ID + 1 Count + hasta 124 Datos + 2 CRC.
 * Los elementos deben ser bytes enteros de 0 a 255 aportados por el llamador.
 *
 * @param {(number[]|Uint8Array)} datos - Instrucción y parámetros, sin envoltura.
 * @param {Object} [opciones={}] - Parámetros del encuadre.
 * @param {number} [opciones.identificador=124] - Marcador 123 o 124.
 * @param {PerfilCRC} [opciones.perfilCRC='gate'] - Variante de integridad.
 * @returns {Uint8Array} Mensaje binario listo para socket.write().
 * @throws {Error} Si el identificador, tamaño o perfil no son admisibles.
 * @example
 * [...codificarTrama([200, 6, 2, 12, 104])];
 * // [124, 5, 200, 6, 2, 12, 104, 175, 208]
 */
export function codificarTrama(datos, { identificador = 124, perfilCRC = 'gate' } = {}) {
  if (![123, 124].includes(identificador) || datos.length < 1 || datos.length > 124) {
    throw new Error('Envoltura de trama inválida');
  }
  const base = Buffer.from([identificador, datos.length, ...datos]);
  return new Uint8Array([...base, ...checksum(base, perfilCRC)]);
}

/**
 * Construye el registro y la suscripción del módulo: PDF, sección 8.
 * En [200, moduloId, 2, 12, 104], 200 significa LOGIN MODULO, moduloId identifica
 * a este cliente, 2 cuenta los filtros, 12 solicita GPS y 104 errores de módulo.
 * El filtro se refiere a instrucciones: no limita las máquinas ni las líneas.
 * La instrucción 80 de consola (PDF 7) no se solicita en esta actividad.
 *
 * Esta función solo prepara bytes. El envío se produce en vaciar(), desde data,
 * después de recibir la confirmación del GATE. Construir LOGIN no abre TCP.
 *
 * @param {number} [moduloId=6] - ID de sesión; entero de 1 a 255 en este cliente.
 * @param {PerfilCRC} [perfilCRC='gate'] - Perfil acordado con el servidor.
 * @returns {Uint8Array} LOGIN completo con Count y CRC calculados.
 * @throws {Error} Si el ID o el perfil son inválidos.
 * @example
 * [...crearLogin(6)]; // [124, 5, 200, 6, 2, 12, 104, 175, 208]
 * @see crearManejadores
 */
export function crearLogin(moduloId = 6, perfilCRC = 'gate') {
  if (!Number.isInteger(moduloId) || moduloId < 1 || moduloId > 255) {
    throw new Error('GATE_MODULO_ID debe ser un entero entre 1 y 255');
  }
  return codificarTrama([200, moduloId, 2, 12, 104], { perfilCRC });
}

/**
 * Lee opciones del entorno y las valida antes de iniciar una conexión.
 * ?? usa el valor predeterminado cuando una variable no está definida.
 * IP y puerto siguen siendo fijos; estas opciones no cambian el destino TCP.
 *
 * @param {Object} [env=process.env] - Variables de configuración del entorno.
 * @param {string} [env.GATE_MODULO_ID] - ID del módulo; predeterminado "6".
 * @param {string} [env.GATE_CRC_PROFILE] - "gate" o "ccitt-false".
 * @param {string} [env.GATE_DEBUG] - "1" activa el registro de bytes entrantes.
 * @param {string} [env.GATE_OUTPUT] - "auto", "pretty" o "ndjson".
 * @returns {{moduloId: number, perfilCRC: PerfilCRC, debug: boolean, formatoSalida: string}} Configuración.
 * @throws {Error} Si el registro resultante tendría un ID o perfil inválido.
 * @example
 * leerConfiguracion({}); // { moduloId: 6, perfilCRC: 'gate', debug: false, formatoSalida: 'auto' }
 */
export function leerConfiguracion(env = process.env) {
  const moduloId = Number(env.GATE_MODULO_ID ?? 6);
  const perfilCRC = env.GATE_CRC_PROFILE ?? 'gate';
  const formatoSalida = env.GATE_OUTPUT ?? 'auto';
  crearLogin(moduloId, perfilCRC);
  crearSalidaGPS(formatoSalida);
  return { moduloId, perfilCRC, debug: env.GATE_DEBUG === '1', formatoSalida };
}

/**
 * Traduce el bloque binario GPS en valores utilizables: PDF, sección 6.2.
 * Recibe únicamente Datos; Receptor ya retiró y validó la envoltura y el CRC.
 * No comprueba el CRC por sí sola: esa responsabilidad pertenece a Receptor.
 *
 * Offsets (posiciones desde cero dentro de Datos):
 * 0: instrucción; 1: máquina; 2: línea; 3..6: latitud; 7..10: longitud;
 * 11..16: día, mes, año, hora, minuto, segundos; 17: velocidad.
 * 18..21: máxima, pDOP, dirección y flags; 22 en adelante: extensiones.
 * Los últimos campos no se extraen para esta actividad.
 *
 * DataView interpreta cuatro bytes como un entero. false en getUint32 indica
 * big-endian: primero el byte de mayor peso. Esto es independiente del orden
 * bajo/alto utilizado para transmitir el CRC. Se aplica el divisor del PDF.
 *
 * El segundo comparte su bit más alto con la dirección: & 127 lo elimina.
 * Así, 182 = 128 + 54 se convierte en segundo 54. Date.UTC se usa para validar
 * componentes; el texto final conserva la fecha del GPS sin asignarle zona.
 *
 * Un CRC correcto no garantiza coordenadas válidas. Si la escala documentada
 * produce un valor fuera de rango, se rechaza sin inventar otra conversión.
 *
 * @param {Uint8Array} datos - Campo Datos de la trama; Buffer también es válido.
 * @returns {?DatosGPS} Posición, o null para otra instrucción o un ACK GPS.
 * @throws {Error} Si una trama GPS no tiene el bloque fijo o sus campos fallan.
 * @example
 * parseGPS(Uint8Array.from([
 *   12,95,9,0,59,26,133,0,110,204,158,8,9,26,13,37,33,0,9,1,111,223
 * ]));
 * // { instruccion: 12, maquina: 95, linea: 9, latitud: -38.73413,
 * //   longitud: -72.61342, fecha: '2026-09-08T13:37:33', velocidad: 0 }
 */
export function parseGPS(datos) {
  if (datos[0] !== 12) return null;
  if (datos.length === 3) return null; // ACK GPS; no contiene una posición.
  // El GATE también reenvía extensiones de distinta longitud. Solo se interpreta
  // el bloque fijo documentado; los bytes posteriores no se decodifican.
  if (datos.length < 22 || datos.length > 124) throw new Error('Bloque GPS incompleto o fuera de longitud');
  const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  const latitud = vista.getUint32(3, false) / -100000;
  const longitud = vista.getUint32(7, false) / -100000;
  const [dia, mes, aa, hora, minuto, compartido] = datos.subarray(11, 17);
  const segundo = compartido & 127;
  const anio = 2000 + aa;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, hora, minuto, segundo));
  if (aa > 99 || fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 ||
      fecha.getUTCDate() !== dia || hora > 23 || minuto > 59 || segundo > 59) {
    throw Object.assign(new Error('Fecha GPS fuera de rango'), {
      campos: { dia, mes, anio, hora, minuto, segundo }
    });
  }
  if (latitud < -90 || longitud < -180) {
    throw Object.assign(new Error('Coordenadas GPS fuera de rango'), {
      campos: { latitud_decodificada: latitud, longitud_decodificada: longitud,
        rango_latitud: '-90 a 90', rango_longitud: '-180 a 180', divisor_aplicado: -100000 }
    });
  }
  const dos = numero => String(numero).padStart(2, '0');
  return {
    instruccion: 12, maquina: datos[1], linea: datos[2], latitud, longitud,
    fecha: `${anio}-${dos(mes)}-${dos(dia)}T${dos(hora)}:${dos(minuto)}:${dos(segundo)}`,
    velocidad: datos[17]
  };
}

/**
 * Reconstruye mensajes completos a partir del stream TCP (PDF 1 a 4).
 * Una instancia pertenece a una sesión: pendiente conserva lo recibido cuando
 * todavía faltan bytes. No se asume que cada evento data contiene una trama.
 *
 * El receptor valida estructura e integridad. La interpretación de GPS se
 * delega al callback recibir(), de modo que el encuadre también sirve al LOGIN.
 * El formato antiguo sin Count no está implementado.
 *
 * @example
 * const receptor = new Receptor();
 * const trama = codificarTrama([200, 0]);
 * receptor.push(trama.subarray(0, 3), completa => console.log([...completa]));
 * // Aún no hay salida: faltan bytes.
 * receptor.push(trama.subarray(3), completa => console.log([...completa]));
 * // [124, 2, 200, 0, 253, 159]
 */
export class Receptor {
  /**
   * Fragmento pendiente de completar con la siguiente lectura.
   * @type {Buffer}
   */
  pendiente = Buffer.alloc(0);
  /**
   * Configura el perfil de integridad y el destino de diagnósticos.
   * @param {Object} [opciones={}] - Configuración de esta sesión.
   * @param {PerfilCRC} [opciones.perfilCRC='gate'] - Variante de CRC.
   * @param {RegistrarEvento} [opciones.log=registrar] - Registro de incidencias.
   * @throws {Error} Si el perfil CRC no existe.
   */
  constructor({ perfilCRC = 'gate', log = registrar } = {}) {
    checksum(Buffer.from([124, 1, 0]), perfilCRC);
    this.perfilCRC = perfilCRC;
    this.log = log;
  }
  /**
   * Incorpora una lectura TCP y entrega cero, una o varias tramas completas.
   * Lee ID y Count, espera Count + 4 bytes, verifica CRC y llama a recibir().
   * Después continúa con los bytes restantes de esa misma lectura.
   *
   * Si detecta corrupción, avanza buscando otra cabecera. Una candidata aún
   * incompleta queda pendiente hasta recibir más bytes: la recuperación no
   * garantiza identificar inmediatamente cualquier stream arbitrario dañado.
   * Se admite como excepción la confirmación literal publicada en el PDF.
   *
   * @param {Uint8Array} chunk - Bytes nuevos del manejador data de Bun.
   * @param {function(Buffer): void} recibir - Callback por cada trama aceptada.
   * @returns {void} El resultado se entrega al callback, no mediante return.
   */
  push(chunk, recibir) {
    const buffer = Buffer.concat([this.pendiente, chunk]);
    let offset = 0;
    while (offset < buffer.length) {
      if (![123, 124].includes(buffer[offset])) {
        const inicio = offset++;
        while (offset < buffer.length && ![123, 124].includes(buffer[offset])) offset++;
        this.log('bytes_descartados', { cantidad: offset - inicio });
        continue;
      }
      if (buffer.length - offset < 2) break;
      const total = buffer[offset + 1] + 4;
      if (total < 5 || total > 128) {
        this.log('count_invalido', { count: buffer[offset + 1] });
        offset++;
        continue;
      }
      if (buffer.length - offset < total) break;
      const trama = buffer.subarray(offset, offset + total);
      const esperado = checksum(trama.subarray(0, -2), this.perfilCRC);
      const valido = trama[total - 2] === esperado[0] && trama[total - 1] === esperado[1];
      if (!valido && !trama.equals(CONFIRMACION_PDF)) {
        this.log('crc_invalido', { esperado, recibido: [...trama.subarray(-2)], perfil_crc: this.perfilCRC });
        offset++;
        continue;
      }
      offset += total;
      recibir(trama);
    }
    this.pendiente = Buffer.from(buffer.subarray(offset));
  }
}

/**
 * Crea el objeto de seguimiento de un cliente antes de conectarse.
 * Los contadores se acumulan entre reconexiones del mismo cliente. Una trama
 * de confirmación aumenta tramas_recibidas, pero no gps_recibidos.
 * "conectado" informa sobre TCP; no sustituye la recepción de GPS como evidencia.
 *
 * @param {number} [moduloId=6] - ID de sesión que se mostrará en el estado.
 * @param {PerfilCRC} [perfilCRC='gate'] - Perfil que se mostrará en el estado.
 * @returns {EstadoGate} Contadores a cero, estado detenido y ultimo_gps null.
 */
export function crearEstado(moduloId = 6, perfilCRC = 'gate') {
  return {
    servidor: `${MODUL_IP}:${MODUL_PORT}`, modulo_id: moduloId, perfil_crc: perfilCRC,
    estado: 'detenido', conectado: false, conexiones: 0, login_enviados: 0,
    bytes_recibidos: 0, tramas_recibidas: 0, gps_recibidos: 0,
    crc_invalidos: 0, gps_invalidos: 0, ultimo_gps: null
  };
}

/**
 * Prepara los OCHO CALLBACKS que Bun invoca durante una conexión TCP.
 * Un callback es una función que se entrega a otra API para que la ejecute
 * cuando ocurra algo. Bun llama a open, data, close, drain, error,
 * connectError, end y timeout; no es necesario llamarlos manualmente al operar.
 *
 * Cada llamada crea un Receptor y un LOGIN propios de esa sesión. Las opciones
 * emitir y log entregan los resultados a consola o al informe de recepción real.
 * Las funciones internas finalizar, fallar y vaciar comparten ese estado.
 *
 * @param {Object} [opciones={}] - Configuración y callbacks de la sesión.
 * @param {number} [opciones.moduloId=6] - ID para registrar este cliente.
 * @param {PerfilCRC} [opciones.perfilCRC='gate'] - Perfil CRC de envío y recepción.
 * @param {boolean} [opciones.debug=false] - Registrar los bytes TCP entrantes.
 * @param {EmitirGPS} [opciones.emitir] - Por defecto imprime JSON en stdout.
 * @param {RegistrarEvento} [opciones.log=registrar] - Por defecto usa stderr.
 * @param {EstadoGate} [opciones.estado] - Estado compartido o uno nuevo.
 * @param {Function} [opciones.alAbrir] - Avisa al coordinador qué socket se abrió.
 * @param {Function} [opciones.alCerrar] - Avisa que puede programar reconexión.
 * @param {function(): boolean} [opciones.estaActivo] - Evita procesar sesiones obsoletas.
 * @returns {Object} Objeto socket con los ocho manejadores requeridos por Bun.
 * @throws {Error} Si no se puede construir el LOGIN por configuración inválida.
 * @see iniciarCliente
 */
export function crearManejadores({
  moduloId = 6, perfilCRC = 'gate', debug = false,
  emitir = crearSalidaGPS(), log = registrar,
  estado = crearEstado(moduloId, perfilCRC), alAbrir = () => {}, alCerrar = () => {},
  estaActivo = () => true
} = {}) {
  const login = crearLogin(moduloId, perfilCRC);
  const receptor = new Receptor({ perfilCRC, log(evento, detalle) {
    if (evento === 'crc_invalido') estado.crc_invalidos++;
    log(evento, detalle);
  } });
  let pendiente = null, loginSolicitado = false, cerrado = false, plazoRegistro;
  /**
   * Limpia esta sesión una sola vez aunque lleguen varios eventos de cierre.
   * No envía una instrucción de protocolo: cancela temporizadores y buffers,
   * actualiza el estado y avisa al coordinador mediante alCerrar().
   * @private
   * @returns {void}
   */
  function finalizar() {
    if (cerrado) return;
    cerrado = true;
    clearTimeout(plazoRegistro);
    pendiente = null;
    receptor.pendiente = Buffer.alloc(0);
    estado.conectado = false;
    if (estado.estado !== 'detenido') estado.estado = 'desconectado';
    alCerrar();
  }
  /**
   * Registra un error del socket, termina la conexión y limpia la sesión.
   * @private
   * @param {Object} socket - Socket TCP nativo de Bun.
   * @param {*} error - Error comunicado por Bun o por una escritura.
   * @returns {void}
   */
  function fallar(socket, error) {
    log('error_socket', { mensaje: String(error) });
    socket.terminate();
    finalizar();
  }
  /**
   * Intenta transmitir los bytes del LOGIN que aún están pendientes.
   * socket.write() devuelve cuántos bytes aceptó; puede ser menos del total.
   * Se conserva el resto para drain. -1 significa que el socket está cerrado.
   * Al completar la escritura registra login_enviado, no un ACK del servidor.
   *
   * @private
   * @param {Object} socket - Socket de Bun usado para escribir el LOGIN.
   * @returns {void}
   * @throws {Error} Si socket.write() indica una conexión cerrada.
   */
  function vaciar(socket) {
    if (!pendiente?.length || cerrado) return;
    const cantidad = socket.write(pendiente);
    if (cantidad < 0) throw new Error('Socket cerrado durante LOGIN');
    pendiente = pendiente.subarray(cantidad);
    if (!pendiente.length) {
      estado.login_enviados++;
      estado.estado = 'login_enviado';
      log('login_enviado', { modulo_id: moduloId, filtros: [12, 104], bytes: [...login] });
    }
  }
  return {
    /**
     * Evento 1/8: TCP se abrió; todavía se espera la confirmación del GATE.
     * PDF 8 establece que GATE habla primero. Se arma un plazo de 10 segundos
     * para ese saludo y un timeout de inactividad TCP de 120 segundos.
     * @param {Object} socket - Socket recién conectado.
     * @returns {void}
     */
    open(socket) {
      if (!estaActivo()) { socket.terminate(); return; }
      estado.conectado = true;
      estado.conexiones++;
      estado.estado = 'esperando_confirmacion';
      socket.timeout(120);
      alAbrir(socket);
      log('conexion_abierta', { servidor: estado.servidor, modulo_id: moduloId });
      // El protocolo de módulos inicia con la confirmación del GATE.
      plazoRegistro = setTimeout(() => {
        log('timeout_registro', { segundos: 10 });
        socket.terminate();
        finalizar();
      }, 10000);
    },
    /**
     * Evento 2/8: Bun entregó bytes. Aquí el protocolo produce datos útiles.
     * 1) Receptor.push() completa y comprueba las tramas (PDF 1 a 4).
     * 2) subarray(2, -2) retira ID, Count y CRC, dejando Datos (PDF 5).
     * 3) Datos [200, 0] activan el LOGIN con filtros 12 y 104 (PDF 8).
     * 4) La instrucción 104 se registra como diagnóstico de módulo.
     * 5) parseGPS() convierte instrucción 12 en una posición (PDF 6.2).
     * 6) Se agrega modulo_id desde la sesión y emitir() entrega el JSON.
     *
     * El origen máquina/línea viene del GPS, no del ID de módulo. Los registros
     * inválidos se contabilizan y descartan; el procesamiento continúa.
     * @param {Object} socket - Socket que recibió los bytes.
     * @param {Uint8Array} bytes - Fragmento del stream, no necesariamente una trama.
     * @returns {void}
     */
    data(socket, bytes) {
      if (cerrado || !estaActivo()) return;
      socket.timeout(120);
      estado.bytes_recibidos += bytes.length;
      if (debug) log('tcp_rx', { bytes: [...bytes] });
      receptor.push(bytes, trama => {
        if (cerrado || !estaActivo()) return;
        estado.tramas_recibidas++;
        const datos = trama.subarray(2, -2);
        if (datos.length === 2 && datos[0] === 200 && datos[1] === 0) {
          if (!loginSolicitado) {
            loginSolicitado = true;
            clearTimeout(plazoRegistro);
            pendiente = Buffer.from(login);
            try { vaciar(socket); } catch (error) { fallar(socket, error); }
          }
          return;
        }
        if (datos[0] === 104) {
          log('error_modulo_gate', { modulo_id: moduloId, instruccion: 104, datos: [...datos.subarray(1)] });
          return;
        }
        let gps;
        try { gps = parseGPS(datos); }
        catch (error) {
          estado.gps_invalidos++;
          log('gps_invalido', {
            modulo_id: moduloId, instruccion: datos[0], maquina: datos[1], linea: datos[2],
            mensaje: error.message, longitud_bytes: datos.length,
            campos_invalidos: error.campos ?? null,
            datos_decimales: [...datos].join('-')
          });
          return;
        }
        if (gps) {
          // ...gps copia los campos decodificados; modulo_id identifica al receptor.
          const posicion = { modulo_id: moduloId, ...gps };
          estado.gps_recibidos++;
          estado.ultimo_gps = posicion;
          estado.estado = 'recibiendo_gps';
          // crearSalidaGPS serializa este objeto como JSON; no modifica sus valores.
          emitir(posicion);
        }
      });
    },
    /**
     * Evento 3/8: el socket vuelve a poder aceptar bytes de salida.
     * Continúa una escritura parcial del LOGIN; no solicita una posición nueva.
     * @param {Object} socket - Socket disponible para escribir.
     * @returns {void}
     */
    drain(socket) { try { vaciar(socket); } catch (error) { fallar(socket, error); } },
    /**
     * Evento 4/8: la conexión terminó. Limpia y permite programar el reintento.
     * @param {Object} socket - Socket cerrado.
     * @param {*} error - Información de cierre suministrada por Bun, si existe.
     * @returns {void}
     */
    close(socket, error) { log('conexion_cerrada', { detalle: String(error ?? '') }); finalizar(); },
    /**
     * Evento 5/8: error operativo de una conexión; delega a fallar().
     * @param {Object} socket - Socket afectado.
     * @param {*} error - Error de transporte.
     * @returns {void}
     */
    error(socket, error) { fallar(socket, error); },
    /**
     * Evento 6/8: falló el intento de conexión antes de establecer la sesión.
     * Se informa al coordinador para que vuelva a intentar conectar.
     * @param {Object} socket - Socket del intento fallido.
     * @param {*} error - Causa comunicada por Bun.
     * @returns {void}
     */
    connectError(socket, error) { log('conexion_fallida', { mensaje: String(error) }); finalizar(); },
    /**
     * Evento 7/8: el extremo remoto terminó su envío.
     * Informa si quedó una trama parcial y cierra el extremo local.
     * @param {Object} socket - Socket cuyo extremo remoto terminó.
     * @returns {void}
     */
    end(socket) {
      if (receptor.pendiente.length) log('trama_incompleta', { bytes: receptor.pendiente.length });
      log('fin_remoto'); socket.end(); finalizar();
    },
    /**
     * Evento 8/8: venció el timeout del socket. Termina y habilita reconexión.
     * Este evento pertenece a Bun; el plazo del saludo usa otro temporizador.
     * @param {Object} socket - Socket que agotó su tiempo de inactividad.
     * @returns {void}
     */
    timeout(socket) { log('timeout_socket'); socket.terminate(); finalizar(); }
  };
}

/**
 * Inicia y coordina la conexión persistente del módulo: PDF, sección 8.
 * Prepara estado, crea manejadores y llama a Bun.connect con IP y puerto fijos.
 * Retorna enseguida un control; la apertura y recepción ocurren después mediante
 * Promises y callbacks. Retornar este control no significa estar conectado.
 *
 * La reconexión es una decisión de la aplicación, no una instrucción del PDF.
 * Ante fallos consecutivos se esperan 1, 2, 4, 8... segundos, hasta 30.
 * Abrir una nueva conexión restablece el contador de espera.
 *
 * @param {Object} [opciones={}] - Configuración del cliente persistente.
 * @param {number} [opciones.moduloId=6] - Identidad usada en el LOGIN.
 * @param {PerfilCRC} [opciones.perfilCRC='gate'] - Perfil CRC.
 * @param {boolean} [opciones.debug=false] - Registro opcional de bytes.
 * @param {string} [opciones.formatoSalida='auto'] - Presentación auto, pretty o ndjson.
 * @param {EmitirGPS} [opciones.emitir] - Salida de posiciones, por defecto consola.
 * @param {RegistrarEvento} [opciones.log=registrar] - Salida de diagnósticos.
 * @returns {{estado: EstadoGate, detener: Function}} Estado vivo y método de cierre.
 * @throws {Error} Si la configuración impide construir el LOGIN.
 * @example
 * // Uso real: abre una sesión. Ejecutar una sola instancia por ID.
 * const cliente = iniciarCliente();
 * // Más tarde, cuando se desea detener la recepción:
 * cliente.detener();
 */
export function iniciarCliente({
  moduloId = 6, perfilCRC = 'gate', debug = false, formatoSalida = 'auto',
  emitir = crearSalidaGPS(formatoSalida), log = registrar
} = {}) {
  const demoraBase = 1000;
  crearLogin(moduloId, perfilCRC);
  const estado = crearEstado(moduloId, perfilCRC);
  app.locals.gate = estado;
  let detenido = false, socketActivo, temporizador, reintentos = 0;
  /**
   * Programa un único reintento con espera creciente y límite de 30 segundos.
   * No vuelve a conectar si detener() ya canceló el cliente.
   * @private
   * @returns {void}
   */
  function reconectar() {
    if (detenido || temporizador) return;
    const demora = Math.min(demoraBase * 2 ** Math.min(reintentos++, 5), 30000);
    estado.estado = 'esperando_reconexion';
    log('reconexion_programada', { demora_ms: demora });
    temporizador = setTimeout(() => { temporizador = null; conectar(); }, demora);
  }
  /**
   * Crea una sesión nueva e inicia la Promise de conexión TCP.
   * Cada intento tiene su propio indicador finalizada para evitar que un error
   * y un cierre de la misma sesión programen dos reconexiones.
   * @private
   * @returns {void}
   */
  function conectar() {
    if (detenido) return;
    estado.estado = 'conectando';
    let finalizada = false;
    /**
     * Finaliza el intento a nivel del coordinador y habilita una reconexión.
     * Es distinto de finalizar() dentro de crearManejadores, que limpia buffers.
     * @private
     * @returns {void}
     */
    const finalizar = () => {
      if (finalizada) return;
      finalizada = true;
      socketActivo = null;
      reconectar();
    };
    const manejadores = crearManejadores({
      moduloId, perfilCRC, debug, estado, log, emitir,
      /**
       * Conserva el socket activo para poder detenerlo y restablece la espera.
       * @param {Object} socket - Socket recién abierto por Bun.
       * @returns {void}
       */
      alAbrir(socket) {
        if (detenido) { socket.terminate(); return; }
        socketActivo = socket;
        reintentos = 0;
      },
      alCerrar: finalizar,
      estaActivo: () => !detenido && !finalizada
    });
    Promise.resolve().then(() => detenido ? null : Bun.connect({ hostname: MODUL_IP, port: MODUL_PORT, socket: manejadores }))
      .then(socket => { if (!socket) return; if (detenido || finalizada) socket.terminate(); else socketActivo = socket; })
      .catch(error => {
        if (!finalizada) { log('conexion_fallida', { mensaje: String(error) }); finalizar(); }
      });
  }
  conectar();
  return {
    estado,
    /**
     * Detiene este cliente y cancela sus reintentos. El cierre es local;
     * no se inventa una trama LOGOUT no descrita en el PDF.
     * @returns {void}
     */
    detener() {
      detenido = true;
      clearTimeout(temporizador);
      temporizador = null;
      estado.estado = 'detenido';
      estado.conectado = false;
      socketActivo?.terminate();
    }
  };
}

/**
 * Punto de entrada del programa al ejecutar "bun start" o "bun run modulo.js".
 * import.meta.main es false cuando verificar-gate.js importa este archivo;
 * así, la verificación controla el inicio y el cierre de su propia sesión real.
 * SIGINT (Ctrl+C) y SIGTERM detienen el cliente antes de terminar el proceso.
 * Los comentarios JSDoc explican el programa, pero no se ejecutan.
 */
if (import.meta.main) {
  try {
    const cliente = iniciarCliente(leerConfiguracion());
    const detener = () => { cliente.detener(); process.exit(0); };
    process.once('SIGINT', detener);
    process.once('SIGTERM', detener);
  } catch (error) { registrar('configuracion_invalida', { mensaje: String(error) }); process.exitCode = 1; }
}
