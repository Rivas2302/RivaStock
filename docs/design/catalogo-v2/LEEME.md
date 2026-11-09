# Catálogo v2: maquetas aprobadas por Riva (09/11/2026)

Maqueta interactiva: https://claude.ai/artifact/9GyHHLH729AsDW339gbobq (solo Riva la abre).
Estos archivos son la fuente de esas pantallas, en formato Design Component (`.dc.html`): leé el HTML y los estilos como especificación. Las rutas `/_blob/...` son fotos de ejemplo del catálogo `rivatech-2`; no las uses en la app.

| Archivo | Pantalla | Qué cambia |
|---|---|---|
| `Main.dc.html` | Catálogo en el celular | **Solo las categorías**: círculos con foto automática. El resto del catálogo queda igual que hoy. |
| `ConfigCategorias.dc.html` | Dueño: foto de cada categoría | Interruptor global, foto automática, elegir otra foto de la categoría, subir, volver a automática. |
| `FinalizarPedido.dc.html` | Comprador: finalizar pedido | Formulario simple: Nombre, WhatsApp, Retiro/Envío, dirección solo con Envío, email y notas opcionales. |
| `PedidoRecibido.dc.html` | Comprador: pedido recibido | Código corto, botón "Enviar pedido por WhatsApp" y el mensaje que le llega al vendedor. |
| `PedidosVendedor.dc.html` | Vendedor: Pedidos | Aviso de pedido nuevo, buscador por código, contador en el menú. |
