const { firma } = require("../middlewares/auth");
const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const Cotizacion = require("../models/Cotizacion");
const Cliente = require("../models/Cliente");
const Producto = require("../models/Producto");
const Licitacion = require("../models/Licitacion");
const { asignarUnidadCliente } = require("../services/clientesMP");
const { handler, ErrorNegocio, calcularTotales } = require("../services/erp");
const { getParametros, precioVenta } = require("../services/parametros");
const { veCostos } = require("../middlewares/auth");
const { validarEmpresa, datosEmpresa } = require("../services/empresas");
const { excelCotizacion, pdfCotizacion, excelInterno, idCotizacion } = require("../services/cotizacionFormato");
// borrador = "En ejecución" · espera_proveedor = "Esperando proveedor" · cotizacion = "Enviada" (sin respuesta aún)
const ESTADOS = ["borrador", "espera_proveedor", "cotizacion", "aceptada", "rechazada", "vencida"];
const EDITABLES = ["borrador", "espera_proveedor", "cotizacion"];
const PrecioProveedor = require("../models/PrecioProveedor");
const Proveedor = require("../models/Proveedor");
const ia = require("../services/ia");
const { recalcular, normProv, origenDe, registrar } = require("../services/precios");
const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
const sumarDias = (iso, dias) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + Number(dias))).toISOString().slice(0, 10);
};

// El rol "usuario" no ve costos, proveedores ni márgenes
const vista = (req) => (c) => {
  const j = typeof c.toJSON === "function" ? c.toJSON() : { ...c };
  j.id_cotizacion = j.anterior ? `${j.empresa === "tactics" ? "Tactics" : "Kenott"} N${j.numero} (anterior)` : idCotizacion(j);
  if (veCostos(req)) {
    // Margen solo de las líneas con costo conocido (las "no está en catálogo" no tienen compra todavía)
    const conCosto = (j.items || []).filter((i) => Number(i.costo) > 0);
    const venta = conCosto.length === (j.items || []).length ? Number(j.subtotal) : conCosto.reduce((s, i) => s + Number(i.precio) * Number(i.cantidad), 0);
    const costo = conCosto.length === (j.items || []).length ? Number(j.costo_total || 0) : conCosto.reduce((s, i) => s + Number(i.costo) * Number(i.cantidad), 0);
    j.margen = Math.round(venta - costo);
    j.margen_pct = venta ? Math.round((j.margen / venta) * 100) : 0;
    j.lineas_sin_costo = (j.items || []).length - conCosto.length;
    return j;
  }
  delete j.costo_total;
  j.items = (j.items || []).map(({ costo, proveedor, ...resto }) => resto);
  return j;
};

// Correlativo de cada empresa: el mayor entre el último usado y su parámetro de "último N°", + 1.
// Las cotizaciones "anteriores" (antes de partir en N°100) no cuentan.
const siguienteNumero = async (t, empresa = "kenott") => {
  const params = await getParametros(t);
  const [[fila]] = await sequelize.query(
    `SELECT COALESCE(MAX(CASE WHEN numero ~ '^[0-9]+$' THEN numero::int END), 0) AS max FROM cotizaciones WHERE empresa = :empresa AND anterior = false`,
    { transaction: t, replacements: { empresa } }
  );
  const n = Math.max(Number(fila.max) || 0, Number(datosEmpresa(empresa, params).ultimo_numero) || 0) + 1;
  return String(n).padStart(3, "0");
};

// Las cotizaciones abiertas cuya validez ya pasó quedan como "vencida"
const marcarVencidas = () => Cotizacion.update(
  { estado: "vencida", motivo_estado: "Venció su validez" },
  { where: { estado: "cotizacion", fecha_validez: { [Op.lt]: hoyISO() } } }
);

// Arma los items. Cada línea queda en uno de tres casos (M20):
//   mismo   → producto del catálogo; precio convenio o particular
//   similar → se cotiza con un producto parecido nuestro (nota interna con el producto usado)
//   nuevo   → no está en catálogo: va la descripción del cliente y el precio se llena a mano
// Lo que se imprime es la descripción del cliente cuando existe; el producto nuestro solo se ve en la vista interna.
// El precio de venta se calcula por tipo de cliente salvo que venga corregido a mano.
// Si una línea ya existía en la cotización, conserva su costo (no cambia el margen).
const CASOS = ["mismo", "similar", "nuevo"];
const armarItems = async (itemsBody, tipo, anteriores, t) => {
  if (!Array.isArray(itemsBody) || itemsBody.length === 0) throw new ErrorNegocio("Debe incluir al menos una línea");
  const params = await getParametros(t);
  const ids = itemsBody.map((i) => Number(i.producto_id ?? i.id)).filter(Boolean);
  const productos = ids.length ? await Producto.findAll({ where: { id: ids }, transaction: t }) : [];
  const mapa = new Map(productos.map((p) => [p.id, p]));
  const previos = new Map((anteriores || []).map((i) => [i.producto_id ? `p${i.producto_id}` : `c${i.clave}`, i]));
  return itemsBody.map((b, idx) => {
    const producto_id = Number(b.producto_id ?? b.id) || null;
    const cantidad = Number(b.cantidad);
    if (!(cantidad > 0)) throw new ErrorNegocio(`Cantidad inválida en la línea ${idx + 1}`);
    const precioDado = b.precio === "" || b.precio == null ? null : Number(b.precio);
    if (precioDado !== null && !(precioDado >= 0)) throw new ErrorNegocio(`Precio inválido en la línea ${idx + 1}`);
    const desc = String(b.descripcion_cliente || "").trim() || null;
    const comun = {
      cantidad,
      grupo: b.grupo !== undefined ? (String(b.grupo || "").trim() || null) : null, // grupo del presupuesto (M27)
      nota_interna: String(b.nota_interna || "").trim() || null,
      // Conversión de unidades a envases (ej. 2.000 un = 2 cajas de 1.000): "convertido" guarda la cantidad pedida,
      // "sin_conversion" que ya se revisó y la cantidad está bien
      envase: b.envase && typeof b.envase === "object" ? { convertido: Number(b.envase.convertido) || null, sin_conversion: !!b.envase.sin_conversion } : null,
    };
    if (!producto_id) {
      // No está en catálogo (rojo): descripción del cliente y precio a mano
      if (!desc) throw new ErrorNegocio(`La línea ${idx + 1} no tiene producto ni descripción del cliente`);
      return {
        ...comun, producto_id: null, clave: String(b.clave || `n${Date.now()}${idx}`), codigo: null,
        nombre: desc, descripcion_cliente: desc, unidad: String(b.unidad || "UNIDAD").toUpperCase(),
        precio: precioDado ?? 0, costo: Number(b.costo) || 0, proveedor: null, fecha_precio: null, caso: "nuevo",
      };
    }
    const p = mapa.get(producto_id);
    if (!p) throw new ErrorNegocio(`Producto ${producto_id} no existe`, 404);
    const previo = previos.get(`p${p.id}`);
    const costo = previo && previo.costo !== undefined ? Number(previo.costo) : Number(p.precio_compra) || 0;
    const caso = CASOS.includes(b.caso) && b.caso !== "nuevo" ? b.caso : "mismo";
    return {
      ...comun,
      producto_id: p.id,
      // Clave de la línea: el mismo producto puede ir en varias líneas (ej. tinetas de distintos colores)
      ...(b.clave ? { clave: String(b.clave).slice(0, 40) } : {}),
      codigo: p.codigo,
      nombre: p.nombre,
      descripcion_cliente: desc,
      unidad: p.unidad,
      precio: precioDado ?? precioVenta(costo, tipo, params),
      costo,
      proveedor: previo?.proveedor ?? p.proveedor ?? null,
      fecha_precio: previo?.fecha_precio ?? p.fecha_precio ?? null,
      caso,
      // Similar: nota interna con el producto usado
      nota_interna: comun.nota_interna || (caso === "similar" ? `Cotizado con similar: ${p.nombre}` : null),
    };
  });
};

// Presupuesto de la licitación: { total, grupos: [{ nombre, monto }] } (montos con IVA)
const limpiarPresupuesto = (p) => {
  if (!p) return null;
  const grupos = (Array.isArray(p.grupos) ? p.grupos : [])
    .map((g) => ({ nombre: String(g.nombre || "").trim(), monto: Math.round(Number(g.monto) || 0) }))
    .filter((g) => g.nombre);
  const total = Math.round(Number(p.total) || 0);
  // Descuento interno aplicado para cuadrar al presupuesto (queda anotado; no se imprime)
  const ajuste = p.ajuste && Number(p.ajuste.pct) > 0 ? { tipo: "cuadrar", pct: Math.round(Number(p.ajuste.pct) * 10) / 10, fecha: String(p.ajuste.fecha || "").slice(0, 10) } : null;
  return total || grupos.length ? { total: total || null, grupos, ...(ajuste ? { ajuste } : {}) } : null;
};

// Postulación doble (M32, art. 60). Decisión de gerencia (5-nov-2026): Kenott y Tactics tienen representantes
// distintos y son empresas distintas, así que pueden postular las dos al mismo proceso (licitación o Compra Ágil).
// Ya no se bloquea: solo queda registrado en la licitación que postulan "ambas".
const esSolicitudMP = (id) => /^\d+-\d+-[A-Z][A-Z0-9]{1,5}$/i.test(String(id || "").trim());
const revisarPostulacion = async ({ id_solicitud, empresa, id, forzar }, t) => {
  if (!esSolicitudMP(id_solicitud)) return;
  const otra = await Cotizacion.findOne({
    where: { id_solicitud: { [Op.iLike]: String(id_solicitud).trim() }, empresa: { [Op.ne]: empresa }, estado: { [Op.notIn]: ["rechazada", "vencida"] }, ...(id ? { id: { [Op.ne]: id } } : {}) },
    transaction: t,
  });
  if (otra && !forzar && process.env.AVISO_ART60 === "1") {
    throw new ErrorNegocio(`Ya hay una cotización de ${otra.empresa === "tactics" ? "Tactics" : "Kenott"} (N${otra.numero}) para el proceso ${id_solicitud}. Si las dos empresas postulan al mismo proceso, el art. 60 del reglamento de compras públicas puede dejar inadmisibles ambas ofertas (empresas relacionadas). ¿Guardar igual?`, 409);
  }
};
// El nombre no repite el ID del proceso (ya va en su recuadro): "Compra Ágil 2440-2281-COT26 – Materiales..." -> "Materiales..."
const sinIdEnNombre = (nombre, id) => {
  if (!nombre || !id) return nombre;
  const esc = String(id).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(nombre).replace(new RegExp(`^\\s*(compra\\s+[áa]gil|licitaci[óo]n)?\\s*${esc}\\s*[–—-]?\\s*`, "i"), "").trim() || nombre;
};
// Anota en la licitación qué empresa postula (o "ambas")
const anotarPostulacion = async (id_solicitud, t) => {
  if (!esSolicitudMP(id_solicitud)) return;
  const l = await Licitacion.findByPk(String(id_solicitud).trim().toUpperCase(), { transaction: t }) || await Licitacion.findOne({ where: { codigo: { [Op.iLike]: String(id_solicitud).trim() } }, transaction: t });
  if (!l) return;
  const [rows] = await sequelize.query(`SELECT DISTINCT empresa FROM cotizaciones WHERE id_solicitud ILIKE :id AND estado NOT IN ('rechazada','vencida')`, { replacements: { id: String(id_solicitud).trim() }, transaction: t });
  const empresas = rows.map((r) => r.empresa);
  const empresa_postula = empresas.length > 1 ? "ambas" : empresas[0] || l.empresa_postula;
  await l.update({ empresa_postula, ...(l.estado_interno === "nueva" || l.estado_interno === "revisada" ? { estado_interno: "cotizada" } : {}) }, { transaction: t });
};

const datosCliente = async (body, t) => {
  if (body.cliente_id) {
    const c = await Cliente.findByPk(body.cliente_id, { transaction: t });
    if (!c) throw new ErrorNegocio("Cliente no encontrado", 404);
    // Cliente general: el nombre se escribe solo para este documento
    const nombre = c.codigo === "P-001" && String(body.cliente || "").trim() && body.cliente !== c.nombre ? String(body.cliente).trim() : c.nombre;
    return { cliente_id: c.id, cliente: nombre, codigo_cliente: c.codigo, tipo_precio: body.tipo_precio || c.tipo || "convenio" };
  }
  return { cliente_id: null, cliente: body.cliente || null, codigo_cliente: null, tipo_precio: body.tipo_precio || "convenio" };
};

// Cotizaciones abiertas a las que hay que llamar: la próxima fecha de contacto llegó, o no se ha
// hablado con el cliente en `dias_seguimiento` días desde que se envió (o desde el último contacto).
const wherePorSeguir = async () => {
  const params = await getParametros();
  const dias = Number(params.dias_seguimiento) || 5;
  const hoy = hoyISO();
  const limite = sumarDias(hoy, -dias);
  return {
    estado: "cotizacion",
    [Op.or]: [
      { proximo_contacto: { [Op.lte]: hoy } },
      { proximo_contacto: null, [Op.and]: [sequelize.where(sequelize.fn("COALESCE", sequelize.col("ultimo_contacto"), sequelize.col("fecha")), { [Op.lte]: limite })] },
    ],
  };
};

// GET /api/cotizaciones?estado=&busqueda=&seguimiento=1
const getCotizaciones = handler(async (req, res) => {
  await marcarVencidas();
  const { estado, busqueda } = req.query;
  const where = req.query.seguimiento === "1" ? await wherePorSeguir() : {};
  if (estado === "enviadas") where.estado = ["cotizacion", "aceptada", "rechazada", "vencida"];
  else if (estado) where.estado = estado;
  if (req.query.empresa) where.empresa = req.query.empresa;
  if (busqueda) where[Op.or] = ["numero", "cliente", "nombre_cotizacion", "id_solicitud"].map((c) => ({ [c]: { [Op.iLike]: `%${busqueda}%` } }));
  const data = await Cotizacion.findAll({ where, order: [["anterior", "ASC"], ["createdAt", "DESC"]] });
  // Las que se postularon en Mercado Público (confirmado a mano en Licitaciones)
  const ids = data.map((c) => c.id);
  const [pos] = ids.length ? await sequelize.query(`SELECT postulada_cotizacion_id AS id, codigo, postulada_en FROM licitaciones WHERE postulada_cotizacion_id IN (:ids)`, { replacements: { ids } }) : [[]];
  const porId = Object.fromEntries(pos.map((p) => [p.id, { codigo: p.codigo, fecha: p.postulada_en }]));
  res.json({ ok: true, data: data.map((c) => ({ ...vista(req)(c), postulada: porId[c.id] || null })) });
});

// GET /api/cotizaciones/:id
const getCotizacion = handler(async (req, res) => {
  const cot = await Cotizacion.findByPk(req.params.id);
  if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
  res.json({ ok: true, data: vista(req)(cot) });
});

// POST /api/cotizaciones
// { cliente_id | cliente, tipo_precio, nombre_cotizacion, validez_dias, estado: borrador|cotizacion, notas,
//   items: [{ producto_id, cantidad, precio?, descripcion_cliente? }] }
const crearCotizacion = handler(async (req, res) => {
  const b = req.body || {};
  const cot = await sequelize.transaction(async (t) => {
    const { codigo_cliente, ...cliente } = await datosCliente(b, t);
    const items = await armarItems(b.items, cliente.tipo_precio, null, t);
    const params = await getParametros(t);
    const fecha = hoyISO();
    const validez = Number(b.validez_dias) || Number(params.validez_cotizacion_dias) || 30;
    const empresa = validarEmpresa(b.empresa);
    const idSol = String(b.id_solicitud || "").trim() || (codigo_cliente && codigo_cliente !== "P-001" ? codigo_cliente : null);
    await revisarPostulacion({ id_solicitud: idSol, empresa, forzar: b.forzar }, t);
    const numero = await siguienteNumero(t, empresa);
    const nueva = await Cotizacion.create({
      numero, empresa, ...cliente,
      // ID impreso: el de la solicitud (licitación / compra ágil) o, si no hay, el del cliente
      id_solicitud: idSol,
      presupuesto: limpiarPresupuesto(b.presupuesto),
      lugar_entrega: String(b.lugar_entrega || "").trim() || null,
      plazo_entrega: String(b.plazo_entrega || "").trim() || params.plazo_entrega || null,
      nombre_cotizacion: sinIdEnNombre(b.nombre_cotizacion, b.id_solicitud) || null, // se imprime como "Descripción" (Kenott) o "Proyecto" (Tactics)
      fecha, validez_dias: validez, fecha_validez: sumarDias(fecha, validez),
      estado: EDITABLES.includes(b.estado) ? b.estado : "cotizacion",
      notas: b.notas || null,
      archivo_cliente: b.archivo_cliente || null,
      items, ...calcularTotales(items),
      costo_total: items.reduce((s, i) => s + i.costo * i.cantidad, 0),
      creado_por: firma(req),
    }, { transaction: t });
    await anotarPostulacion(idSol, t);
    // El cliente toma como ID su unidad de compra de Mercado Público (si tenía un ID automático)
    const unidad = await asignarUnidadCliente(nueva.cliente_id, idSol, t);
    if (unidad) await nueva.reload({ transaction: t });
    return nueva;
  });
  res.status(201).json({ ok: true, data: vista(req)(cot) });
});

// PUT /api/cotizaciones/:id   (solo borrador o cotización abierta)
const actualizarCotizacion = handler(async (req, res) => {
  const b = req.body || {};
  const cot = await sequelize.transaction(async (t) => {
    const c = await Cotizacion.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!c) throw new ErrorNegocio("Cotización no encontrada", 404);
    if (!EDITABLES.includes(c.estado)) throw new ErrorNegocio(`No se puede editar una cotización ${c.estado}`);
    const cambios = {};
    if ("cliente_id" in b || "cliente" in b || "tipo_precio" in b) {
      const { codigo_cliente, ...cli } = await datosCliente({ cliente_id: c.cliente_id, cliente: c.cliente, ...b }, t);
      Object.assign(cambios, cli);
      // Si cambia el cliente y no se indicó otro ID, toma el del cliente nuevo
      if (cli.cliente_id !== c.cliente_id && !("id_solicitud" in b) && codigo_cliente && codigo_cliente !== "P-001") cambios.id_solicitud = codigo_cliente;
    }
    if (b.id_solicitud !== undefined) cambios.id_solicitud = String(b.id_solicitud || "").trim() || null;
    if (b.plazo_entrega !== undefined) cambios.plazo_entrega = String(b.plazo_entrega || "").trim() || null;
    if (b.presupuesto !== undefined) cambios.presupuesto = limpiarPresupuesto(b.presupuesto);
    if (b.lugar_entrega !== undefined) cambios.lugar_entrega = String(b.lugar_entrega || "").trim() || null;
    if (b.items) {
      const items = await armarItems(b.items, cambios.tipo_precio || c.tipo_precio, b.actualizar_costos ? null : c.items, t);
      Object.assign(cambios, { items, ...calcularTotales(items), costo_total: items.reduce((s, i) => s + i.costo * i.cantidad, 0) });
    }
    if (b.nombre_cotizacion !== undefined) cambios.nombre_cotizacion = sinIdEnNombre(b.nombre_cotizacion, b.id_solicitud !== undefined ? b.id_solicitud : c.id_solicitud);
    if (b.notas !== undefined) cambios.notas = b.notas;
    if (b.validez_dias) {
      cambios.validez_dias = Number(b.validez_dias);
      cambios.fecha_validez = sumarDias(c.fecha || hoyISO(), b.validez_dias);
    }
    if (b.estado && EDITABLES.includes(b.estado)) {
      cambios.estado = b.estado;
      // Al enviarla (finalizar) empieza a correr su validez desde hoy
      if (b.estado === "cotizacion" && c.estado !== "cotizacion") {
        cambios.fecha = hoyISO();
        cambios.fecha_validez = sumarDias(hoyISO(), cambios.validez_dias || c.validez_dias || 30);
      }
    }
    // Cambiar de empresa le da el número siguiente de la otra empresa
    if (b.empresa && validarEmpresa(b.empresa) !== c.empresa) {
      if (c.anterior) throw new ErrorNegocio("Una cotización anterior no se puede cambiar de empresa");
      cambios.empresa = validarEmpresa(b.empresa);
      cambios.numero = await siguienteNumero(t, cambios.empresa);
      if ((c.nombre_cotizacion || "") === `Cotización ${c.numero}`) cambios.nombre_cotizacion = `Cotización ${cambios.numero}`;
    }
    await revisarPostulacion({ id_solicitud: cambios.id_solicitud !== undefined ? cambios.id_solicitud : c.id_solicitud, empresa: cambios.empresa || c.empresa, id: c.id, forzar: b.forzar }, t);
    const solAnterior = c.id_solicitud;
    await c.update(cambios, { transaction: t });
    await anotarPostulacion(c.id_solicitud, t);
    await asignarUnidadCliente(c.cliente_id, c.id_solicitud, t);
    if (solAnterior && solAnterior !== c.id_solicitud) await anotarPostulacion(solAnterior, t);
    return c;
  });
  res.json({ ok: true, data: vista(req)(cot) });
});

// POST /api/cotizaciones/:id/estado   { estado: cotizacion|rechazada|vencida|borrador, motivo }
// "aceptada" se marca solo al convertirla en venta.
const cambiarEstado = handler(async (req, res) => {
  const { estado, motivo } = req.body || {};
  if (!ESTADOS.includes(estado) || estado === "aceptada") throw new ErrorNegocio("Estado inválido. Para aceptarla, conviértela en venta.");
  const cot = await Cotizacion.findByPk(req.params.id);
  if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
  if (cot.estado === "aceptada") throw new ErrorNegocio("La cotización ya es una venta. Anula la venta para reabrirla.");
  const cambios = { estado, motivo_estado: motivo || null };
  // Reabrir una vencida le da una nueva validez desde hoy
  if (estado === "cotizacion" && cot.estado === "vencida") cambios.fecha_validez = sumarDias(hoyISO(), cot.validez_dias || 30);
  await cot.update(cambios);
  res.json({ ok: true, data: vista(req)(cot) });
});

// POST /api/cotizaciones/:id/seguimiento   { nota, proximo_contacto (AAAA-MM-DD) | dias }
// Registra que se habló con el cliente y cuándo volver a llamar.
const registrarSeguimiento = handler(async (req, res) => {
  const cot = await Cotizacion.findByPk(req.params.id);
  if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
  if (cot.estado !== "cotizacion") throw new ErrorNegocio("Solo se hace seguimiento a cotizaciones abiertas");
  const params = await getParametros();
  const hoy = hoyISO();
  const proximo = req.body?.proximo_contacto
    || (req.body?.dias === 0 || req.body?.dias === "0" ? null : sumarDias(hoy, Number(req.body?.dias) || Number(params.dias_seguimiento) || 5));
  const historial = [...(cot.seguimientos || []), { fecha: new Date().toISOString(), nota: req.body?.nota || "", usuario: firma(req), proximo }];
  await cot.update({ seguimientos: historial, ultimo_contacto: hoy, proximo_contacto: proximo });
  res.json({ ok: true, data: vista(req)(cot) });
});

// GET /api/cotizaciones/por-seguir/cantidad
const cantidadPorSeguir = handler(async (req, res) => {
  await marcarVencidas();
  res.json({ ok: true, data: { cantidad: await Cotizacion.count({ where: await wherePorSeguir() }) } });
});

// DELETE /api/cotizaciones/:id
const eliminarCotizacion = handler(async (req, res) => {
  const cot = await Cotizacion.findByPk(req.params.id);
  if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
  if (cot.estado === "aceptada") throw new ErrorNegocio("No se puede borrar una cotización convertida en venta");
  await cot.destroy();
  res.json({ ok: true, message: "Cotización eliminada" });
});

// GET /api/cotizaciones/:id/pedido-proveedor
// Excel para pedir precio a proveedores: las líneas sin costo, con lo que pidió el cliente (sin precios nuestros)
// Especialidad de una línea para separar el pedido por rubro (pinturas, eléctrico...): la categoría del producto
// del catálogo; si no tiene (o es genérica), se deduce de la descripción
const ESPECIALIDADES = [
  ["PINTURAS", /PINTURA|ESMALTE|LATEX|L[AÁ]TEX|BARNIZ|DILUYENTE|AGUARRAS|BROCHA|RODILLO|ANTICORROSIVO|SELLADOR|IMPERMEABILIZ|MASILLA|LIJA/],
  ["ELÉCTRICO", /CABLE|ENCHUFE|INTERRUPTOR|AMPOLLETA|\bLED\b|TABLERO|AUTOM[AÁ]TICO|EL[EÉ]CTRIC|CANALETA|CONDUIT|ALARGADOR|ZAPATILLA|FOCO|PORTALAMPARA|DIFERENCIAL|EVA\b|THHN|NYA|RISER/],
  ["GASFITERÍA", /PVC|CODO|COPLA|\bTEE\b|LLAVE DE PASO|GRIFER|FLEXIBLE|SIF[OÓ]N|GASFITER|TERMOFUSI|CA[NÑ]ER[IÍ]A|DESAG[UÜ]E|ESTANQUE|WC|LAVAMANOS|TEFL[OÓ]N/],
  ["CONSTRUCCIÓN", /CEMENTO|FIERRO|ARENA|GRAVA|RIPIO|LADRILLO|HORMIG[OÓ]N|YESO|VOLCANITA|PLANCHA|MADERA|PINO|TERCIADO|OSB|ZINC|CER[AÁ]MIC|ADHESIVO|MORTERO|MALLA|PERFIL|CLAVO|ALAMBRE/],
  ["HERRAMIENTAS", /BROCA|DISCO|ALICATE|MARTILLO|DESTORNILLADOR|HERRAMIENTA|SIERRA|HUINCHA|TALADRO|ESMERIL|NIVEL|LLANA|PALA|CARRETILLA|ESCALERA|SERRUCHO|FORMON|LLAVE (PUNTA|CORONA|FRANCESA|STILSON)/],
  ["FIJACIONES", /TORNILLO|PERNO|TARUGO|ROSCALATA|FIJACI|TUERCA|GOLILLA|REMACHE|ANCLAJE|BISAGRA|CANDADO|CERRADURA|PICAPORTE/],
  ["EPP", /GUANTE|CASCO|LENTE|ZAPATO|MASCARILLA|\bEPP\b|CHALECO|ARN[EÉ]S|PROTECTOR|OVEROL|BOTA/],
  ["ASEO", /DETERGENTE|CLORO|ESCOBA|LIMPIA|ASEO|PAPEL|BOLSA|TRAPERO|DESINFECT|JAB[OÓ]N|PALA DE BASURA|BASURERO/],
];
const GENERICAS = /^(GENERAL|POR CLASIFICAR|OTROS?|VARIOS|FERRETER[IÍ]A( GENERAL)?)$/i;
const especialidadDe = (texto, categoria) => {
  if (categoria && !GENERICAS.test(String(categoria).trim())) return String(categoria).trim().toUpperCase();
  const t = String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const e = ESPECIALIDADES.find(([, re]) => re.test(t) || re.test(String(texto || "").toUpperCase()));
  return e ? e[0] : "OTROS";
};

// GET /api/cotizaciones/:id/pedido-proveedor?modo=sin_precio|todas
// Excel para pedir precio a proveedores, SIN nuestros valores: hoja General con todo y una hoja por especialidad
// (pinturas, eléctrico, gasfitería...), para enviar cada parte al proveedor que corresponde.
const descargarPedidoProveedor = async (req, res) => {
  try {
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });
    const ExcelJS = require("exceljs");
    const emp = datosEmpresa(cot.empresa, await getParametros());
    const items = cot.items || [];
    const sinPrecio = items.filter((i) => !(Number(i.costo) > 0));
    // Nunca vacío: si todas tienen precio (o se pidió), van todas
    const lineas = req.query.modo === "todas" || req.query.todas === "1" || !sinPrecio.length ? items : sinPrecio;
    const ids = [...new Set(lineas.map((i) => i.producto_id).filter(Boolean))];
    const cats = new Map((ids.length ? await Producto.findAll({ where: { id: ids }, attributes: ["id", "categoria"], raw: true }) : []).map((p) => [p.id, p.categoria]));
    const filas = lineas.map((i, k) => ({ n: k + 1, desc: i.descripcion_cliente || i.nombre, cant: Number(i.cantidad), unidad: i.unidad || "", esp: especialidadDe(i.descripcion_cliente || i.nombre, cats.get(i.producto_id)) }));

    const wb = new ExcelJS.Workbook();
    const hoja = (nombre, lista, conEsp) => {
      const ws = wb.addWorksheet(nombre.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
      ws.columns = conEsp
        ? [{ width: 6 }, { width: 18 }, { width: 60 }, { width: 11 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 28 }]
        : [{ width: 6 }, { width: 62 }, { width: 11 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 28 }];
      ws.addRow([`SOLICITUD DE COTIZACIÓN · ${emp.nombre || (cot.empresa === "tactics" ? "Tactics Inversiones" : "Inversiones Kenott")}${conEsp ? "" : ` · ${nombre}`}`]).font = { bold: true, size: 13 };
      ws.addRow([`Referencia: ${idCotizacion(cot)}${cot.lugar_entrega ? ` · Entrega en ${cot.lugar_entrega}` : ""} · Fecha ${hoyISO().split("-").reverse().join("-")}`]);
      ws.addRow(["Por favor indicar precio unitario NETO (sin IVA), marca y plazo de entrega."]);
      ws.addRow([]);
      const titulos = ["N°", ...(conEsp ? ["Especialidad"] : []), "Descripción", "Cantidad", "Unidad", "Precio unit. neto", "Marca", "Observación / plazo"];
      const h = ws.addRow(titulos);
      h.font = { bold: true, color: { argb: "FFFFFFFF" } };
      h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF26747B" } }; });
      lista.forEach((f, k) => {
        const r = ws.addRow([conEsp ? f.n : k + 1, ...(conEsp ? [f.esp] : []), f.desc, f.cant, f.unidad, null, "", ""]);
        const cDesc = conEsp ? 3 : 2, cPrecio = conEsp ? 6 : 5;
        r.getCell(cDesc).alignment = { wrapText: true, vertical: "top" };
        r.getCell(cPrecio).numFmt = '"$"#,##0';
        r.eachCell({ includeEmpty: true }, (c, n) => { if (n <= titulos.length) c.border = { bottom: { style: "hair", color: { argb: "FFBBBBBB" } } }; });
      });
      ws.views = [{ state: "frozen", ySplit: 5 }];
    };
    hoja("General", [...filas].sort((a, b) => a.esp.localeCompare(b.esp) || a.n - b.n), true);
    const grupos = [...new Set(filas.map((f) => f.esp))].sort();
    if (grupos.length > 1) for (const g of grupos) hoja(g, filas.filter((f) => f.esp === g), false);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Pedido_cotizacion_${idCotizacion(cot)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ ok: false, error: "No se pudo generar el Excel" });
  }
};

// POST /api/cotizaciones/:id/leer-proveedor   (multipart: archivo)
// Lee la cotización del proveedor y propone, para cada línea de nuestra cotización, el precio que corresponde.
const leerProveedor = handler(async (req, res) => {
  const cot = await Cotizacion.findByPk(req.params.id);
  if (!cot) throw new ErrorNegocio("Cotización no encontrada", 404);
  if (!req.file) throw new ErrorNegocio("Adjunta la cotización del proveedor");
  const doc = await ia.extraerDocumentoProveedor(req.file, firma(req));
  // Se calza cada línea del proveedor contra las líneas de esta cotización (no contra todo el catálogo)
  const items = cot.items || [];
  const indice = ia.crearIndice(items.map((i, k) => ({ id: k + 1, nombre: `${i.descripcion_cliente || ""} ${i.nombre || ""}`.trim(), unidad: i.unidad })));
  const calzadas = await ia.calzarLineas(doc.lineas, indice, { usuario: firma(req), tipo: "cotizacion_proveedor", archivo: req.file.originalname });
  const RANGO = { exacto: 0, equivalente: 1, parecido: 2 };
  const elegidas = new Set();
  const propuesta = items.map((i, k) => {
    const l = calzadas.filter((c) => c.producto_id === k + 1 && c.calce !== "sin_producto" && !elegidas.has(c))
      .sort((a, b2) => (RANGO[a.calce] ?? 3) - (RANGO[b2.calce] ?? 3))[0];
    if (l) elegidas.add(l);
    return {
      idx: k, descripcion: i.descripcion_cliente || i.nombre, cantidad: i.cantidad, unidad: i.unidad, costo_actual: Number(i.costo) || 0,
      producto: i.producto_id ? `${i.codigo} · ${i.nombre}` : null,
      proveedor_linea: l ? { descripcion: l.descripcion, precio_neto: l.precio_neto, marca: l.marca, unidad: l.unidad, calce: l.calce, nota: l.nota } : null,
    };
  });
  const usadas = new Set([...elegidas].map((c) => c.descripcion));
  res.json({ ok: true, data: { encabezado: doc.encabezado, control: doc.control, archivo: req.file.originalname, propuesta, sin_usar: doc.lineas.filter((l) => !usadas.has(l.descripcion)).map((l) => ({ descripcion: l.descripcion, precio_neto: l.precio_neto })) } });
});

// POST /api/cotizaciones/:id/aplicar-proveedor
// { proveedor, documento, fecha, lineas: [{ idx, precio, descripcion_proveedor, marca }] }
// Guarda el precio en el catálogo (historial del proveedor; las líneas que no estaban en catálogo se crean como
// producto nuevo en POR CLASIFICAR) y actualiza el costo y el precio de venta de esas líneas. Vuelve a "En ejecución".
const aplicarProveedor = handler(async (req, res) => {
  const b = req.body || {};
  const proveedor = normProv(b.proveedor);
  if (!proveedor) throw new ErrorNegocio("Indica el proveedor");
  const lineas = (b.lineas || []).filter((l) => Number(l.precio) > 0);
  if (!lineas.length) throw new ErrorNegocio("No hay precios para aplicar");
  const cot = await sequelize.transaction(async (t) => {
    const c = await Cotizacion.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!c) throw new ErrorNegocio("Cotización no encontrada", 404);
    if (!EDITABLES.includes(c.estado)) throw new ErrorNegocio(`No se puede modificar una cotización ${c.estado}`);
    let ficha = await Proveedor.findOne({ where: sequelize.where(sequelize.fn("upper", sequelize.col("nombre")), proveedor), transaction: t });
    if (!ficha) ficha = await Proveedor.create({ nombre: proveedor, tipo: "proveedor" }, { transaction: t });
    const origen = await origenDe(ficha.nombre, t);
    const params = await getParametros(t);
    const items = (c.items || []).map((i) => ({ ...i }));
    let siguiente = (Number(await Producto.max("codigo", { transaction: t })) || 0) + 1;
    for (const l of lineas) {
      const it = items[Number(l.idx)];
      if (!it) continue;
      const precio = Math.round(Number(l.precio));
      let p = it.producto_id ? await Producto.findByPk(it.producto_id, { transaction: t, lock: t.LOCK.UPDATE }) : null;
      if (!p) {
        p = await Producto.create({ codigo: siguiente++, nombre: String(it.descripcion_cliente || it.nombre).trim().toUpperCase().slice(0, 250), categoria: "POR CLASIFICAR", unidad: String(it.unidad || "UNIDAD").toUpperCase() }, { transaction: t });
        await registrar({ usuario: firma(req), tabla: "productos", registro_id: p.id, campo: "creado", despues: p.nombre, motivo: `Desde cotización ${idCotizacion(c)} (precio de ${ficha.nombre})` }, t);
      }
      await PrecioProveedor.create({
        producto_id: p.id, proveedor: ficha.nombre, precio, fecha: b.fecha || new Date(), documento: b.documento || null,
        descripcion_proveedor: l.descripcion_proveedor || null, marca: l.marca || null, unidad: it.unidad || null, cantidad: it.cantidad || null,
        origen, creado_por: firma(req),
      }, { transaction: t });
      await recalcular(p, { t, usuario: firma(req), motivo: `Cotización ${ficha.nombre} ${b.documento || ""} para ${idCotizacion(c)}`.trim() });
      Object.assign(it, {
        producto_id: p.id, codigo: p.codigo, nombre: p.nombre, caso: it.caso === "nuevo" ? "mismo" : it.caso,
        costo: precio, proveedor: ficha.nombre, fecha_precio: b.fecha || hoyISO(),
        precio: precioVenta(precio, c.tipo_precio, params),
      });
    }
    await c.update({ items, ...calcularTotales(items), costo_total: items.reduce((s, i) => s + Number(i.costo || 0) * Number(i.cantidad), 0), estado: c.estado === "espera_proveedor" ? "borrador" : c.estado }, { transaction: t });
    return c;
  });
  res.json({ ok: true, data: vista(req)(cot) });
});

// GET /api/cotizaciones/:id/excel   (plantilla de la empresa, sin costos)
const limpioArchivo = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s.-]/g, "").trim().slice(0, 60) || "cliente";
const nombreArchivo = (cot, ext) => `${idCotizacion(cot)}${cot.anterior ? "_anterior" : ""}-${limpioArchivo(cot.cliente)}.${ext}`;
const descargarExcel = async (req, res) => {
  try {
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });
    const wb = await excelCotizacion(cot.toJSON(), datosEmpresa(cot.empresa, await getParametros()));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo(cot, "xlsx")}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ ok: false, error: error.message });
  }
};

// GET /api/cotizaciones/:id/interna   (hoja de referencia interna con costos: no se envía)
const descargarInterna = async (req, res) => {
  try {
    if (!veCostos(req)) return res.status(403).json({ ok: false, error: "Sin acceso a costos" });
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });
    const wb = await excelInterno(cot.toJSON(), await getParametros(), precioVenta);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="INTERNA_${nombreArchivo(cot, "xlsx")}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ ok: false, error: error.message });
  }
};

// GET /api/cotizaciones/:id/pdf   (plantilla de la empresa, sin costos)
const descargarPdf = async (req, res) => {
  try {
    const cot = await Cotizacion.findByPk(req.params.id);
    if (!cot) return res.status(404).json({ ok: false, error: "Cotización no encontrada" });
    const emp = datosEmpresa(cot.empresa, await getParametros());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo(cot, "pdf")}"`);
    pdfCotizacion(cot.toJSON(), emp, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ ok: false, error: error.message });
  }
};

module.exports = {
  descargarPedidoProveedor, leerProveedor, aplicarProveedor,
  registrarSeguimiento, cantidadPorSeguir, wherePorSeguir,
  descargarPdf, descargarInterna,
  getCotizaciones, getCotizacion, crearCotizacion, actualizarCotizacion, cambiarEstado, eliminarCotizacion, descargarExcel,
};
