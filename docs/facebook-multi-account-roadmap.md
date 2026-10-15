# Publicación desde múltiples cuentas — propuesta futura

Estado: **diferida; no implementada ni incluida en la entrega actual**. Decisión de producto: 15 de octubre de 2026.

La prioridad actual es estabilizar la publicación desde una sola cuenta de Facebook para el negocio del usuario. Ver el [plan de confiabilidad vigente](facebook-extension-hardening-plan.md). Este documento conserva la intención futura y no constituye una especificación lista para implementar.

## Experiencia deseada

Preparar el contenido una vez, seleccionar una o varias cuentas vinculadas con sus destinos y aprobar el conjunto. Una campaña reúne envíos independientes por cuenta y destino; el historial muestra el avance conjunto y el resultado individual.

En el futuro se desea ofrecer RivaStock a otros negocios. Cada negocio debe mantener separados sus cuentas, dispositivos, permisos, publicaciones y registros.

## Requisitos para retomar la propuesta

- Vincular cada cuenta de Facebook a un perfil de Chrome y ejecutor autorizado, con verificación de identidad observable y detención ante discrepancias.
- Identificar cada envío por campaña, cuenta y destino, conservando además la identidad de cada intento de ejecución.
- Procesar las cuentas de forma independiente: una sesión vencida no bloquea las demás ni habilita usar otra identidad automáticamente.
- Mantener la aprobación explícita del contenido, las cuentas y los destinos. Advertir si distintas cuentas apuntan al mismo grupo antes de aprobar.
- Conservar envíos exitosos y reconciliar resultados desconocidos antes de cualquier repetición; recuperar una campaña no vuelve a publicar todos sus destinos.
- Probar aislamiento entre negocios, concurrencia real, límites operativos, instalación y actualizaciones antes de distribuir a terceros.

## Condición de entrada y decisiones pendientes

Retomar cuando la entrega de cuenta única cumpla sus criterios de aceptación y tenga evidencia del circuito integral real autorizado. La ampliación requiere una planificación propia basada en el código de ese momento.

Quedan por definir: mecanismo verificable de identidad de Facebook para cada formulario, asignación entre cuentas/perfiles/dispositivos, política de duplicados entre cuentas, capacidad objetivo, límites y distribución a otros negocios. No crear ahora tablas, servicios Python, IA local ni pantallas exclusivamente para anticipar esta propuesta.
