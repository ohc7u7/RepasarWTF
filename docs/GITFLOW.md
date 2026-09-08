# Flujo Git de la entrega

La actividad se entrega en la rama **`wea`**, con commits organizados por responsabilidad y mensajes Conventional Commits. Esta rama cumple la función de una rama de funcionalidad en Gitflow; conserva el nombre solicitado para la actividad.

El repositorio remoto estaba vacío al preparar la entrega: no existían `develop` ni `main`. Se creó una base **local** en `develop` y, desde ella, la rama `wea`. Solo se publica `wea`; la creación remota de `develop` y el merge quedan a cargo del responsable del repositorio.

## Ramas y base común

| Referencia | Propósito |
| --- | --- |
| `develop` local | Commit base con configuración de Bun, dependencia Express y reglas de Git. |
| `wea` / `origin/wea` | Implementación completa, verificación del stream real, evidencia y documentación. |
| `main` | No se crea, modifica ni publica durante esta entrega. |

Commit base: `e45016802c5b61c7d96c861993b7d96ca0aeb22a`.

```text
e450168  base local de develop
   |
   +-- feat(gate) -- feat(verification) -- feat(delivery)
       -- docs(evidence) -- docs(project)  [wea]
```

## Commits de la actividad

El formato utilizado es `tipo(alcance): descripción`. El cuerpo de cada commit explica su propósito.

| Commit | Contenido |
| --- | --- |
| `chore(project): initialize Bun and Express workspace` | Dependencias, archivo de bloqueo y exclusión de archivos generados. |
| `feat(gate): receive and decode live GPS telemetry` | Conexión TCP nativa, LOGIN, filtros, CRC, decodificación y salida JSON. |
| `feat(verification): capture complete GPS reports from GATE` | Observación real de 15 segundos, todas las posiciones y diagnósticos legibles. |
| `feat(delivery): generate schema-validated activity report` | Generador del entregable y esquema de validación. |
| `docs(evidence): record live GATE stream verification` | Evidencia de recepción y entregable correspondiente al código verificado. |
| `docs(project): document GATE protocol and Gitflow integration` | Ejecución, guía del protocolo y procedimiento de integración. |

No se incluyen dependencias instaladas, archivos temporales, logs ni archivos de simulación. Las posiciones de `verificacion-gate.json` proceden de la sesión real registrada en el propio informe.

## Revisar la entrega

Desde una copia nueva:

```powershell
git clone --branch wea https://github.com/ohc7u7/RepasarWTF.git
Set-Location -LiteralPath 'RepasarWTF'
git log --oneline --decorate
bun install --frozen-lockfile
```

Con acceso de red al servidor `192.168.0.8:9067`, ejecutar una sola instancia:

```powershell
bun run verify:gate
```

Este comando conecta al GATE y reemplaza los informes de verificación con una nueva observación. Para recibir continuamente, ejecutar `bun start`. Consultar el [README](../README.md) para los detalles del funcionamiento.

## Crear develop en el remoto

Estos pasos los realiza el responsable de la integración. Primero comprobar si alguien ya creó la rama:

```powershell
git fetch origin
git ls-remote --heads origin develop
```

Si no aparece una referencia, publicar la base. En la carpeta original de la actividad, la rama local `develop` ya está preparada:

```powershell
git push -u origin develop
```

En una copia nueva, crear primero la rama local desde el commit base y publicarla:

```powershell
git branch develop e45016802c5b61c7d96c861993b7d96ca0aeb22a
git push -u origin develop
```

Si `origin/develop` ya existe, utilizar esa rama y revisar sus cambios antes de integrar. No reemplazarla por la base ni forzar el push.

## Integrar wea en develop

Una vez que ambas ramas estén publicadas, crear un pull request en GitHub con:

- **Base:** `develop`.
- **Compare:** `wea`.
- **Método de integración:** `Create a merge commit`, para conservar los commits por responsabilidad.

Como alternativa, si se continúa desde la base recién publicada y el árbol de trabajo está limpio, el responsable puede integrar mediante Git:

```powershell
git fetch origin
git switch develop
git pull --ff-only origin develop
git merge --no-ff origin/wea -m "chore(release): integrate GATE activity into develop"
git push origin develop
```

La integración en `main` queda fuera del alcance de esta entrega.

## Conservación de la evidencia

El informe incluye la huella SHA-256 de `modulo.js`. `.gitattributes` preserva los bytes de los archivos JavaScript al clonar, para que un cambio automático de finales de línea no invalide esa referencia. Si se modifica el receptor, ejecutar nuevamente la verificación real y regenerar el entregable antes de registrar nuevas evidencias.
