# Verificación del receptor de 30 líneas

Observación: 2026-09-09T16:45:52.532823+00:00 a 2026-09-09T16:46:07.568566+00:00.

Servidor: **192.168.0.8:9067**. ID_MODULO usado: **6**.

| Indicador | Resultado |
| --- | --- |
| Líneas físicas de modulo.js | 30 |
| Posiciones GPS recibidas y guardadas | 484 |
| Combinaciones máquina/línea | 442 |
| Duración máxima de observación | 15 segundos |
| Errores CRC | 0 |
| GPS rechazados por coordenadas inválidas | 4 |

Se ejecutó directamente `bun run modulo.js`, sin archivo .env. El ID está definido en ID_MODULO, en la línea 4, y la función connect se importa de bun. Nest gestiona el proveedor y el socket TCP recibe el stream real. Toda la lógica está en las 30 líneas de modulo.js.

La observación guardó todas las posiciones y cerró su proceso a los 15 segundos. La ejecución normal continúa hasta Ctrl+C, cierre remoto o error.

## Posición recibida

```json
{
  "modulo_receptor_id": 6,
  "modulo_origen_id": null,
  "instruccion": 12,
  "maquina": 42,
  "linea": 7,
  "latitud": -38.74172,
  "longitud": -72.59616,
  "fecha": "2026-09-09T13:45:51",
  "velocidad": 23
}
```

modulo_receptor_id identifica nuestro cliente. Máquina y línea proceden del stream; modulo_origen_id es null porque el GPS documentado no incluye otro ID de módulo.

## Registros rechazados

- Máquina **27**, línea **8**: latitud `-387.3655`, longitud `-725.8825`, fecha `2026-09-09T16:45:54`.
- Máquina **3**, línea **7**: latitud `-387.08591`, longitud `-726.65062`, fecha `2026-09-09T16:46:00`.
- Máquina **86**, línea **1**: latitud `-387.62229`, longitud `-726.90596`, fecha `2026-09-09T16:46:03`.
- Máquina **126**, línea **3**: latitud `-387.38916`, longitud `-725.87789`, fecha `2026-09-09T16:46:04`.

Esas coordenadas exceden el rango geográfico al aplicar el divisor documentado -100000. La recepción de las demás posiciones continuó.

## Fuente observada

SHA-256 de modulo.js:

```text
5cf014279819b08a0f81e2aa6869282ea94ab624d0b8996a13fa0e7f2a086a4a
```

Se verificó además que el archivo tiene exactamente 30 líneas, no contiene comentarios ni lee el ID del entorno, que importar el archivo no inicia TCP y que connect importado de bun es la misma función que Bun.connect.

Los informes documentan esta ejecución; el receptor no los genera automáticamente.
