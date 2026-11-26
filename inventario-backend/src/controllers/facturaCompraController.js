const crypto = require("crypto");
const { firma, esGerencia } = require("../middlewares/auth");
const sequelize = require("../../config/database");
const OrdenCompra = require("../models/OrdenCompra");
const Proveedor = require("../models/Proveedor");
const Producto = require("../models/Producto");
const Venta = require("../models/Venta");
const Gasto = require("../models/Gasto");
const PrecioProveedor = require("../models/PrecioProveedor");
const DocumentoCompra = require("../models/DocumentoCompra");
const { handler, ErrorNegocio } = require("../services/erp");
const { empresaCompradora } = require("../services/empresas");
const { getParametros } = require("../services/parametros");
const { recalcular, origenDe, normProv, registrar } = require("../services/precios");
const { unidadDeProducto } = require("../services/unidades");
const ia = require("../services/ia");
const { pendientesPorProducto, repartoInicial, dividir } = require("../services/repartoCompra");

// "Subir factura de compra" (Operativo): Claude lee la factura del proveedor, se compara con nuestra compra
// (C-0001...) o se crea una compra nueva, y los precios entran al catálogo con la fecha de la factura.
const ALZA = 0.10; // más de 10% sobre el precio del catálogo: aviso a gerencia
const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const sumarDias = (f, n) => { const d = new Date(`${String(f).slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (Number(n) || 0)); return d.toISOString().slice(0, 10); };
const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const numeroCompra = (id) => `C-${String(id).padStart(4, "0")}`;

// Archivos leídos esperando que se registre la factura (30 min)
const pendientes = new Map();
const guardarPendiente = (file) => {
  const ahora = Date.now();
  for (const [k, x] of pendientes) if (ahora - x.t > 30 * 60e3) pendientes.delete(k);
  const token = crypto.randomUUID();
  pendientes.set(token, { buf: file.buffer, nombre: file.originalname, mime: file.mimetype || "application/pdf", t: ahora });
  return token;
};

// Precio de una factura al catálogo: historial con la fecha de la factura, reglas de siempre y aviso de alza (> 10%)
async function precioDesdeFactura(p, { proveedor, precio, fecha, documento, cantidad, unidad, descripcion, marca, calce, origen, usuario, motivo }, t) {
  const antes = Number(p.precio_compra) || 0;
  // Nombre de relleno (OTROS, COTIZAR…): no es un proveedor, su precio no va al catálogo
  if (require("../services/precios").esGenerico(proveedor)) return { antes, despues: antes, alza: null };
  await PrecioProveedor.create({
    producto_id: p.id, proveedor, precio: Math.round(precio), fecha: fecha || hoyISO(), documento, cantidad: cantidad || null, unidad: unidad || null,
    descripcion_proveedor: descripcion || null, marca: marca || null, calce: calce && calce !== "sin_producto" ? calce : null, origen, creado_por: usuario,
  }, { transaction: t });
  await recalcular(p, { t, usuario, motivo });
  let alza = null;
  if (antes > 0 && precio > antes * (1 + ALZA)) {
    const pct = Math.round((precio / antes - 1) * 100);
    alza = { producto_id: p.id, codigo: p.codigo, nombre: p.nombre, antes, ahora: Math.round(precio), pct, proveedor };
    const aviso = `ALZA ${pct}% ${proveedor} ${documento || ""} (${pesos(precio)} vs ${pesos(antes)})`.replace(/\s+/g, " ");
    await p.update({ revisar: [aviso, p.revisar].filter(Boolean).join(" | ").slice(0, 1000) }, { transaction: t });
    await registrar({ usuario, tabla: "productos", registro_id: p.id, campo: "alza", antes: String(antes), despues: String(Math.round(precio)), motivo: `Alza ${pct}% en ${documento || "factura"} de ${proveedor}` }, t);
  }
  return { antes, despues: Number(p.precio_compra) || 0, alza };
}

// POST /api/ordenes-compra/factura/leer   (multipart: archivo, orden_id opcional)
const leer = handler(async (req, res) => {
  // Desde la bandeja de documentos: el archivo ya está guardado y leído
  let file = req.file; let extraido = null; let bandeja = null;
  if (!file && Number(req.body?.bandeja_id)) {
    bandeja = await require("../models/DocumentoBandeja").findByPk(Number(req.body.bandeja_id));
    if (!bandeja) throw new ErrorNegocio("Documento de la bandeja no encontrado", 404);
    file = { buffer: bandeja.datos, originalname: bandeja.nombre_archivo, mimetype: bandeja.mime };
    extraido = bandeja.lectura || null;
    if (!req.body.venta_id && bandeja.venta_id && !req.body.orden_id) req.body.venta_id = bandeja.venta_id;
  }
  if (!file) throw new ErrorNegocio("Adjunta la factura (PDF, foto o XML)");
  req.file = file;
  const { indiceCatalogo } = require("./iaController");
  const { indice, productos } = await indiceCatalogo();
  const r = await ia.leerDocumentoProveedor(file, indice, firma(req), extraido);
  const ordenId = Number(req.body?.orden_id) || null;
  const orden = ordenId ? await OrdenCompra.findByPk(ordenId) : null;
  if (ordenId && !orden) throw new ErrorNegocio("Compra no encontrada", 404);
  // Subida desde el cuadro de compra de una venta: cada producto se calza con las líneas de la venta
  const ventaId = Number(req.body?.venta_id) || null;
  const venta = ventaId ? await Venta.findByPk(ventaId, { attributes: ["id", "numero", "items", "empresa", "cliente_nombre"] }) : null;
  const usadosVenta = new Set();

  const ver = (p) => (p ? { id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, precio_compra: Number(p.precio_compra) || 0, proveedor: p.proveedor } : null);
  const usados = new Set();
  // Lo aprendido de este proveedor (código o descripción → producto nuestro + factor de la presentación)
  const { equivalenciasDe, factorDeDescripcion } = require("../services/presentaciones");
  const eqs = await equivalenciasDe(r.encabezado.proveedor || orden?.proveedor_nombre);
  const lineas = r.lineas.map((l, i) => {
    const eq = eqs.buscar(l);
    const prod = eq && productos.get(eq.producto_id) ? productos.get(eq.producto_id) : l.producto_id ? productos.get(l.producto_id) : null;
    const factor = eq ? Number(eq.factor) || 1 : 1;
    let pedido = null;
    if (orden) {
      const k = orden.items.findIndex((it, j) => !usados.has(j) && prod && it.producto_id === prod.id);
      if (k >= 0) { usados.add(k); pedido = { cantidad: Number(orden.items[k].cantidad), precio: Number(orden.items[k].precio), indice: k }; }
    }
    const precio = Number(l.precio_neto) || 0;
    const cantBase = Number(l.cantidad) * factor; const precioBase = precio / factor;
    const antes = Number(prod?.precio_compra) || 0;
    let venta_indice = null;
    if (venta && prod) {
      const k = venta.items.findIndex((it, j) => !usadosVenta.has(j) && it.producto_id === prod.id);
      if (k >= 0) { usadosVenta.add(k); venta_indice = k; }
    }
    return {
      venta_indice, venta_linea: venta_indice != null ? { nombre: venta.items[venta_indice].nombre, cantidad: Number(venta.items[venta_indice].cantidad) } : null,
      i, descripcion: l.descripcion, codigo_proveedor: l.codigo_proveedor, marca: l.marca, unidad: l.unidad, cantidad: l.cantidad,
      precio_neto: precio, total_linea: l.total_linea, calce: eq ? "exacto" : l.calce, nota: eq ? `Aprendido: ${eq.codigo_proveedor ? `código ${eq.codigo_proveedor}` : "misma descripción"} → × ${factor}` : l.nota,
      factor, aprendido: !!eq, factor_sugerido: factorDeDescripcion(l.descripcion),
      producto: ver(prod), candidatos: (l.candidatos || []).slice(0, 6).map(ver),
      pedido,
      diferencia: orden ? (!pedido ? "No estaba en la compra" : [
        Math.abs(pedido.precio - precioBase) > Math.max(1, pedido.precio * 0.01) ? `precio ${pesos(pedido.precio)} → ${pesos(Math.round(precioBase))}` : null,
        Number(pedido.cantidad) !== cantBase ? `cantidad ${pedido.cantidad} → ${cantBase}` : null,
      ].filter(Boolean).join(" · ") || null) : null,
      alza: antes > 0 && precioBase > antes * (1 + ALZA) ? Math.round((precioBase / antes - 1) * 100) : null,
    };
  });
  // Qué ventas necesitan cada producto (primero la venta desde la que se sube, después las más antiguas) y reparto propuesto
  const pend = await pendientesPorProducto(lineas.map((l) => l.producto?.id), ventaId, { excluirOrdenId: orden?.id || null });
  for (const l of lineas) {
    l.ventas_pendientes = l.producto ? pend.get(l.producto.id) || [] : [];
    l.reparto = repartoInicial(l.cantidad, l.ventas_pendientes, ventaId || orden?.venta_id || null);
    // La venta desde donde se sube aparece con su número aunque no necesite el producto (compra extra)
    for (const r of l.reparto) if (r.venta_id && !l.ventas_pendientes.some((c) => c.venta_id === r.venta_id)) {
      const v = r.venta_id === venta?.id ? venta : await Venta.findByPk(r.venta_id, { attributes: ["id", "numero", "cliente_nombre"] });
      l.ventas_pendientes = [...l.ventas_pendientes, { venta_id: r.venta_id, numero: v?.numero || `venta ${r.venta_id}`, cliente: v?.cliente_nombre || null, falta: 0 }];
    }
  }
  const faltan = orden ? orden.items.filter((_, j) => !usados.has(j)).map((it) => ({ nombre: it.nombre, cantidad: Number(it.cantidad), precio: Number(it.precio) })) : [];

  // Proveedor y compras pendientes del mismo proveedor (para asociar la factura)
  const e = r.encabezado;
  const prov = await require("../services/proveedorDoc").proveedorDeDocumento(e);
  const { Op } = require("sequelize");
  const donde = venta
    ? { estado: "borrador", [Op.or]: [{ venta_id: venta.id }, ...(prov ? [{ proveedor_id: prov.id }] : [])] }
    : prov ? { proveedor_id: prov.id, estado: "borrador" } : null;
  // ¿Ya está registrada? (mismo proveedor y mismo N° de documento)
  const folioDoc = String(e.numero_documento || "").trim();
  const yaRegistrada = prov && folioDoc ? await OrdenCompra.findAll({ where: { proveedor_id: prov.id, estado: { [Op.ne]: "anulada" },
    documento: { [Op.in]: [folioDoc, `BOL ${folioDoc}`] } }, attributes: ["id", "numero", "fecha_factura", "venta_id", "total"], raw: true }) : [];
  // Venta de cada compra ya registrada con este documento, para decir dónde quedó
  if (yaRegistrada.length) {
    const vs = await Venta.findAll({ where: { id: yaRegistrada.map((o) => o.venta_id).filter(Boolean) }, attributes: ["id", "numero", "cliente_nombre"], raw: true });
    for (const o of yaRegistrada) { const v = vs.find((x) => x.id === o.venta_id); o.venta = v ? `${v.numero}${v.cliente_nombre ? ` · ${v.cliente_nombre}` : ""}` : "sin venta"; }
  }
  const sugeridas = !orden && donde ? await OrdenCompra.findAll({ where: donde, attributes: ["id", "numero", "fecha", "total", "venta_id", "proveedor_nombre"], order: [["id", "DESC"]], limit: 15, raw: true }) : [];
  const neto = lineas.reduce((s, l) => s + Math.round(l.precio_neto * l.cantidad), 0);
  // Venta de esta compra (la de la venta desde donde se sube, o la de la orden) para mostrarla arriba
  const ventaTitulo = venta || (orden?.venta_id ? await Venta.findByPk(orden.venta_id, { attributes: ["id", "numero", "empresa", "cliente_nombre", "items"] }) : null);
  res.json({
    ok: true,
    data: {
      archivo_token: guardarPendiente(req.file), archivo: req.file.originalname, bandeja_id: bandeja?.id || null,
      encabezado: { ...e, proveedor: prov?.nombre || e.proveedor,
        // A nombre de quién viene el documento: su IVA va a esa empresa
        empresa_documento: empresaCompradora(e.cliente_rut, e.cliente_razon_social, await getParametros()) },
      proveedor_existente: prov ? { id: prov.id, nombre: prov.nombre } : null,
      control: r.control, truncado: r.truncado, lineas, faltan, sugeridas, ya_registrada: yaRegistrada,
      totales: { neto, iva: Math.round(neto * 0.19), total: neto + Math.round(neto * 0.19) },
      orden: orden ? { id: orden.id, numero: orden.numero, total: Number(orden.total), estado: orden.estado, documento: orden.documento } : null,
      venta: ventaTitulo ? { id: ventaTitulo.id, numero: ventaTitulo.numero, empresa: ventaTitulo.empresa, cliente: ventaTitulo.cliente_nombre || "" } : null,
      // Para asociar a mano una línea de la factura con una línea del pedido o de la venta ("Es para:")
      orden_items: orden ? orden.items.map((it, k) => ({ k, producto_id: it.producto_id, nombre: it.descripcion_cliente || it.nombre, unidad: it.unidad, cantidad: Number(it.cantidad) })) : [],
      venta_items: venta ? venta.items.map((it, k) => ({ k, producto_id: it.producto_id, nombre: it.descripcion_cliente || it.nombre, unidad: it.unidad, cantidad: Number(it.cantidad) })) : [],
      // Líneas de la venta de esta compra, para marcar un producto como "complemento de" una de ellas
      complementos: ventaTitulo ? (ventaTitulo.items || []).map((it, k) => ({ k, nombre: it.descripcion_cliente || it.nombre, complemento: !!it.complemento_de })).filter((x) => !x.complemento) : [],
    },
  });
});

// POST /api/ordenes-compra/factura/registrar
// { archivo_token, orden_id | null, venta_id, gasto_id, proveedor, documento, fecha, empresa, neto, iva, total,
//   lineas: [{ producto_id | nuevo: { nombre, unidad, categoria }, descripcion, cantidad, precio, unidad, marca, calce }] }
const registrarFactura = handler(async (req, res) => {
  const b = req.body || {};
  const proveedor = normProv(b.proveedor);
  if (!proveedor) throw new ErrorNegocio("Indica el proveedor");
  const boleta = b.tipo_documento === "boleta";
  const folio = String(b.documento || "").trim() || (boleta ? "S/N" : "");
  if (!folio) throw new ErrorNegocio("Indica el N° de factura");
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || "") ? b.fecha : hoyISO();
  const lineas = (b.lineas || []).filter((l) => (l.producto_id || l.nuevo?.nombre) && Number(l.precio) > 0 && Number(l.cantidad) > 0);
  if (!lineas.length) throw new ErrorNegocio("No hay líneas con producto, cantidad y precio");
  if (b.gasto_id && !esGerencia(req)) throw new ErrorNegocio("Solo gerencia puede pasar un gasto a compra", 403);
  const usuario = firma(req);
  const doc = `${boleta ? "BOL." : "FACT."} ${folio}`;

  const out = await sequelize.transaction(async (t) => {
    // Proveedor
    let ficha = await Proveedor.findOne({ where: sequelize.where(sequelize.fn("upper", sequelize.col("nombre")), proveedor), transaction: t });
    if (!ficha) ficha = await Proveedor.create({ nombre: proveedor, razon_social: b.razon_social || null, rut: b.rut || null, tipo: "proveedor" }, { transaction: t });
    const origen = await origenDe(ficha.nombre, t);
    const resumen = { precios: 0, productos_nuevos: 0, cambios_precio: [], alzas: [] };

    // Productos (los nuevos quedan POR CLASIFICAR)
    let siguiente = (Number(await Producto.max("codigo", { transaction: t })) || 0) + 1;
    const items = [];
    for (const l of lineas) {
      let p;
      if (l.producto_id) {
        p = await Producto.findByPk(l.producto_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!p) throw new ErrorNegocio(`Producto ${l.producto_id} no existe`, 404);
      } else {
        p = await Producto.create({
          codigo: siguiente++, nombre: String(l.nuevo.nombre).trim().toUpperCase(),
          categoria: esGerencia(req) && l.nuevo.categoria ? String(l.nuevo.categoria).toUpperCase() : "POR CLASIFICAR",
          unidad: unidadDeProducto(l.nuevo.nombre, l.nuevo.unidad || l.unidad), revisar: `Agregado desde ${doc} ${proveedor} por ${usuario}`.slice(0, 250),
        }, { transaction: t });
        await registrar({ usuario, tabla: "productos", registro_id: p.id, campo: "creado", despues: p.nombre, motivo: `Desde ${doc} ${proveedor}` }, t);
        resumen.productos_nuevos++;
      }
      items.push({ p, l });
      // Presentación (bidón 5 L, rollo 50 m…): se recuerda proveedor + código/descripción → producto + factor
      if (l.aprender && Number(l.aprender.factor) > 0) {
        await require("../services/presentaciones").aprender({ proveedor: ficha.nombre, codigo_proveedor: l.aprender.codigo_proveedor, descripcion: l.aprender.descripcion || l.descripcion, producto_id: p.id, factor: Number(l.aprender.factor), usuario }, t);
      }
    }
    const itemsOrden = items.map(({ p, l }) => ({ producto_id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: Number(l.cantidad), precio: Math.round(Number(l.precio)),
      ...(l.presentacion ? { presentacion: String(l.presentacion).slice(0, 120) } : {}) }));
    const repartos = items.map(({ l }) => l.reparto);
    const netoLineas = itemsOrden.reduce((s, i) => s + i.precio * i.cantidad, 0);
    let neto = Number(b.neto) > 0 ? Math.round(Number(b.neto)) : netoLineas;
    let iva = Number(b.iva) >= 0 && b.iva !== "" && b.iva != null ? Math.round(Number(b.iva)) : Math.round(neto * 0.19);
    const total = Number(b.total) > 0 ? Math.round(Number(b.total)) : neto + iva;
    // Boleta: no da crédito de IVA, así que el costo de la compra es el total pagado
    if (boleta) { neto = total; iva = 0; }
    const vence = sumarDias(fecha, ficha.plazo_pago_dias || 0);

    // Reparto entre ventas: una compra por venta (mismo N° de factura). La parte principal es la de la orden o la venta desde donde se sube.
    let orden;
    const ordenPrevia = b.orden_id ? await OrdenCompra.findByPk(b.orden_id, { transaction: t, lock: t.LOCK.UPDATE }) : null;
    const ventaBase = Number(b.venta_id) || ordenPrevia?.venta_id || null;
    const partes = dividir(itemsOrden.map((it, k) => ({ ...it, reparto: repartos[k] })), { neto, iva, total, principal: ventaBase, ventaPorDefecto: ventaBase });
    const p0 = partes[0];
    const ventaId = p0.venta_id;
    const venta = ventaId ? await Venta.findByPk(ventaId, { transaction: t, attributes: ["id", "empresa", "numero"] }) : null;
    const empresa = ["kenott", "tactics"].includes(b.empresa) ? b.empresa : venta?.empresa || null;
    const nota = partes.length > 1 ? ` (1 de ${partes.length})` : "";
    const tipoPago = ["contado", "credito_empresa", "credito_proveedor"].includes(b.tipo_pago) ? b.tipo_pago : "contado";
    // "Es para:" una línea del pedido o de la venta. Si lo comprado quedó en otro producto del catálogo (se decidió crear
    // uno nuevo o guardar en otro), la línea de la venta pasa a ese producto (la descripción del cliente no cambia),
    // así queda comprada y el catálogo guarda el precio en el producto que de verdad se compró.
    const ventaPara = ventaBase ? await Venta.findByPk(ventaBase, { transaction: t, lock: t.LOCK.UPDATE }) : null;
    // "Complemento de" una línea de la venta (ej. bisagras de una puerta que no estaban cotizadas): se agrega a la venta
    // como componente sin precio de esa línea; su costo es de la venta y queda comprado
    if (ventaPara && items.some(({ l }) => l.para?.tipo === "complemento")) {
      const vItems = [...ventaPara.items];
      for (const { p, l } of items) {
        if (l.para?.tipo !== "complemento") continue;
        const padre = vItems[Number(l.para.indice)];
        if (!padre) { l.para = null; continue; }
        vItems.push({ producto_id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: Number(l.cantidad), precio: 0,
          costo: Math.round(Number(l.precio)), proveedor: ficha.nombre, complemento_de: padre.descripcion_cliente || padre.nombre });
        l.para = { tipo: "venta", indice: vItems.length - 1 };
      }
      await ventaPara.update({ items: vItems, costo_total: require("../services/cuadroCompra").costoItems(vItems) }, { transaction: t });
      ventaPara.items = vItems;
    }
    const cubre = items.map(({ p, l }) => {
      const pa = l.para || null;
      if (!pa) return null;
      const viejo = pa.tipo === "orden" ? ordenPrevia?.items?.[pa.indice]?.producto_id : ventaPara?.items?.[pa.indice]?.producto_id;
      return viejo && Number(viejo) !== p.id ? { viejo: Number(viejo), pa, p, l } : null;
    });
    if (ventaPara && cubre.some(Boolean)) {
      const vItems = [...ventaPara.items];
      const tocadas = new Set();
      for (const c of cubre.filter(Boolean)) {
        const k = c.pa.tipo === "venta" ? c.pa.indice : vItems.findIndex((it, j) => !tocadas.has(j) && Number(it.producto_id) === c.viejo);
        const it = vItems[k];
        if (!it || Number(it.producto_id) !== c.viejo) continue;
        tocadas.add(k);
        vItems[k] = { ...it, producto_id: c.p.id, codigo: c.p.codigo, nombre: c.p.nombre, costo: Math.round(Number(c.l.precio)), proveedor: ficha.nombre,
          cambio: { antes: it.nombre, fecha: String(fecha).slice(0, 10), motivo: `Comprado como ${c.p.nombre} (${doc} ${ficha.nombre})` } };
      }
      if (tocadas.size) {
        await ventaPara.update({ items: vItems, costo_total: require("../services/cuadroCompra").costoItems(vItems) }, { transaction: t });
        resumen.lineas_venta_cambiadas = [...tocadas].length;
      }
    }
    if (b.orden_id) {
      orden = ordenPrevia;
      if (!orden) throw new ErrorNegocio("Compra no encontrada", 404);
      if (orden.estado === "anulada") throw new ErrorNegocio("La compra está anulada");
      // Lo pedido que no vino en la factura (sin stock o vino menos): vuelve a "por comprar" en el cuadro de la venta
      const llego = new Map();
      itemsOrden.forEach((it, k) => { const pid = cubre[k]?.viejo || it.producto_id; llego.set(pid, (llego.get(pid) || 0) + Number(it.cantidad)); });
      const noVinieron = [];
      for (const it of orden.items || []) {
        if (!it.producto_id) continue;
        const hay = llego.get(it.producto_id) || 0;
        const usa = Math.min(hay, Number(it.cantidad)); llego.set(it.producto_id, hay - usa);
        const casi = !Number.isInteger(Math.round(usa * 1000) / 1000) && usa >= Number(it.cantidad) * 0.97; // presentación (cajas de m²…)
        if (usa < Number(it.cantidad) && !casi) noVinieron.push({ producto_id: it.producto_id, nombre: it.nombre, cantidad: Number(it.cantidad) - usa, pedido: Number(it.cantidad) });
      }
      resumen.no_vinieron = noVinieron;
      await orden.update({
        no_vinieron: noVinieron.length ? noVinieron : null,
        proveedor_id: ficha.id, proveedor_nombre: ficha.nombre, items: p0.items, subtotal: p0.neto, iva: p0.iva, total: p0.total, tipo_pago: tipoPago,
        documento: boleta ? `BOL ${folio}` : folio, fecha_factura: fecha, empresa: empresa || orden.empresa,
        estado: "recibida", fecha_recepcion: orden.fecha_recepcion || new Date(),
        fecha_vencimiento: orden.fecha_vencimiento || vence,
        venta_id: venta ? venta.id : orden.venta_id,
      }, { transaction: t });
    } else {
      orden = await OrdenCompra.create({
        proveedor_id: ficha.id, proveedor_nombre: ficha.nombre, venta_id: venta?.id || null, fecha,
        items: p0.items, subtotal: p0.neto, iva: p0.iva, total: p0.total, documento: boleta ? `BOL ${folio}` : folio, fecha_factura: fecha, empresa, tipo_pago: tipoPago,
        estado: "recibida", fecha_recepcion: new Date(), fecha_vencimiento: vence,
        notas: (b.gasto_id ? "Registrada desde Gastos (compra de materiales)" : `Registrada desde la ${boleta ? "boleta" : "factura"} del proveedor`) + nota, creado_por: usuario,
      }, { transaction: t });
      await orden.update({ numero: numeroCompra(orden.id) }, { transaction: t });
    }
    // Las otras partes: una compra por venta (o sin venta), con el mismo documento
    const otras = [];
    if (partes.length > 1) {
      const grupo = `F${orden.id}`;
      await orden.update({ factura_grupo: grupo }, { transaction: t });
      for (const [n, pt] of partes.slice(1).entries()) {
        const v2 = pt.venta_id ? await Venta.findByPk(pt.venta_id, { transaction: t, attributes: ["id", "empresa", "numero"] }) : null;
        const o2 = await OrdenCompra.create({
          proveedor_id: ficha.id, proveedor_nombre: ficha.nombre, venta_id: v2?.id || null, fecha,
          items: pt.items, subtotal: pt.neto, iva: pt.iva, total: pt.total, documento: boleta ? `BOL ${folio}` : folio, fecha_factura: fecha,
          empresa: empresa || v2?.empresa || null, estado: "recibida", fecha_recepcion: new Date(), fecha_vencimiento: vence, factura_grupo: grupo, tipo_pago: tipoPago,
          notas: `${doc} repartida entre ventas (${n + 2} de ${partes.length})`, creado_por: usuario,
        }, { transaction: t });
        await o2.update({ numero: numeroCompra(o2.id) }, { transaction: t });
        otras.push(o2);
      }
      resumen.reparto = [orden, ...otras].map((o, k) => ({ numero: o.numero, venta_id: o.venta_id, total: Number(o.total), parte: k + 1 }));
    }

    // Precios al catálogo con la fecha de la factura
    for (const { p, l } of items) {
      const r = await precioDesdeFactura(p, {
        proveedor: ficha.nombre, precio: Number(l.precio), fecha, documento: doc, cantidad: l.cantidad, unidad: l.unidad,
        descripcion: l.descripcion, marca: l.marca, calce: l.calce, origen, usuario, motivo: `${doc} ${ficha.nombre} (${orden.numero})`,
      }, t);
      resumen.precios++;
      if (r.antes !== r.despues) resumen.cambios_precio.push({ codigo: p.codigo, nombre: p.nombre, antes: r.antes, despues: r.despues, proveedor: p.proveedor });
      if (r.alza) resumen.alzas.push(r.alza);
    }

    // Venía de Gastos: el gasto se reemplaza por esta compra (para no contarlo dos veces)
    if (b.gasto_id) {
      const g = await Gasto.findByPk(b.gasto_id, { transaction: t });
      if (g) {
        await registrar({ usuario, tabla: "gastos", registro_id: g.id, campo: "pasado_a_compra", antes: `${g.descripcion || ""} ${pesos(g.monto)}`, despues: orden.numero, motivo: "Era compra de materiales" }, t);
        await g.destroy({ transaction: t });
      }
    }

    // PDF guardado en la compra
    const archivo = b.archivo_token ? pendientes.get(b.archivo_token) : null;
    if (archivo) {
      for (const o of [orden, ...otras]) await DocumentoCompra.create({ orden_id: o.id, folio, fecha, monto: total, nombre_archivo: archivo.nombre, mime: archivo.mime, datos: archivo.buf, creado_por: usuario }, { transaction: t });
      pendientes.delete(b.archivo_token);
    }
    return { orden, resumen };
  });
  await marcarProcesado(b.bandeja_id, { orden_id: out.orden?.id || null }, req);
  res.json({ ok: true, data: { orden: out.orden, ...out.resumen } });
});

// El documento de la bandeja con que se registró queda procesado (con su compra o gasto)
async function marcarProcesado(id, datos, req) {
  if (!Number(id)) return;
  await require("../models/DocumentoBandeja").update({ estado: "procesado", ...datos, procesado_por: firma(req), procesado_en: new Date() }, { where: { id: Number(id) } }).catch(() => {});
}

// POST /api/ordenes-compra/factura/gasto
// { archivo_token, venta_id, tipo, descripcion, proveedor, documento, tipo_documento, fecha, empresa, total, iva }
// Un documento que no es mercadería (flete, combustible, peajes, otros) queda como gasto de la venta, con su archivo.
const registrarGasto = handler(async (req, res) => {
  const b = req.body || {};
  const total = Math.round(Number(b.total) || 0);
  if (!(total > 0)) throw new ErrorNegocio("Indica el monto total del documento");
  const boleta = b.tipo_documento === "boleta";
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || "") ? b.fecha : hoyISO();
  const venta = Number(b.venta_id) ? await Venta.findByPk(Number(b.venta_id), { attributes: ["id", "numero", "empresa"] }) : null;
  const TIPOS = ["flete", "combustible", "comision", "general"];
  const usuario = firma(req);
  const folio = String(b.documento || "").trim();
  const g = await sequelize.transaction(async (t) => {
    const gasto = await Gasto.create({
      fecha, tipo: TIPOS.includes(b.tipo) ? b.tipo : "general", monto: total,
      iva: boleta ? 0 : Number(b.iva) >= 0 && b.iva !== "" && b.iva != null ? Math.round(Number(b.iva)) : Math.round(total - total / 1.19),
      descripcion: [String(b.descripcion || "").trim(), b.proveedor ? normProv(b.proveedor) : null].filter(Boolean).join(" · ").slice(0, 250) || "Gasto",
      venta_id: venta?.id || null, empresa: ["kenott", "tactics"].includes(b.empresa) ? b.empresa : venta?.empresa || null,
      comprobante: folio ? `${boleta ? "BOL" : "FACT"} ${folio}`.slice(0, 100) : null, creado_por: usuario,
    }, { transaction: t });
    let archivo = b.archivo_token ? pendientes.get(b.archivo_token) : null;
    // Gasto desde la bandeja de documentos: su archivo queda con el gasto
    if (!archivo && Number(b.bandeja_id)) {
      const doc = await require("../models/DocumentoBandeja").findByPk(Number(b.bandeja_id), { transaction: t });
      if (doc) archivo = { nombre: doc.nombre_archivo, mime: doc.mime, buf: doc.datos };
    }
    if (archivo) {
      await DocumentoCompra.create({ gasto_id: gasto.id, folio: folio || null, fecha, monto: total, nombre_archivo: archivo.nombre, mime: archivo.mime, datos: archivo.buf, creado_por: usuario }, { transaction: t });
      pendientes.delete(b.archivo_token);
    }
    await registrar({ usuario, tabla: "gastos", registro_id: gasto.id, campo: "creado", despues: `${gasto.descripcion} ${pesos(total)}`, motivo: venta ? `Gasto de la venta ${venta.numero}` : "Gasto" }, t);
    return gasto;
  });
  await marcarProcesado(b.bandeja_id, { gasto_id: g.id }, req);
  res.status(201).json({ ok: true, data: g });
});

// GET /api/ordenes-compra/gastos/:gastoId/documento   — el archivo de un gasto
const descargarGasto = handler(async (req, res) => {
  const d = await DocumentoCompra.findOne({ where: { gasto_id: req.params.gastoId }, order: [["id", "DESC"]] });
  if (!d) throw new ErrorNegocio("Documento no encontrado", 404);
  res.setHeader("Content-Type", d.mime);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(d.nombre_archivo)}"`);
  res.end(d.datos);
});

// GET /api/ordenes-compra/:id/documentos/:docId
const descargar = handler(async (req, res) => {
  const d = await DocumentoCompra.findOne({ where: { id: req.params.docId, orden_id: req.params.id } });
  if (!d) throw new ErrorNegocio("Documento no encontrado", 404);
  res.setHeader("Content-Type", d.mime);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(d.nombre_archivo)}"`);
  res.end(d.datos);
});

module.exports = { leer, registrarFactura, registrarGasto, descargar, descargarGasto, precioDesdeFactura };
