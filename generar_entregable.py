import hashlib
import json
from pathlib import Path
from jsonschema import validate

root = Path(__file__).resolve().parent
fuente_bytes = (root / 'modulo.js').read_bytes()
fuente_sha = hashlib.sha256(fuente_bytes).hexdigest()

def evidencia(nombre):
    ruta = root / nombre
    return json.loads(ruta.read_text(encoding='utf-8-sig')) if ruta.exists() else {}

real = evidencia('verificacion-gate.json')
real_vigente = real.get('fuente_sha256') == fuente_sha
completo = (real_vigente and real.get('gps_recibidos', 0) > 0
            and real.get('posiciones_guardadas') == real.get('gps_recibidos')
            and len(real.get('posiciones', [])) == real.get('gps_recibidos'))

supuestos = [
    'Ejecutar bun install y bun start. Bun.connect conecta exclusivamente a 192.168.0.8:9067. Express conserva el estado en app.locals.gate, sin HTTP ni visualizacion.',
    '12-100-8 es una trama de referencia del PDF. Se reciben todas las instrucciones 12 con maquina y linea dinamicas. modulo_id procede de la configuracion de la sesion, no de un campo destinatario del GPS.',
    'Perfil gate predeterminado, corroborado con el servidor real: polinomio 0x1021, inicio 0x0000, sin reflexion ni XOR final, aplicado solo a Datos y transmitido bajo/alto. LOGIN para modulo 6: 124-5-200-6-2-12-104-175-208.',
    'CCITT-FALSE, suministrado inicialmente por el usuario, se conserva como opcion GATE_CRC_PROFILE=ccitt-false; no es el CRC del servidor comprobado. La confirmacion literal del PDF se reconoce como excepcion de compatibilidad.',
    'El LOGIN se envia una vez por conexion, al recibir la confirmacion del GATE. Los filtros son 12 y 104. Se gestionan escrituras parciales, fragmentacion, concatenacion y reconexion automatica con demora de 1 a 30 segundos.',
    'Coordenadas como magnitudes de 32 bits big-endian divididas por -100000; anio = 2000 + aa; segundos = byte & 127. Fecha sin zona horaria y velocidad sin conversion porque esos metadatos no estan especificados.',
    'Se exige el bloque fijo de 22 bytes y se ignoran las extensiones posteriores. Coordenadas o fechas fuera de rango se registran y descartan; no se inventan escalas alternativas para equipos con formatos distintos.',
    'stdout contiene posiciones JSON: GATE_OUTPUT=pretty muestra un campo por linea, ndjson un objeto por linea y auto selecciona segun terminal o redireccion. stderr contiene diagnosticos. Tiempo real significa procesar el stream al recibirlo: las fechas GPS pueden corresponder a posiciones acumuladas por el origen.',
    'verificar-gate.js guarda todas las posiciones de la observacion en verificacion-gate.json y un resumen legible en verificacion-gate.md. La documentacion JSDoc y docs/GUIA_MODULO.md explican las ocho secciones del PDF, los ocho eventos TCP y el origen del byte de velocidad.',
    'Fuentes: Detalle de Tramas de GATE (documento proporcionado para la actividad), recepcion real registrada en verificacion-gate.json y [API TCP de Bun](https://bun.sh/docs/runtime/networking/tcp).'
]
if real_vigente:
    supuestos.append(f"Verificacion real {real.get('inicio')} a {real.get('fin')}: {real.get('gps_recibidos')} posiciones, {real.get('crc_invalidos')} CRC invalidos y {real.get('gps_invalidos')} registros GPS rechazados. Evidencia: verificacion-gate.json.")
else:
    supuestos.append('Falta evidencia de conexion real vigente para esta revision del codigo.')

result = {
    'codigo_fuente_bun': fuente_bytes.decode('utf-8-sig'),
    'explicacion_decodificacion': 'Receptor de ID, Count, Datos y CRC. Para instruccion 12 se obtienen maquina y linea de los offsets 1 y 2, latitud de 3..6, longitud de 7..10, fecha de 11..16 y velocidad de 17. Las coordenadas se dividen por -100000 y el segundo se obtiene con & 127. Cada JSON incluye modulo_id, instruccion, maquina, linea, latitud, longitud, fecha y velocidad.',
    'supuestos_tecnicos': supuestos,
    'next_action': 'done' if completo else 'ask'
}
validate(result, evidencia('esquema_modulo_v1.json'))
(root / 'entregable_modulo_v1.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'esquema': 'valido', 'evidencia_real_vigente': real_vigente,
                  'next_action': result['next_action']}))
