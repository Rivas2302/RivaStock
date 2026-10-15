# Handoff para el modelo ejecutor

Este documento explica **cómo** trabajar. El **qué** está en [`TASKS.md`](TASKS.md) y el **por qué** en [`PLAN.md`](PLAN.md). Sirve para Claude, modelos de OpenAI u otros vía OpenCode.

## 1. Orden de lectura

1. `CLAUDE.md` de la raíz y cualquier `AGENTS.md` aplicable (a la fecha no existe ninguno en el repositorio).
2. `PLAN.md` §1 (terminado), §2.1 (hallazgos), §5.4 (decisiones D-A1…D-A6), §6 (garantías).
3. `TASKS.md`: convenciones, tablero, la tarea elegida completa y las últimas filas del registro.
4. Solo si la tarea lo pide: D1–D5 de `../facebook-extension-hardening-plan.md` y `../facebook-extension-release.md`.

No leas el repositorio entero. Leé los archivos y símbolos que nombra la tarea.

## 2. Verificar que el plan sigue vigente (antes de cada sesión)

```powershell
git status --short --branch
git log --oneline -8
```

- Si hay commits posteriores a `10bd4c3` que tocan `extensions/facebook/`, `supabase/migrations/006*`, `src/lib/facebook*` o `src/components/automations/`, leé su diff y comprobá que los símbolos de tu tarea siguen existiendo y con el comportamiento descrito.
- Si existe `supabase/migrations/0064_*` creado por otra persona, **no** lo sobrescribas: renumerá A04 a la siguiente libre y actualizá todas las referencias en `TASKS.md` y `PLAN.md`.
- Conservá cambios ajenos sin commitear (por ejemplo `.atl/*`). No los incluyas en tus commits.

## 3. Ciclo de trabajo

1. Elegí la primera tarea del tablero en `pendiente` cuyas dependencias estén `completada` y que tu rol pueda ejecutar. Si es de `usuario` o `[AUT]`, prepará lo necesario y pedilo (§6); no la simules.
2. Marcála `en curso` en el tablero y agregá una fila al registro.
3. Implementá **solo** su alcance. No cambies criterios de prueba para que pasen. No agregues abstracciones, flags ni refactors no pedidos.
4. Ejecutá exactamente la validación indicada. Guardá cantidades de pruebas, fallos y duración.
5. Si se cumplen todos los criterios de aceptación: `completada` con evidencia. Si no: dejala `en curso` o `bloqueada` y explicá por qué.
6. Continuá con la siguiente tarea desbloqueada mientras no haya un bloqueo.
7. Al cerrar la sesión, dejá el punto de reanudación (§7).

## 4. Discrepancias entre el plan y la realidad

Una discrepancia es cualquier hecho que contradiga el plan: un símbolo que no existe, un comportamiento distinto, un resultado de producción inesperado, una prueba que no puede escribirse como se describe.

1. **Registrala** en el registro de `TASKS.md`: qué dice el plan, qué observaste, evidencia (comando/archivo).
2. **Evaluá el impacto:** ¿afecta solo a esta tarea (detalle de implementación) o a una decisión de `PLAN.md` §5.4/§6, a un contrato entre componentes o a la seguridad frente a duplicados?
3. **Detalle local:** adaptá la implementación preservando la intención y el criterio de aceptación; anotalo.
4. **Decisión o contrato:** detené esa tarea y las que dependen de ella. Proponé la corrección del plan (una opción recomendada, con su tradeoff) y pedí confirmación con **una** pregunta. Seguí con tareas independientes.
5. Nunca tapes una discrepancia con una solución improvisada (relajar validaciones, aumentar timeouts, aceptar éxito por título o feed, borrar historial).

## 5. Procedimiento: hash del ZIP de un commit

Sirve para A07 y A11. Reemplazá `<commit>` y `<dir>` (carpeta vacía fuera del repo).

```bash
git -c core.autocrlf=false archive <commit> extensions/facebook | tar -x -C <dir>
node -e "import('file:///<ruta-absoluta-al-repo>/scripts/package-facebook-extension.mjs').then(m=>console.log(require('crypto').createHash('sha256').update(m.extensionArchive(process.argv[1])).digest('hex')))" <dir>
```

Compará con `sha256` de `https://rivastock.vercel.app/downloads/rivastock-facebook-version.json`.

## 6. Límites que no se relajan

- No publiques en Facebook, no apliques migraciones productivas, no hagas `git push` a `main` (dispara el despliegue en Vercel) ni actives la cola sin autorización explícita en el chat para **esa** acción. Una autorización no se extiende a otra acción.
- Cualquier publicación real usa un producto **nuevo** y confirmado; nunca Khamrah, «Parlante absorbente de sonido» ni publicaciones existentes como prueba.
- No reenviar automáticamente resultados desconocidos. No atribuir éxito por título, feed (D-A1), ausencia de error ni aparición tardía.
- No eludir login, CAPTCHA ni controles de Facebook; no usar APIs privadas.
- No borrar entregas, intentos, eventos, revisiones ni diarios. Correcciones hacia adelante (nueva migración, nueva versión).
- No exportes ni registres tokens, códigos de vinculación, cookies, claves ni contenido personal. Los IDs de entrega/intento sí pueden registrarse.
- No agregues infraestructura multicuenta (ver `ROADMAP.md`).
- Commits: conventional commits, sin líneas de atribución a IA.

Para pedir una autorización, escribí: acción exacta, entorno, objeto (migración/commit/producto y destinos), efecto esperado, cómo se revierte o se detiene. Una pregunta por mensaje; esperá la respuesta.

## 7. Punto de reanudación

Al terminar una sesión, la última fila del registro de `TASKS.md` debe contener:

- Tarea y estado exacto (qué paso de su «Cambio» quedó hecho).
- Archivos modificados y si están commiteados (hash) o no.
- Últimos comandos ejecutados y su resultado.
- Próxima acción concreta («escribir la prueba de candidata ambigua en `e2e/facebook-groups.spec.ts`», no «seguir con A02»).
- Bloqueos con lo que se necesita para levantarlos y quién debe actuar.

## 8. Prompt reutilizable

```text
Sos el ejecutor del plan de cierre de la automatización de Facebook de RivaStock.

1. Leé CLAUDE.md y cualquier AGENTS.md aplicable; luego docs/automation/HANDOFF.md, PLAN.md (§1, §2.1, §5.4, §6) y TASKS.md (convenciones, tablero, última fila del registro).
2. Verificá que el estado real coincide con el plan: git status, git log y los símbolos de la tarea. Si algo difiere, aplicá HANDOFF §4 antes de seguir.
3. Elegí la primera tarea desbloqueada que tu rol pueda ejecutar. Si requiere a la persona usuaria o autorización [AUT], prepará lo necesario y pedilo con una sola pregunta; no la simules.
4. Implementá únicamente su alcance y ejecutá su validación exacta. No cambies criterios para que pasen las pruebas.
5. Registrá en TASKS.md archivos modificados, comandos, resultados (cantidades y fallos), límites y pendientes.
6. Marcá la tarea completada solo si cumplió todos sus criterios de aceptación, con evidencia.
7. Continuá con la siguiente tarea desbloqueada mientras no haya bloqueos.
8. Al terminar la sesión, dejá el punto de reanudación de HANDOFF §7.

Respetá los límites de HANDOFF §6 aunque una tarea parezca pedir lo contrario. Nunca declares terminada la automatización sin cumplir PLAN.md §1 completo.
```
