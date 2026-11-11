const { firma } = require("../middlewares/auth");
const { Op, fn, col, literal } = require("sequelize");
const sequelize = require("../../config/database");
const Producto = require("../models/Producto");
const PrecioProveedor = require("../models/PrecioProveedor");
const RegistroCambio = require("../models/RegistroCambio");
const { handler, ErrorNegocio } = require("../services/erp");
const { getParametros, precioVenta } = require("../services/parametros");
const { recalcular, precioNetoUnitario, origenDe, registrar, normProv, SQL_AVISO } = require("../services/precios");
const { esAdmin, veCostos, esGerencia } = require("../middlewares/auth");
const { UNIDADES, normalizarUnidad } = require("../services/unidades");

// Campos de costo que el rol "usuario" no ve
const CAMPOS_COSTO = [
  "precio_compra", "opcion2_proveedor", "opcion2_precio", "opcion2_fecha",
  "opcion3_proveedor", "opcion3_precio", "opcion3_fecha", "revisar", "contacto",
];
// Columnas antiguas sin uso
const CAMPOS_OCULTOS = ["precio_venta", "stock", "stock_minimo"];

// Agrega los precios de venta calculados y oculta costos si corresponde
// Un precio es "antiguo" si su fecha tiene más meses que el parámetro meses_precio_antiguo
const limiteAntiguo = (params) => {
  const d = new Date();
  d.setMonth(d.getMonth() - (Number(params.meses_precio_antiguo) || 6));
  return d.toISOString().slice(0, 10);
};
const vista = (req, params) => (p) => {
  const j = typeof p.toJSON === "function" ? p.toJSON() : { ...p };
  j.precio_antiguo = !!(Number(j.precio_compra) > 0 && j.fecha_precio && String(j.fecha_precio) < limiteAntiguo(params));
  j.precio_convenio = precioVenta(j.precio_compra, "convenio", params);
  j.precio_particular = precioVenta(j.precio_compra, "particular", params);
  CAMPOS_OCULTOS.forEach((c) => delete j[c]);
  if (!veCostos(req)) CAMPOS_COSTO.forEach((c) => delete j[c]);
  return j;
};

// Palabras en cualquier orden, con o sin tilde (como el BUSCADOR de la planilla)
const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const filtroPalabras = (busqueda) => {
  const palabras = sinTildes(String(busqueda)).trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return palabras.map((w) => {
    const patron = `%${w.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const condiciones = [
      sequelize.where(fn("translate", fn("upper", col("nombre")), "ÁÉÍÓÚÜÑ", "AEIOUUN"), { [Op.iLike]: patron }),
      { proveedor: { [Op.iLike]: patron } },
    ];
    if (/^\d+$/.test(w)) condiciones.push({ codigo: Number(w) }, { id: Number(w) });
    return { [Op.or]: condiciones };
  });
};

// Familias que se venden por medida: si la descripción no trae ninguna cifra, falta la medida (M12)
const SQL_SIN_MEDIDA = `(nombre !~ '[0-9]' AND nombre ~* '^(CANDADO|CABLE|TUBO|TUBERIA|CA[NÑ]ERIA|MANGUERA|CADENA|ALAMBRE|PERNO|TORNILLO|CLAVO|BROCA|DISCO|CODO|TEE|COPLA|ABRAZADERA|BISAGRA|LLAVE DE PASO|FIERRO|PERFIL|PLANCHA|TERCIADO|PINO)')`;

// GET /api/productos?busqueda=&categoria=&revision=sin_precio|aviso|confirmados|sin_confirmar&activos=1&sort=&dir=&limite=
const getProductos = handler(async (req, res) => {
  // M13: el orden por defecto es por categoría y descripción (el N° de la planilla puede cambiar)
  const { busqueda, categoria, revision, sort = "categoria", dir = "ASC", limite } = req.query;
  const where = {};
  const y = [];
  if (busqueda) y.push(...filtroPalabras(busqueda));
  if (categoria && categoria !== "Todas") where.categoria = categoria;
  if (revision === "inactivos") where.activo = false;
  else if (req.query.inactivos !== "1") where.activo = true;
  if (revision === "unidad") y.push({ unidad: { [Op.notIn]: UNIDADES } });
  if (revision === "sin_precio") y.push({ [Op.or]: [{ precio_compra: null }, { precio_compra: { [Op.lte]: 0 } }] });
  if (revision === "aviso") y.push(literal(SQL_AVISO));
  if (revision === "confirmados") where.confirmado = true;
  // Agregados en el sistema (no vienen de la planilla) y todavía sin precio: para cotizarlos
  if (revision === "nuevos_sin_precio") { where.en_planilla = false; y.push({ [Op.or]: [{ precio_compra: null }, { precio_compra: { [Op.lte]: 0 } }] }); }
  // M12: productos genéricos (candados, cables...) que no indican medida
  if (revision === "sin_medida") y.push(literal(SQL_SIN_MEDIDA));
  if (revision === "sin_confirmar") y.push({ confirmado: false, precio_compra: { [Op.gt]: 0 } });
  const params0 = await getParametros();
  if (revision === "antiguo") y.push({ precio_compra: { [Op.gt]: 0 }, fecha_precio: { [Op.lt]: limiteAntiguo(params0) } });
  if (y.length) where[Op.and] = y;

  const camposValidos = ["id", "codigo", "nombre", "categoria", "precio_compra", "proveedor", "fecha_precio"];
  const ordenBy = camposValidos.includes(sort) ? sort : "codigo";
  const ordenDir = String(dir).toUpperCase() === "DESC" ? "DESC" : "ASC";

  const [productos] = await Promise.all([
    Producto.findAll({
      where,
      order: [[literal(`"${ordenBy}" IS NULL`), "ASC"], [ordenBy, ordenDir], ...(ordenBy === "categoria" ? [["nombre", "ASC"]] : []), ["id", "ASC"]],
      limit: Math.min(Number(limite) || 5000, 5000),
    }),
  ]);
  const params = params0;
  res.json({ ok: true, data: productos.map(vista(req, params)) });
});

// GET /api/productos/categorias
const getCategorias = handler(async (req, res) => {
  const filas = await Producto.findAll({
    attributes: ["categoria", [fn("COUNT", col("id")), "cantidad"]],
    where: { activo: true },
    group: ["categoria"], order: [["categoria", "ASC"]], raw: true,
  });
  res.json({ ok: true, data: filas.map((f) => ({ categoria: f.categoria, cantidad: Number(f.cantidad) })) });
});

// GET /api/productos/resumen   (para la pantalla Por revisar)
const getResumen = handler(async (req, res) => {
  const lim = limiteAntiguo(await getParametros());
  const [filas] = await sequelize.query(`
    SELECT categoria,
      COUNT(*)::int AS items,
      COUNT(*) FILTER (WHERE precio_compra > 0)::int AS con_precio,
      COUNT(*) FILTER (WHERE precio_compra IS NULL OR precio_compra <= 0)::int AS sin_precio,
      COUNT(*) FILTER (WHERE confirmado)::int AS confirmados,
      COUNT(*) FILTER (WHERE ${SQL_AVISO})::int AS con_aviso,
      COUNT(*) FILTER (WHERE NOT confirmado AND precio_compra > 0)::int AS sin_confirmar,
      COUNT(*) FILTER (WHERE precio_compra > 0 AND fecha_precio < :lim)::int AS antiguos,
      COUNT(*) FILTER (WHERE ${SQL_SIN_MEDIDA})::int AS sin_medida,
      COUNT(*) FILTER (WHERE unidad NOT IN (:unidades))::int AS unidad_por_revisar
    FROM productos WHERE activo GROUP BY categoria ORDER BY categoria`, { replacements: { lim, unidades: UNIDADES } });
  res.json({ ok: true, data: filas });
});

// GET /api/productos/llenados   precios que se llenaron este mes con facturas de compra (productos que no tenían precio)
const getLlenados = handler(async (req, res) => {
  const [[r]] = await sequelize.query(`
    WITH primero AS (
      SELECT DISTINCT ON (h.producto_id) h.producto_id, h.documento, h."createdAt"
      FROM precios_proveedor h JOIN productos p ON p.id = h.producto_id AND p.activo
      WHERE NOT h.descartado AND COALESCE(h.documento, '') <> 'SISTEMA (precio manual)'
      ORDER BY h.producto_id, h."createdAt", h.id)
    SELECT
      COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('month', NOW() AT TIME ZONE 'America/Santiago') AND documento ILIKE 'FACT.%')::int AS con_facturas,
      COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('month', NOW() AT TIME ZONE 'America/Santiago'))::int AS total_mes,
      (SELECT COUNT(*)::int FROM productos WHERE activo AND (precio_compra IS NULL OR precio_compra <= 0)) AS faltan
    FROM primero`);
  res.json({ ok: true, data: r });
});

// GET /api/productos/:id
const getProducto = handler(async (req, res) => {
  const producto = await Producto.findByPk(req.params.id);
  if (!producto) throw new ErrorNegocio("Producto no encontrado", 404);
  res.json({ ok: true, data: vista(req, await getParametros())(producto) });
});

const CAMPOS_EDITABLES = ["codigo", "nombre", "categoria", "unidad", "activo", "certificacion", "ficha_tecnica", "modelo_equivalente"];
const unidadValida = (u) => {
  const n = normalizarUnidad(u);
  if (!n) throw new ErrorNegocio(`Unidad "${u}" no válida. Usa una de: ${UNIDADES.join(", ")}`);
  return n;
};

// --- Repetidos (M9) ---
const PALABRAS_VACIAS = new Set(["DE", "PARA", "CON", "EN", "Y", "EL", "LA", "LOS", "LAS", "DEL", "AL", "X", "TIPO", "C", "S"]);
const tokens = (s) => new Set(sinTildes(String(s || "").toUpperCase()).replace(/[^A-Z0-9.,/]+/g, " ").split(" ").map((w) => w.replace(/[.,]$/, "")).filter((w) => w && !PALABRAS_VACIAS.has(w)));
const parecido = (a, b) => {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let comun = 0;
  for (const w of A) if (B.has(w)) comun += 1;
  return comun / Math.min(A.size, B.size); // cuánto del más corto está contenido en el otro
};
// Busca productos activos con descripción parecida (misma categoría primero)
const buscarSimilares = async (nombre, categoria, excluirId) => {
  const A = [...tokens(nombre)];
  if (!A.length) return [];
  const candidatos = await Producto.findAll({
    where: { activo: true, ...(excluirId ? { id: { [Op.ne]: excluirId } } : {}), [Op.or]: A.filter((w) => w.length >= 3).slice(0, 8).map((w) => ({ nombre: { [Op.iLike]: `%${w}%` } })) },
    attributes: ["id", "codigo", "nombre", "categoria", "unidad", "precio_compra", "proveedor"], limit: 400,
  });
  return candidatos
    .map((p) => ({ ...p.toJSON(), parecido: Math.round((parecido(nombre, p.nombre) + (categoria && p.categoria === categoria ? 0.1 : 0)) * 100) }))
    .filter((p) => p.parecido >= 60)
    .sort((a, b) => b.parecido - a.parecido)
    .slice(0, 6);
};

// GET /api/productos/similares?nombre=&categoria=&excluir=
const getSimilares = handler(async (req, res) => {
  const data = await buscarSimilares(req.query.nombre, req.query.categoria, Number(req.query.excluir) || null);
  res.json({ ok: true, data: veCostos(req) ? data : data.map(({ precio_compra, proveedor, ...r }) => r) });
});

// POST /api/productos/:id/fusionar   { duplicado_id }   (gerencia)
// Junta el historial de precios del repetido en este producto; las cotizaciones, ventas y compras que usaban
// el repetido pasan a este; el repetido queda inactivo con la marca de fusionado.
const fusionar = handler(async (req, res) => {
  const dupId = Number(req.body?.duplicado_id);
  if (!dupId || dupId === Number(req.params.id)) throw new ErrorNegocio("Elige el producto repetido");
  const resultado = await sequelize.transaction(async (t) => {
    const [p, dup] = await Promise.all([Producto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE }), Producto.findByPk(dupId, { transaction: t, lock: t.LOCK.UPDATE })]);
    if (!p || !dup) throw new ErrorNegocio("Producto no encontrado", 404);
    const [, precios] = await sequelize.query(`UPDATE precios_proveedor SET producto_id = :p WHERE producto_id = :d`, { replacements: { p: p.id, d: dup.id }, transaction: t });
    // Líneas de cotizaciones, ventas y órdenes de compra (items en JSON)
    for (const tabla of ["cotizaciones", "ventas", "ordenes_compra"]) {
      await sequelize.query(`UPDATE ${tabla} SET items = (
          SELECT jsonb_agg(CASE WHEN (e->>'producto_id')::int = :d THEN jsonb_set(e, '{producto_id}', to_jsonb(:p::int)) ELSE e END)
          FROM jsonb_array_elements(items) e)
        WHERE items @> :filtro::jsonb`, { replacements: { p: p.id, d: dup.id, filtro: JSON.stringify([{ producto_id: dup.id }]) }, transaction: t });
    }
    await dup.update({ activo: false, fusionado_en: p.id, revisar: `Fusionado con N° ${p.codigo ?? p.id} ${p.nombre}` }, { transaction: t });
    await registrar({ usuario: firma(req), tabla: "productos", registro_id: p.id, campo: "fusion", antes: `${dup.codigo ?? dup.id} ${dup.nombre}`, despues: p.nombre, motivo: "Fusionado (repetido)" }, t);
    await registrar({ usuario: firma(req), tabla: "productos", registro_id: dup.id, campo: "activo", antes: "true", despues: "false", motivo: `Fusionado en ${p.codigo ?? p.id} ${p.nombre}` }, t);
    if (p.confirmado) await p.update({ confirmado: p.confirmado }, { transaction: t });
    await recalcular(p, { t, usuario: firma(req), motivo: "Fusión de repetidos" });
    return { producto: p, precios_movidos: precios?.rowCount ?? null };
  });
  res.json({ ok: true, data: { ...resultado, producto: vista(req, await getParametros())(resultado.producto) } });
});

// POST /api/productos
// Un producto parecido pero distinto (otra calidad, marca o medida) se crea como línea aparte.
const crearProducto = handler(async (req, res) => {
  const datos = Object.fromEntries(CAMPOS_EDITABLES.filter((c) => c in req.body).map((c) => [c, req.body[c]]));
  if (!datos.nombre) throw new ErrorNegocio("La descripción es obligatoria");
  datos.nombre = String(datos.nombre).trim().toUpperCase();
  datos.unidad = unidadValida(datos.unidad || "UNIDAD");
  // Comercial y Operativo agregan productos para cotizar; quedan POR CLASIFICAR para que gerencia los revise
  if (!esGerencia(req)) {
    const sugerida = datos.categoria && !/^POR CLASIFICAR$/i.test(datos.categoria) ? datos.categoria : null;
    datos.categoria = "POR CLASIFICAR";
    datos.revisar = `Agregado por ${firma(req)}${sugerida ? ` · categoría sugerida ${sugerida}` : ""}`.slice(0, 250);
    delete datos.activo;
  }
  // M9: antes de crear, avisa si hay descripciones parecidas (salvo que el usuario confirme que es otro producto, M10)
  if (!req.body.forzar) {
    const similares = await buscarSimilares(datos.nombre, datos.categoria);
    const igual = similares.find((x) => sinTildes(x.nombre) === sinTildes(datos.nombre));
    if (igual) throw new ErrorNegocio(`Ya existe "${igual.nombre}" (N° ${igual.codigo ?? igual.id}).`, 409);
    if (similares.length) {
      return res.status(409).json({ ok: false, error: `Hay ${similares.length} producto(s) parecido(s): ${similares.slice(0, 3).map((x) => `"${x.nombre}"`).join(", ")}. Si es otra marca, calidad o medida, créalo igual como línea aparte.`, similares });
    }
  }
  if (!datos.codigo) {
    const max = await Producto.max("codigo");
    datos.codigo = (Number(max) || 0) + 1;
  }
  const producto = await sequelize.transaction(async (t) => {
    const p = await Producto.create(datos, { transaction: t });
    // Precio inicial opcional (solo admin): queda en el historial
    if (veCostos(req) && Number(req.body.precio_compra) > 0 && req.body.proveedor) {
      await PrecioProveedor.create({
        producto_id: p.id, proveedor: normProv(req.body.proveedor), precio: Math.round(Number(req.body.precio_compra)),
        documento: req.body.documento || null, origen: await origenDe(req.body.proveedor, t), creado_por: firma(req),
      }, { transaction: t });
      await recalcular(p, { t, usuario: firma(req), motivo: "Producto nuevo" });
    }
    await registrar({ usuario: firma(req), tabla: "productos", registro_id: p.id, campo: "creado", despues: p.nombre }, t);
    return p;
  });
  res.status(201).json({ ok: true, data: vista(req, await getParametros())(producto) });
});

// PUT /api/productos/:id   (datos del producto; los precios van por /precios)
const actualizarProducto = handler(async (req, res) => {
  const producto = await sequelize.transaction(async (t) => {
    const p = await Producto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
    const cambios = {};
    for (const c of CAMPOS_EDITABLES) {
      if (!(c in req.body)) continue;
      let v = req.body[c];
      if (c === "nombre") v = String(v).trim().toUpperCase();
      if (c === "unidad") v = String(v || "") === String(p.unidad || "") ? p.unidad : unidadValida(v); // una unidad por revisar se puede dejar igual
      if (["certificacion", "ficha_tecnica", "modelo_equivalente"].includes(c)) v = String(v || "").trim() || null;
      if (String(v) !== String(p[c])) cambios[c] = v;
    }
    for (const [campo, v] of Object.entries(cambios)) {
      await registrar({ usuario: firma(req), tabla: "productos", registro_id: p.id, campo, antes: String(p[campo] ?? ""), despues: String(v), motivo: req.body.motivo || null }, t);
    }
    await p.update(cambios, { transaction: t });
    return p;
  });
  res.json({ ok: true, data: vista(req, await getParametros())(producto) });
});

// DELETE /api/productos/:id  -> si ya tiene historial se desactiva en vez de borrar
const eliminarProducto = handler(async (req, res) => {
  const producto = await Producto.findByPk(req.params.id);
  if (!producto) throw new ErrorNegocio("Producto no encontrado", 404);
  // M37: nunca se borra; se desactiva a mano (gerencia) y se puede reactivar
  const activar = req.query.activar === "1";
  await producto.update({ activo: activar });
  await registrar({ usuario: firma(req), tabla: "productos", registro_id: producto.id, campo: "activo", antes: String(!activar), despues: String(activar), motivo: activar ? "Reactivado a mano" : "Desactivado a mano" });
  res.json({ ok: true, message: activar ? "Producto reactivado" : "Producto desactivado (se puede reactivar desde el filtro Inactivos)" });
});

// GET /api/productos/:id/precios   (historial de precios por proveedor + cambios)
const getPrecios = handler(async (req, res) => {
  const [precios, cambios] = await Promise.all([
    PrecioProveedor.findAll({ where: { producto_id: req.params.id }, order: [["fecha", "DESC"], ["id", "DESC"]] }),
    RegistroCambio.findAll({ where: { tabla: "productos", registro_id: req.params.id }, order: [["createdAt", "DESC"]], limit: 50 }),
  ]);
  res.json({ ok: true, data: { precios, cambios } });
});

// POST /api/productos/:id/precios
// { proveedor, precio | (total_linea + cantidad), con_iva, fecha, documento, descripcion_proveedor, marca, calce, origen }
const agregarPrecio = handler(async (req, res) => {
  const b = req.body || {};
  if (!b.proveedor) throw new ErrorNegocio("Indica el proveedor");
  const resultado = await sequelize.transaction(async (t) => {
    const p = await Producto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
    const ORIGENES = ["proveedor", "web", "oc_cliente", "factura_sin_proveedor"];
    const origen = ORIGENES.includes(b.origen) ? b.origen : (b.con_iva ? "web" : await origenDe(b.proveedor, t));
    const precio = await PrecioProveedor.create({
      producto_id: p.id,
      proveedor: normProv(b.proveedor),
      precio: precioNetoUnitario(b),
      fecha: b.fecha || new Date(),
      documento: b.documento || null,
      descripcion_proveedor: b.descripcion_proveedor || null,
      marca: b.marca || null,
      unidad: b.unidad || null,
      cantidad: b.cantidad || null,
      calce: b.calce || null,
      origen,
      // M2: el descuento por volumen se anota, pero el precio de compra queda a precio lista
      descuento_pct: Number(b.descuento_pct) > 0 ? Number(b.descuento_pct) : null,
      descuento_desde: Number(b.descuento_desde) > 0 ? Number(b.descuento_desde) : null,
      creado_por: firma(req),
    }, { transaction: t });
    await recalcular(p, { t, usuario: firma(req), motivo: `Precio ${precio.proveedor} ${b.documento || ""}`.trim() });
    return { precio, producto: p };
  });
  res.status(201).json({ ok: true, data: { precio: resultado.precio, producto: vista(req, await getParametros())(resultado.producto) } });
});

// POST /api/precios/:id/descartar   { motivo }   (y /restaurar)
const descartarPrecio = (descartar) => handler(async (req, res) => {
  const resultado = await sequelize.transaction(async (t) => {
    const precio = await PrecioProveedor.findByPk(req.params.id, { transaction: t });
    if (!precio) throw new ErrorNegocio("Precio no encontrado", 404);
    if (descartar && !req.body?.motivo) throw new ErrorNegocio("Indica el motivo para descartar");
    await precio.update({ descartado: descartar, motivo: descartar ? req.body.motivo : null }, { transaction: t });
    const p = await Producto.findByPk(precio.producto_id, { transaction: t, lock: t.LOCK.UPDATE });
    await recalcular(p, { t, usuario: firma(req), motivo: `${descartar ? "Descartado" : "Restaurado"} precio ${precio.proveedor}` });
    return p;
  });
  res.json({ ok: true, data: vista(req, await getParametros())(resultado) });
});

// POST /api/productos/:id/confirmar   { precio_id? }
// Confirma el precio vigente (o el de un registro del historial). Reemplaza el aviso de REVISAR.
const confirmarPrecio = handler(async (req, res) => {
  const producto = await sequelize.transaction(async (t) => {
    const p = await Producto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
    const cambios = { confirmado: true, fecha_confirmado: new Date(), revisar: null };
    if (req.body?.precio_id) {
      const pr = await PrecioProveedor.findOne({ where: { id: req.body.precio_id, producto_id: p.id }, transaction: t });
      if (!pr) throw new ErrorNegocio("Ese precio no es de este producto", 404);
      Object.assign(cambios, { precio_compra: Number(pr.precio), proveedor: pr.proveedor, fecha_precio: pr.fecha });
    }
    if (!(Number(cambios.precio_compra ?? p.precio_compra) > 0)) throw new ErrorNegocio("El producto no tiene precio para confirmar");
    await registrar({
      usuario: firma(req), tabla: "productos", registro_id: p.id, campo: "confirmado",
      antes: `${p.proveedor || ""} ${p.precio_compra}`.trim(),
      despues: `${cambios.proveedor || p.proveedor || ""} ${cambios.precio_compra ?? p.precio_compra}`.trim(),
      motivo: req.body?.motivo || "Precio confirmado",
    }, t);
    await p.update(cambios, { transaction: t });
    // Las opciones 2 y 3 se recalculan sin tocar el principal confirmado
    await recalcular(p, { t, usuario: firma(req), motivo: "Confirmación" });
    if (p.revisar) await p.update({ revisar: null }, { transaction: t });
    return p;
  });
  res.json({ ok: true, data: vista(req, await getParametros())(producto) });
});

// POST /api/productos/:id/desconfirmar
const desconfirmarPrecio = handler(async (req, res) => {
  const producto = await sequelize.transaction(async (t) => {
    const p = await Producto.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!p) throw new ErrorNegocio("Producto no encontrado", 404);
    await p.update({ confirmado: false, fecha_confirmado: null }, { transaction: t });
    await registrar({ usuario: firma(req), tabla: "productos", registro_id: p.id, campo: "confirmado", antes: "sí", despues: "no" }, t);
    await recalcular(p, { t, usuario: firma(req), motivo: "Quitar confirmación" });
    return p;
  });
  res.json({ ok: true, data: vista(req, await getParametros())(producto) });
});

// GET /api/productos/unidades
const getUnidades = (req, res) => res.json({ ok: true, data: UNIDADES });

module.exports = {
  getLlenados,
  getSimilares, fusionar, getUnidades,
  limiteAntiguo,
  getProductos, getCategorias, getResumen, getProducto, crearProducto, actualizarProducto, eliminarProducto,
  getPrecios, agregarPrecio, descartarPrecio, confirmarPrecio, desconfirmarPrecio, vista,
};

// --- Exportaciones del catálogo -----------------------------------------------------------------
// GET /api/productos/exportar/para-cotizar   -> Excel con los productos nuevos sin precio (para pedir precio)
// GET /api/productos/exportar/consolidado?desde=AAAA-MM-DD&solo_cambios=1
//   -> el catálogo en el formato del LISTADO_CONSOLIDADO (se vuelve a subir con Importar planilla), con la
//      columna CAMBIO: Nuevo sin precio / Nuevo con precio / Precio actualizado (desde la fecha indicada o la última descarga)
const ExcelJS = require("exceljs");
const { setParametros } = require("../services/parametros");
const fechaCL = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("-") : "");
const enviarExcel = async (res, wb, nombre) => {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
  await wb.xlsx.write(res);
  res.end();
};
const encabezado = (ws, titulos) => {
  const h = ws.addRow(titulos);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF26747B" } }; });
  ws.views = [{ state: "frozen", ySplit: ws.rowCount }];
};

const exportarParaCotizar = async (req, res) => {
  try {
    const productos = await Producto.findAll({
      where: { activo: true, en_planilla: false, [Op.or]: [{ precio_compra: null }, { precio_compra: { [Op.lte]: 0 } }] },
      order: [["categoria", "ASC"], ["nombre", "ASC"]],
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Para cotizar");
    ws.columns = [{ width: 8 }, { width: 20 }, { width: 60 }, { width: 11 }, { width: 18 }, { width: 24 }, { width: 18 }, { width: 14 }];
    encabezado(ws, ["N°", "CATEGORÍA", "DESCRIPCIÓN", "UNIDAD", "PRECIO REAL COMPRA", "PROVEEDOR", "CONTACTO", "FECHA ACT."]);
    for (const p of productos) ws.addRow([p.codigo, p.categoria, p.nombre, p.unidad, null, "", "", ""]).getCell(5).numFmt = '"$"#,##0';
    ws.addRow([]);
    ws.addRow(["", "", "Completa precio NETO, proveedor y fecha. Para cargarlos, copia estas filas en la hoja LISTADO CONSOLIDADO del consolidado o súbelo en Catálogo → Precios → Importar planilla (la hoja se puede renombrar a LISTADO CONSOLIDADO)."]).font = { italic: true, color: { argb: "FF6F7C8D" } };
    await enviarExcel(res, wb, `Productos_nuevos_para_cotizar_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ ok: false, error: "No se pudo generar el Excel" }); }
};

const exportarConsolidado = async (req, res) => {
  try {
    const params = await getParametros();
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || "") ? req.query.desde : (params.catalogo_ultima_descarga || "").slice(0, 10) || null;
    const productos = await Producto.findAll({ where: { activo: true }, order: [["categoria", "ASC"], ["nombre", "ASC"]] });
    const cambio = (p) => {
      const conPrecio = Number(p.precio_compra) > 0;
      const creado = p.createdAt ? p.createdAt.toISOString().slice(0, 10) : "";
      if (!p.en_planilla && (!desde || creado >= desde)) return conPrecio ? "Nuevo con precio" : "Nuevo sin precio";
      if (!p.en_planilla) return conPrecio ? "Nuevo con precio" : "Nuevo sin precio";
      if (desde && conPrecio && p.fecha_precio && String(p.fecha_precio) >= desde) return "Precio actualizado";
      return "";
    };
    const lista = productos.map((p) => ({ p, c: cambio(p) })).filter((x) => req.query.solo_cambios !== "1" || x.c);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("LISTADO CONSOLIDADO");
    ws.columns = [8, 20, 60, 11, 16, 24, 22, 13, 28, 22, 14, 13, 22, 14, 13, 20].map((width) => ({ width }));
    encabezado(ws, ["N°", "CATEGORÍA", "DESCRIPCIÓN", "UNIDAD", "PRECIO REAL COMPRA", "PROVEEDOR", "CONTACTO", "FECHA ACT.", "REVISAR",
      "PROVEEDOR OPCIÓN 2", "PRECIO OPCIÓN 2", "FECHA OPCIÓN 2", "PROVEEDOR OPCIÓN 3", "PRECIO OPCIÓN 3", "FECHA OPCIÓN 3", "CAMBIO"]);
    const COLOR = { "Nuevo sin precio": "FFFDE2C4", "Nuevo con precio": "FFD8EFDF", "Precio actualizado": "FFFFF3B0" };
    for (const { p, c } of lista) {
      const r = ws.addRow([
        p.codigo, p.categoria, p.nombre, p.unidad, Number(p.precio_compra) > 0 ? Math.round(Number(p.precio_compra)) : null,
        p.proveedor || "", p.contacto || "", fechaCL(p.fecha_precio), p.confirmado ? "OK CONFIRMADO" : (p.revisar || ""),
        p.opcion2_proveedor || "", p.opcion2_precio ? Math.round(Number(p.opcion2_precio)) : null, fechaCL(p.opcion2_fecha),
        p.opcion3_proveedor || "", p.opcion3_precio ? Math.round(Number(p.opcion3_precio)) : null, fechaCL(p.opcion3_fecha), c,
      ]);
      [5, 11, 14].forEach((k) => { r.getCell(k).numFmt = '"$"#,##0'; });
      if (c) r.getCell(16).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR[c] } };
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 16 } };
    const resumen = wb.addWorksheet("RESUMEN");
    const cuenta = (t) => lista.filter((x) => x.c === t).length;
    [["Descargado", new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })], ["Cambios desde", desde ? fechaCL(desde) : "siempre (primera descarga)"],
      ["Productos", lista.length], ["Nuevos sin precio", cuenta("Nuevo sin precio")], ["Nuevos con precio", cuenta("Nuevo con precio")], ["Precio actualizado", cuenta("Precio actualizado")],
      [], ["Para volver a cargarlo: Catálogo → Precios → Importar planilla. La columna CAMBIO es solo informativa."]].forEach((f) => resumen.addRow(f));
    resumen.getColumn(1).width = 26; resumen.getColumn(2).width = 40;
    await setParametros({ catalogo_ultima_descarga: new Date().toISOString() });
    await enviarExcel(res, wb, `LISTADO_CONSOLIDADO_sistema_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ ok: false, error: "No se pudo generar el consolidado" }); }
};
module.exports.exportarParaCotizar = exportarParaCotizar;
module.exports.exportarConsolidado = exportarConsolidado;

// GET /api/productos/exportar/planilla   planilla actualizada completa (M37), con la versión siguiente (v72, v73...)
const exportarPlanilla = async (req, res) => {
  try {
    const params = await getParametros();
    const version = (Number(params.planilla_version) || 71) + 1;
    const desde = (params.catalogo_ultima_descarga || "").slice(0, 10) || null;
    const wb = await require("../services/planillaExcel").generarPlanilla({ version, desde });
    await setParametros({ planilla_version: String(version), catalogo_ultima_descarga: new Date().toISOString() });
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    await enviarExcel(res, wb, `LISTADO_CONSOLIDADO_FERRETERIA_v${version}.xlsx`);
  } catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ ok: false, error: "No se pudo generar la planilla" }); }
};
module.exports.exportarPlanilla = exportarPlanilla;
