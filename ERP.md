# Sistema Kennot — ERP fase 1

## Qué se agregó

| Módulo | Qué hace |
|---|---|
| **Dashboard** | Ventas y margen del mes, cuentas por cobrar/pagar (con vencidos), caja del mes, valor del inventario, gráfico ventas vs. compras, stock crítico, productos más vendidos, conversión de cotizaciones. |
| **Ventas** | Venta directa o desde una cotización (botón **→ Venta** en Historial). Descuenta stock, guarda el costo de cada línea para calcular margen real, crédito en días o pago al contado, cobros parciales, anulación (devuelve stock). |
| **Compras** | Órdenes de compra a proveedores. Quedan en *borrador*; al marcarlas **recibidas** suben el stock y (opcional) actualizan el precio de compra. Pagos parciales, anulación. |
| **Proveedores** | Ficha de proveedores (RUT, rubro, contacto). |
| **Kardex** | Cada cambio de stock queda registrado (compra, venta, anulación, ajuste, stock inicial). Botón **Kardex** en Inventario, con ajuste por conteo físico. |
| **Stock mínimo** | Cada producto tiene su propio mínimo (por defecto 30, igual que antes). |

## Reglas que aplica el backend

- Todo movimiento de stock va en una transacción con bloqueo de fila: dos ventas simultáneas no pueden dejar stock negativo.
- No se puede vender más de lo que hay en stock.
- No se puede anular una venta/compra con cobros/pagos registrados (primero se eliminan).
- Una cotización solo se convierte en venta una vez; si la venta se anula, la cotización vuelve a "pendiente".
- Precios netos; IVA 19% igual que en las cotizaciones.

## Base de datos

No hay que correr SQL a mano: al arrancar, `sequelize.sync({ alter: true })` crea las tablas nuevas
(`proveedores`, `ordenes_compra`, `ventas`, `pagos`, `movimientos_stock`) y agrega
`productos.stock_minimo` y `cotizaciones.estado / venta_id`. Los datos existentes no se tocan.
Probado migrando una base creada con la versión anterior.

## Nuevos endpoints

```
GET/POST/PUT/DELETE  /api/proveedores
GET/POST             /api/ordenes-compra          PUT /:id   DELETE /:id (solo borrador)
POST                 /api/ordenes-compra/:id/recibir | /anular | /pagos
GET/POST             /api/ventas                  GET /:id
POST                 /api/ventas/desde-cotizacion/:cotizacionId
POST                 /api/ventas/:id/anular | /cobros
GET                  /api/pagos?tipo=cobro|pago   DELETE /api/pagos/:id
GET                  /api/productos/:id/movimientos
POST                 /api/productos/:id/ajuste    { stock_real, nota }
GET                  /api/dashboard?meses=6
```

## Desarrollo local sin Supabase

```
DATABASE_URL=postgres://postgres@localhost:5432/kennot
DB_SSL=false
```

## Próximas fases sugeridas

Login y roles, importación masiva desde Excel, emisión de documento tributario (SII), reportes exportables.
