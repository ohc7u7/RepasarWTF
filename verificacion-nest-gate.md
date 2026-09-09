# Verificación real de NestJS + Bun

Observación: 2026-09-09T16:03:53.235237+00:00 a 2026-09-09T16:04:08.288021+00:00.

Servidor: **192.168.0.8:9067**. ID usado para registrar este cliente: **6**.

| Indicador | Resultado |
| --- | --- |
| Posiciones GPS recibidas y guardadas | 490 |
| Combinaciones máquina/línea | 451 |
| Duración máxima de observación | 15 segundos |
| Errores CRC | 0 |
| GPS rechazados por coordenadas inválidas | 3 |

Se ejecutó `bun run modulo.js`: Nest creó el proveedor GATE_TCP, que abrió la conexión real mediante Bun.connect. Se guardó la salida completa y se cerró el proceso de observación a los 15 segundos.

## Identificación

`modulo_receptor_id` es configuración de esta conexión. Máquina y línea proceden de cada GPS. `modulo_origen_id: null` indica que la instrucción 12 no contiene el ID de otro módulo; no se asignaron IDs ficticios a las posiciones.

Una posición de la observación:

```json
{
  "modulo_receptor_id": 6,
  "modulo_origen_id": null,
  "instruccion": 12,
  "maquina": 28,
  "linea": 7,
  "latitud": -38.71356,
  "longitud": -72.64507,
  "fecha": "2026-09-09T13:03:51",
  "velocidad": 0
}
```

## Registros rechazados

- Máquina **86**, línea **1**: latitud `-387.46734` y longitud `-726.43844`; fecha `2026-09-09T16:03:54`.
- Máquina **126**, línea **3**: latitud `-387.07604` y longitud `-726.39229`; fecha `2026-09-09T16:03:55`.
- Máquina **27**, línea **8**: latitud `-387.71459` y longitud `-725.83642`; fecha `2026-09-09T16:03:57`.

Al aplicar el divisor documentado -100000, esas coordenadas exceden los rangos geográficos. La recepción de las demás posiciones continuó.

## Código observado

SHA-256 de modulo.js:

```text
fd8e68d029463ebe37c27c57a8f3422c00611af0b26f1af41f45d45e99c48abe
```

También se comprobó que el ID ausente produce salida 1 antes de abrir TCP, que importar el archivo no inicia una conexión y que la copia de consulta contiene las mismas 30 líneas de lógica.

Los archivos verificacion-nest-gate.json y verificacion-nest-gate.md documentan esta ejecución; el receptor no los genera automáticamente.
