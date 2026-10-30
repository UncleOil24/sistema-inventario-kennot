# Sistema Kenott — Ventas y cotizaciones (fase 2)

El sistema deja de llevar inventario: **primero se vende y después se compra al proveedor**.
La base es la planilla LISTADO_CONSOLIDADO (v61, 2.178 productos).

## Flujo

Lista del cliente → **Cotizar** (precio convenio o particular según el cliente) → cotización guardada
(*borrador* → *cotización*) → ¿cliente acepta? → **Venta** (con N° OC del cliente) → **Cuadro de compra**
por proveedor → órdenes de compra → recepción (lo pagado real entra al historial de precios) → cobro.
Rechazadas y vencidas no se borran: sirven para medir cuánto se cotiza y cuánto se gana.

## Qué cambió

| Módulo | Qué hace ahora |
|---|---|
| **Catálogo** | N° de la planilla, descripción estándar, precio compra vigente, proveedor principal, opción 2 y 3, REVISAR, confirmado. Precios convenio/particular calculados con los márgenes de Configuración. Buscador por palabras en cualquier orden y sin tildes. Filtros: con aviso, sin precio, sin confirmar, confirmados. |
| **Precios** (botón en Catálogo, solo admin) | Historial por proveedor (nunca se borra un precio). Cargar precio: con IVA (web) se divide por 1,19; si solo hay total de línea se divide por la cantidad. Confirmar, descartar con motivo, restaurar, usar un precio del historial. Registro de cambios. |
| **Cotizar** | Cliente → tipo de precio (convenio / particular). El precio de cada línea se puede corregir. Admin ve costo y margen por línea (no se imprime). Guarda borrador o cotización, descarga Excel con el formato Kenott. |
| **Cotizaciones** | Estados: borrador, cotización, aceptada, rechazada (con motivo), vencida (automático al pasar la validez). Editar, reabrir, aceptar → venta. El precio y el costo se copian al cotizar: si el catálogo cambia después, la cotización y su margen no se mueven. |
| **Ventas** | N° OC del cliente, factura, cobros. **Cuadro de compra** agrupado por proveedor con margen por línea, alternativas (opción 2 y 3), cambio de proveedor de una línea y botón para generar las órdenes de compra. Utilidad = margen − gastos de la venta. |
| **Compras** | Al recibir, lo pagado real se guarda como precio del proveedor (documento = factura) y se recalcula el precio vigente. |
| **Gastos** (admin) | Flete, combustible, comisión, general. Asociados a una venta o al mes. |
| **Reportes** (admin) | Utilidad por cliente, compras por proveedor y ahorro vs. opción 2, precio cotizado vs. pagado real. |
| **Configuración** (admin) | Márgenes convenio / particular, último N° de cotización (correlativo), validez por defecto, **importar planilla**. |
| **Inicio** | Ventas, margen, gastos y utilidad del mes; cotizaciones abiertas, ganadas, rechazadas y vencidas; ventas por comprar; productos sin precio y por revisar. |

Se eliminó el control de stock (kardex, stock mínimo, descuento al vender). Las columnas antiguas
`stock`, `stock_minimo` y `precio_venta` quedan en la base sin uso, para no borrar datos.

## Reglas de precios (services/precios.js)

1. Precio de compra siempre **neto** (web/tienda ÷ 1,19).
2. Precio **unitario** (si solo viene el total, ÷ cantidad).
3. Particular = compra × (1 + margen particular). Convenio = compra × (1 + margen convenio). Márgenes en Configuración.
4. Gana el más barato. De cada proveedor vale su precio más reciente.
5. Opción 2 y 3 = segundo y tercer proveedor más baratos, nunca el mismo del principal.
6. Un precio **confirmado** solo lo reemplaza un precio nuevo más barato ("MÁS BARATA que tu confirmado $X"). Si el nuevo es más caro, se mantiene y se avisa.
7. Si gana un precio web y hay cotización de proveedor más cara, se avisa en REVISAR.

"Por revisar" cuenta los avisos reales (revisar, verificar, más barata, más cara, antes $...).
El resto del texto de REVISAR es solo el origen del precio (ej. "WEB SODIMAC").

## Importar la planilla

Configuración → Importar planilla, o por consola:

```
cd inventario-backend
node scripts/importar-planilla.js LISTADO_CONSOLIDADO_FERRETERIA_v61.xlsx [--desactivar-otros]
```

| Hoja | Va a |
|---|---|
| LISTADO CONSOLIDADO | productos (precio vigente, opciones, REVISAR; "OK CONFIRM." o 0 = confirmado) |
| COTIZACIONES | precios_proveedor (historia con fecha y documento) |
| EXTRAS PROVEEDORES | precios_proveedor (descripción del proveedor, marca, calce) |
| PROVEEDOR / CONTACTO | proveedores ("precio web" = tienda web) |
| REGISTRO DE CAMBIOS | registro_cambios (una sola vez) |

- Calza productos por descripción exacta y, si no, por N° (solo los que ya vinieron de la planilla).
- Se puede repetir: no duplica precios. Sí reemplaza precio vigente, opciones y REVISAR con lo que diga la planilla.
- Los precios más baratos que la planilla no aplicó quedan **descartados** con motivo, para partir con el mismo precio vigente que la planilla (se pueden restaurar en Precios).

## Base de datos

Igual que antes, no hay que correr SQL: al arrancar, `sequelize.sync({ alter: true })` crea
`precios_proveedor`, `parametros`, `gastos`, `registro_cambios` y las columnas nuevas, y
`services/migracion.js` pasa las cotizaciones antiguas a los estados nuevos
(pendiente → cotización, vendida → aceptada). Nueva dependencia: `multer` (subir la planilla).

## Endpoints nuevos o cambiados

```
GET  /api/productos?busqueda=&categoria=&revision=aviso|sin_precio|sin_confirmar|confirmados
GET  /api/productos/categorias | /api/productos/resumen
GET  /api/productos/:id/precios                 POST /api/productos/:id/precios
POST /api/productos/:id/confirmar  { precio_id? }   POST /api/productos/:id/desconfirmar
POST /api/precios/:id/descartar { motivo }      POST /api/precios/:id/restaurar
POST /api/precios/importar-planilla  (multipart: archivo, desactivar_otros)
GET/POST /api/cotizaciones   PUT /:id   POST /:id/estado { estado, motivo }   GET /:id/excel
POST /api/ventas/desde-cotizacion/:id { orden_compra_cliente, dias_credito | pagada_al_contado }
PUT  /api/ventas/:id/datos       GET /api/ventas/:id/cuadro-compra
POST /api/ventas/:id/cambiar-proveedor { indice, proveedor, costo }
POST /api/ventas/:id/generar-ordenes { proveedores? }
GET/POST/PUT/DELETE /api/gastos
GET/PUT /api/parametros          GET /api/dashboard/reportes?desde=&hasta=
```

## Lectura con Claude (API de Anthropic)

Claude **lee y propone**; el sistema pone los precios y una persona revisa antes de emitir o cambiar un precio.

| Dónde | Qué hace |
|---|---|
| Cotizar → **Subir lista del cliente** | Excel, PDF, Word, CSV o foto. Claude extrae cada línea (descripción, cantidad, unidad) y elige el producto del catálogo entre candidatos: exacto, equivalente, parecido o sin producto, con una nota corta. Pantalla de revisión: amarillo = parecido, sin producto o sin precio; se puede cambiar el producto o buscar otro. La descripción del cliente queda guardada en cada línea. |
| Catálogo o Compras → **Documento proveedor** (admin) | PDF o foto de cotización/factura. Claude extrae proveedor, N°, fecha y líneas con precio unitario neto (si venían con IVA se dividen por 1,19; si solo hay total, ÷ cantidad) y se comprueba que la suma de líneas dé el total del documento. Cada línea se asigna a un producto o se crea uno nuevo. Al aprobar, los precios entran al historial y se recalcula precio vigente, opciones y REVISAR. |

Cómo calza: el servidor busca primero en el catálogo los 15 candidatos más parecidos (descripción estándar +
descripciones con que cada proveedor cotizó ese producto) y Claude elige entre ellos, así nunca inventa productos.
Probado con las 2.229 descripciones de proveedores de la planilla: el producto correcto queda entre los candidatos en el 97% de los casos.

Configuración en Render (servicio del backend → Environment):

| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de la API (console.anthropic.com). La administra la empresa. Sin ella, los botones avisan que falta. |
| `ANTHROPIC_MODEL` | Opcional. Por defecto `claude-sonnet-5-5`. |

Cada respuesta de Claude queda en la tabla `auditoria_ia` (archivo, usuario, tokens usados y respuesta), para auditar calces y costos.

## Cotización en PDF

Botón **Guardar y descargar PDF** en Cotizar y **↓ PDF** en Cotizaciones. Mismo diseño que la plantilla Excel
(cabecera verde con logo, cliente, descripción, detalle, totales, responsable comercial, datos de transferencia y firma).
Los datos de la empresa se editan en Configuración. Con muchas líneas pasa a varias páginas. El Excel sigue disponible.

## Endpoints de esta etapa

```
GET  /api/ia/estado
POST /api/ia/lista-cliente                (multipart: archivo)
POST /api/ia/documento-proveedor          (multipart: archivo, admin)
POST /api/ia/documento-proveedor/aprobar  { proveedor, documento, fecha, origen, lineas: [{ producto_id | nuevo, precio, ... }] }
GET  /api/ia/auditoria                    (admin)
GET  /api/cotizaciones/:id/pdf
```

Nuevas dependencias del backend: `@anthropic-ai/sdk`, `pdfkit`, `mammoth` (leer Word).

## Seguimiento, precios antiguos, licitaciones y respaldo

| Función | Dónde | Cómo funciona |
|---|---|---|
| **Clientes por llamar** | Inicio y Cotizaciones → "Por llamar" | Cotización abierta sin contacto en `dias_seguimiento` días (5) o cuya fecha de "volver a llamar" llegó. Botón **☎ Seguimiento**: nota de lo que dijo el cliente + cuándo volver a llamar. Queda el historial. |
| **Precios antiguos** | Catálogo (filtro y ⏱), Cotizar, lista del cliente, Inicio | Precio de compra con fecha de más de `meses_precio_antiguo` meses (6). Se avisa para pedir cotización nueva. |
| **Licitaciones y Compra Ágil** | Menú Licitaciones | Cada tarde (o con "Buscar nuevas") se revisan las **Compras Ágiles** publicadas de la región (API v2, `api2.mercadopublico.cl`) y las **licitaciones** activas que calzan con `mp_palabras` (API v1). Filtros: región (`mp_regiones`), monto mínimo (`mp_monto_minimo`, 1.000.000), organismos excluidos (`mp_excluir_organismos`, Municipalidad de Talca) y palabras que descartan (`mp_excluir_palabras`). Claude puntúa de 0 a 100 qué tanto calza cada proceso con el catálogo; bajo 40 queda en "Descartadas" (auto, recuperable). Los organismos de `mp_prioridad` (municipalidades de Yerbas Buenas, Linares, San Javier, Curicó y Longaví, Ejército, Gendarmería, U. de Talca, etc.) salen primero con ★. **Cotizar** calza los productos con Claude y los pasa al cotizador. |
| **Respaldo** | Config → Respaldo | Excel con todas las tablas. Descarga manual siempre; envío semanal por correo si hay SMTP configurado. |

Variables nuevas en Render (todas opcionales; sin ellas esa función avisa y el resto sigue igual):

| Variable | Para qué |
|---|---|
| `MERCADOPUBLICO_TICKET` | Ticket de la API de Mercado Público (gratis, chilecompra.cl/api, con Clave Única) |
| `SMTP_USER` / `SMTP_PASS` | Correo que envía el respaldo (Gmail + contraseña de aplicación). Opcionales `SMTP_HOST`, `SMTP_PORT` |

Tareas programadas: `.github/workflows/tareas.yml` llama a `POST /api/tareas` a las 21:03 y 22:03 UTC y a las 11:03 UTC.
El servidor decide según la hora de Chile: desde las 18:00 revisa Mercado Público (una vez por tarde); entre 06:00 y 12:00
envía por correo el resumen de licitaciones nuevas (las que aún no se avisaron) y el respaldo semanal. Es pública pero solo
actúa cuando corresponde y acepta una llamada cada 10 minutos. También despierta el servidor de Render. Se puede lanzar
a mano en GitHub → Actions → "Tareas diarias" → Run workflow. Las fechas de la API (hora de Chile sin zona) se interpretan
como hora de Chile.

Notas de la API de Compra Ágil: el ticket va en el encabezado `ticket` (el mismo de las licitaciones); es lenta (10-30 s por consulta, a veces 504), por eso se piden páginas de 50 (si falla, de 10), solo lo publicado desde la revisión anterior (`mp_ca_ultima`) y el detalle (productos) solo de lo que calza, con tope de 40 por revisión. Sus fechas vienen en hora de Chile aunque traigan "Z". Ficha pública: `https://buscador.mercadopublico.cl/ficha?code=CODIGO`.

Notas de la API de Mercado Público: el listado de activas trae solo código, nombre y cierre, por eso el filtro por palabras
es sobre el nombre; el detalle cuesta una consulta por licitación (máx. 80 por vuelta, de a una, con pausa) y el ticket tiene
un tope de 10.000 consultas diarias. Compra Ágil usa otra API (beta) y no está incluida todavía.

## Pendiente

- Kenott y Tactics como empresas separadas, si se decide.
- Facturación electrónica SII y portales de compras públicas (fase futura).

---

# Fase 1 (referencia)

## Qué se agregó

| Módulo | Qué hace |
|---|---|
| **Dashboard** | Ventas y margen del mes, cuentas por cobrar/pagar (con vencidos), caja del mes, valor del inventario, gráfico ventas vs. compras, stock crítico, productos más vendidos, conversión de cotizaciones. |
| **Ventas** | Venta directa o desde una cotización (botón **→ Venta** en Historial). Descuenta stock, guarda el costo de cada línea para calcular margen real, crédito en días o pago al contado, cobros parciales, anulación (devuelve stock). |
| **Compras** | Órdenes de compra a proveedores. Quedan en *borrador*; al marcarlas **recibidas** suben el stock y (opcional) actualizan el precio de compra. Pagos parciales, anulación. |
| **Proveedores** | Ficha de proveedores (RUT, rubro, contacto). |
| **Kardex** | Cada cambio de stock queda registrado (compra, venta, anulación, ajuste, stock inicial). Botón **Kardex** en Inventario, con ajuste por conteo físico. |
| **Stock mínimo** | Cada producto tiene su propio mínimo (por defecto 30, igual que antes). |

## Login y roles

Todo el sistema exige iniciar sesión (email + contraseña). Las sesiones duran 12 horas.

| Puede… | Admin | Usuario |
|---|:---:|:---:|
| Cotizar, vender, cobrar, crear clientes | ✓ | ✓ |
| Crear órdenes de compra, recibirlas y pagarlas, crear proveedores | ✓ | ✓ |
| Crear y editar productos (precio venta, stock mínimo) | ✓ | ✓ |
| Ver precio de compra, costos, márgenes, caja y cuentas por pagar | ✓ | — |
| Cambiar el costo o el stock de un producto a mano, ajustar stock | ✓ | — |
| Anular ventas u órdenes, borrar cualquier registro o pago | ✓ | — |
| Administrar usuarios | ✓ | — |

- Cada venta, compra, pago y movimiento de stock guarda **quién lo registró**.
- Las contraseñas se guardan cifradas (bcrypt). Mínimo 8 caracteres.
- Cambiar una contraseña, el rol o desactivar a alguien cierra sus sesiones abiertas.
- 5 intentos fallidos seguidos bloquean ese email por 15 minutos.
- Siempre debe quedar al menos un administrador activo.
- Las órdenes de compra sí muestran los costos a quien las crea (son necesarios para comprar).

### Variables en Render

| Variable | Para qué |
|---|---|
| `JWT_SECRET` | Firma de las sesiones. Texto largo y aleatorio. Si falta, las sesiones se pierden en cada reinicio. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NOMBRE` | Crean el primer administrador la primera vez que arranca (solo si no hay usuarios). Después se pueden borrar. |

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
POST                 /api/auth/login              { email, password } -> { token, usuario }
GET                  /api/auth/me
POST                 /api/auth/cambiar-password   { actual, nueva }
GET/POST/PUT         /api/usuarios                (solo admin)
```

Todas las rutas de `/api` (excepto `/api/auth/login`) exigen el header `Authorization: Bearer <token>`.

## Desarrollo local sin Supabase

```
DATABASE_URL=postgres://postgres@localhost:5432/kennot
DB_SSL=false
```

## Próximas fases sugeridas

Importación masiva desde Excel, emisión de documento tributario (SII), reportes exportables.

## Proyectos (licitaciones ganadas con varias órdenes de compra)

Un organismo suele mandar **varias órdenes de compra** por una sola licitación. Cada OC del organismo se registra como una
venta (con su factura y su cobro) y el **proyecto** las une (menú Ventas → "Proyectos / licitaciones"):

- **Unir:** en la lista de ventas se marcan las OC de la misma licitación y se pulsa "Unir en proyecto" (nuevo o existente).
  Si la cotización vino de Licitaciones, el código de la licitación se completa solo.
- **Ficha del proyecto:** todas las OC del organismo (neto, cobrado, por cobrar), todas las compras a proveedores y la
  utilidad del conjunto.
- **Compra consolidada:** suma lo de todas las ventas del proyecto y genera **una OC por proveedor** (`proyecto_id`).
  No repite proveedores que ya tienen orden en el proyecto o en una de sus ventas; el cuadro de compra de cada venta
  tampoco duplica lo que ya se compró para el proyecto.
- **Unir órdenes:** órdenes en borrador del mismo proveedor se juntan en una (suma cantidades); las otras quedan anuladas
  con la nota "Unida a OC-xxxx".
- **Deshacer proyecto:** las ventas y órdenes no se borran, solo quedan sueltas.
