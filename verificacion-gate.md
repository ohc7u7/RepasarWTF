# Verificación real del receptor de 30 líneas

Observación: 2026-09-09T14:45:11.550214+00:00 a 2026-09-09T14:45:26.595275+00:00.

Servidor: **192.168.0.8:9067**. Módulo receptor: **6**.

| Indicador | Resultado |
| --- | --- |
| Posiciones GPS recibidas y guardadas | 301 |
| Duración de observación | 15 segundos |
| Errores CRC | 0 |
| Registros GPS rechazados | 2 |

La comprobación ejecutó directamente `bun run modulo.js` y capturó su salida. El proceso de comprobación cerró esa conexión a los 15 segundos. El programa de la actividad mantiene la recepción hasta Ctrl+C, cierre remoto o error.

Todas las posiciones observadas están en `verificacion-gate.json`. La huella identifica el archivo de 30 líneas que produjo esta salida:

```text
39a299d8b0b5c595759c22c812c28494cb18367a56eef982c51a58ca5246510b
```

## Registros rechazados

- Máquina **3**, línea **7**: latitud `-387.29084`, longitud `-725.8086`, fecha `2026-09-09T14:45:18`.
- Máquina **126**, línea **3**: latitud `-387.36385`, longitud `-725.89171`, fecha `2026-09-09T14:45:23`.

Esas coordenadas exceden el rango geográfico al aplicar el divisor documentado de -100000. Se descartaron esas posiciones y continuó la lectura del stream.

Para observar de nuevo los datos en la consola: `bun start`. Los informes son documentos de evidencia; no se generan automáticamente durante la ejecución normal.
