import { iniciarCliente, leerConfiguracion, registrar } from './modulo.js';
import { createHash } from 'node:crypto';

/**
 * Construye el informe completo. "posiciones" contiene todos los registros
 * válidos de la observación, no una selección de cinco muestras.
 * @param {Object} observacion - Fechas, huella, estado, posiciones y errores.
 * @returns {Object} Informe serializable con resumen por máquina y línea.
 */
export function crearInforme({ inicio, fin, fuente_sha256, estado, posiciones, errores }) {
  const origenes = new Map();
  for (const posicion of posiciones) {
    const clave = `${posicion.maquina}/${posicion.linea}`;
    if (!origenes.has(clave)) origenes.set(clave, { maquina: posicion.maquina, linea: posicion.linea, posiciones: 0 });
    origenes.get(clave).posiciones++;
  }
  return {
    inicio, fin, fuente_sha256,
    resultado: estado.gps_recibidos > 0 ? 'gps_recibidos' : 'sin_gps',
    ...estado,
    estado_corresponde_a: 'Instante anterior al cierre de la verificación',
    conexion_cerrada_al_finalizar: true,
    posiciones_guardadas: posiciones.length,
    origenes_distintos: origenes.size,
    resumen_por_origen: [...origenes.values()].sort((a, b) => a.linea - b.linea || a.maquina - b.maquina),
    errores,
    posiciones
  };
}

/**
 * Produce un resumen Markdown para leer el diagnóstico sin recorrer cientos
 * de objetos GPS. La lista completa permanece en verificacion-gate.json.
 * @param {Object} informe - Resultado de crearInforme().
 * @returns {string} Documento de texto legible.
 */
export function resumirInforme(informe) {
  const texto = [
    '# Verificación del receptor GATE', '',
    `Observación: ${informe.inicio} a ${informe.fin}.`, '',
    `Servidor: ${informe.servidor}. Módulo receptor: ${informe.modulo_id}.`, '',
    '| Indicador | Resultado |', '| --- | --- |',
    `| Posiciones GPS recibidas | ${informe.gps_recibidos} |`,
    `| Posiciones guardadas | ${informe.posiciones_guardadas} |`,
    `| Combinaciones de máquina/línea | ${informe.origenes_distintos} |`,
    `| Tramas recibidas | ${informe.tramas_recibidas} |`,
    `| Errores CRC | ${informe.crc_invalidos} |`,
    `| Registros GPS rechazados | ${informe.gps_invalidos} |`, '',
    'Todas las posiciones válidas están en el campo `posiciones` de `verificacion-gate.json`.', '',
    'La conexión se cierra al terminar; el estado del informe corresponde al instante previo al cierre.', '',
    '## Errores', ''
  ];
  if (!informe.errores.length) texto.push('No se registraron errores durante esta observación.', '');
  for (const [indice, error] of informe.errores.entries()) {
    texto.push(`### ${indice + 1}. ${error.evento}`, '');
    if (error.maquina !== undefined) texto.push(`Máquina **${error.maquina}**, línea **${error.linea}**.`, '');
    if (error.mensaje) texto.push(error.mensaje, '');
    if (error.longitud_bytes !== undefined) texto.push(`Tamaño del bloque de datos: ${error.longitud_bytes} bytes.`, '');
    if (error.campos_invalidos) texto.push('Valores que produjo la decodificación:', '', '```json', JSON.stringify(error.campos_invalidos, null, 2), '```', '');
    if (error.esperado) texto.push(`CRC esperado: ${error.esperado.join('-')}; recibido: ${error.recibido.join('-')}.`, '');
    if (error.datos_decimales) texto.push('Bytes originales, en orden decimal:', '', '```text', error.datos_decimales, '```', '');
  }
  texto.push('## Posiciones por origen', '', '| Máquina | Línea | Posiciones |', '| --- | --- | --- |');
  for (const origen of informe.resumen_por_origen) texto.push(`| ${origen.maquina} | ${origen.linea} | ${origen.posiciones} |`);
  return texto.join('\n') + '\n';
}

/** Ejecuta una observación de 15 segundos usando el mismo cliente de producción. */
export async function verificarGate() {
  const inicio = new Date().toISOString();
  const fuente = await Bun.file(new URL('./modulo.js', import.meta.url)).arrayBuffer();
  const fuente_sha256 = createHash('sha256').update(new Uint8Array(fuente)).digest('hex');
  const posiciones = [], errores = [];
  let cliente;
  try {
    cliente = iniciarCliente({
      ...leerConfiguracion(),
      emitir: posicion => posiciones.push(posicion),
      log(evento, detalle = {}) {
        if (['conexion_fallida', 'crc_invalido', 'gps_invalido', 'timeout_registro', 'timeout_socket', 'error_socket', 'error_modulo_gate'].includes(evento)) {
          errores.push({ fecha: new Date().toISOString(), evento, ...detalle });
        }
        registrar(evento, detalle);
      }
    });
    await new Promise(resolve => setTimeout(resolve, 15000));
    const estado = { ...cliente.estado };
    cliente.detener();
    const resultado = crearInforme({ inicio, fin: new Date().toISOString(), fuente_sha256, estado, posiciones, errores });
    await Bun.write(new URL('./verificacion-gate.json', import.meta.url), JSON.stringify(resultado, null, 2) + '\n');
    await Bun.write(new URL('./verificacion-gate.md', import.meta.url), resumirInforme(resultado));
    registrar('verificacion_finalizada', {
      resultado: resultado.resultado, gps_recibidos: estado.gps_recibidos,
      posiciones_guardadas: posiciones.length, origenes_distintos: resultado.origenes_distintos,
      crc_invalidos: estado.crc_invalidos, gps_invalidos: estado.gps_invalidos,
      informe: 'verificacion-gate.json', resumen: 'verificacion-gate.md'
    });
    return estado.gps_recibidos > 0 ? 0 : 1;
  } finally {
    cliente?.detener();
  }
}

if (import.meta.main) {
  try { process.exit(await verificarGate()); }
  catch (error) { registrar('verificacion_fallida', { mensaje: String(error) }); process.exit(1); }
}
