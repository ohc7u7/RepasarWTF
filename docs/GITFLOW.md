# Flujo Git de la actividad

La versión actual utiliza NestJS y Bun y se publica únicamente en **wea**. Esta rama cumple el papel de rama de funcionalidad, conservando el nombre solicitado. La integración en **develop** queda a cargo del responsable; **main** queda fuera de esta entrega.

El remoto estaba vacío al comenzar. La base local de `develop` es el commit `e45016802c5b61c7d96c861993b7d96ca0aeb22a`. Las versiones anteriores permanecen en el historial.

## Convención de commits

Los mensajes usan `tipo(alcance): descripción`, con un cuerpo que explica propósito y validación.

| Revisión actual | Responsabilidad |
| --- | --- |
| `feat(nest): migrate GATE receiver to standalone NestJS` | Dependencias, proveedor único, configuración de registro y origen GPS. |
| `docs(nest): document protocol identities and live GPS evidence` | Ejecución, explicación del protocolo y evidencia real de la migración. |

## Revisar la rama

```powershell
git clone --branch wea https://github.com/ohc7u7/RepasarWTF.git
Set-Location -LiteralPath 'RepasarWTF'
bun install --frozen-lockfile
$env:GATE_MODULO_ID = '6'
bun start
```

Definir `GATE_MODULO_ID` según el ID de cliente asignado; 6 es el valor utilizado en la observación registrada. La copia `modulo-sin-comentarios.js.txt` es de consulta; el único comando de inicio ejecuta `modulo.js`.

## Preparar develop e integrar

Comprobar primero si la rama remota ya existe:

```powershell
git fetch origin
git ls-remote --heads origin develop
```

Si aún no existe, desde la carpeta original la base local ya está preparada y el responsable puede publicarla con `git push -u origin develop`. En una copia nueva debe crearla primero con:

```powershell
git branch develop e45016802c5b61c7d96c861993b7d96ca0aeb22a
git push -u origin develop
```

Si `origin/develop` ya existe, revisar esa rama; no reemplazarla ni forzar el push. Crear luego un pull request con **base develop** y **compare wea**, usando un merge commit para conservar los commits por responsabilidad.

## Evidencia

[verificacion-nest-gate.json](../verificacion-nest-gate.json) contiene la observación de la versión NestJS y la huella SHA-256 de su fuente. Una modificación del código requiere una nueva observación para acreditar esa revisión.

Se excluyen de Git `.env`, dependencias instaladas, temporales y logs. Las posiciones incluidas en la evidencia proceden del GATE real.
