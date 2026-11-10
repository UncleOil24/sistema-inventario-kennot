const Cliente = require("../models/Cliente");
const { Op } = require("sequelize");
const sequelize = require("../../config/database");
const { esGerencia } = require("../middlewares/auth");
// Límite y estado de crédito los decide gerencia (Finanzas)
const sinCredito = (req) => {
  const b = { ...(req.body || {}) };
  if (!esGerencia(req)) { delete b.limite_credito; delete b.estado_credito; }
  return b;
};

// Siguiente ID automático P-001, P-002... (para clientes que no son una unidad de compra de Mercado Público)
const siguienteCodigo = async () => {
  const [[f]] = await sequelize.query(`SELECT COALESCE(MAX(SUBSTRING(codigo FROM 3)::int), 0) AS n FROM clientes WHERE codigo ~ '^P-[0-9]+$'`);
  return `P-${String(Number(f.n) + 1).padStart(3, "0")}`;
};
const limpiarCodigo = (c) => String(c || "").trim().toUpperCase();
const codigoLibre = async (codigo, id) => {
  const otro = await Cliente.findOne({ where: { codigo } });
  if (otro && otro.id !== Number(id)) throw Object.assign(new Error(`El ID ${codigo} ya lo tiene ${otro.nombre}`), { status: 400 });
};
// Campos de la ficha que se pueden guardar
const CAMPOS = ["nombre", "rut", "telefono", "email", "direccion", "contacto", "comuna", "giro", "organismo", "contacto_finanzas", "notas"];
const datosFicha = (b, actual = {}) => {
  const d = {};
  for (const c of CAMPOS) if (c in b) d[c] = typeof b[c] === "string" ? b[c].trim() || null : b[c] ?? null;
  if ("tipo" in b) d.tipo = b.tipo === "particular" ? "particular" : "convenio";
  if ("empresa" in b) d.empresa = ["kenott", "tactics"].includes(b.empresa) ? b.empresa : "ambas";
  if ("plazo_pago_dias" in b) {
    const n = Number(b.plazo_pago_dias);
    if (!Number.isFinite(n) || n < 0 || n > 365) throw Object.assign(new Error("Plazo de pago inválido (0 a 365 días)"), { status: 400 });
    d.plazo_pago_dias = Math.round(n);
  }
  if ("base_vencimiento" in b) d.base_vencimiento = b.base_vencimiento === "recepcion" ? "recepcion" : "factura";
  if ("limite_credito" in b) d.limite_credito = b.limite_credito === "" || b.limite_credito == null ? null : Number(b.limite_credito) || 0;
  if ("estado_credito" in b) {
    d.estado_credito = b.estado_credito === "suspendido" ? "suspendido" : "activo";
    if (d.estado_credito === "activo") d.motivo_credito = null; // reactivado por gerencia
    else if ("motivo_credito" in b) d.motivo_credito = String(b.motivo_credito || "").trim() || null;
  }
  if ("usa_factoring" in b) d.usa_factoring = !!b.usa_factoring;
  return { ...actual, ...d };
};
const responderError = (res, error) => res.status(error.status || 500).json({ ok: false, error: error.message });

// GET /api/clientes
const getClientes = async (req, res) => {
  try {
    const { busqueda } = req.query;
    const where = {};
    if (busqueda) {
      where[Op.or] = [
        { nombre: { [Op.iLike]: `%${busqueda}%` } },
        { rut: { [Op.iLike]: `%${busqueda}%` } },
        { codigo: { [Op.iLike]: `%${busqueda}%` } },
        { organismo: { [Op.iLike]: `%${busqueda}%` } },
      ];
    }
    // El Cliente general va primero
    const clientes = await Cliente.findAll({ where, order: [[sequelize.literal(`(codigo = 'P-001')`), "DESC NULLS LAST"], ["nombre", "ASC"]] });
    res.json({ ok: true, data: clientes });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// POST /api/clientes
const crearCliente = async (req, res) => {
  try {
    const datos = datosFicha({ tipo: "convenio", ...sinCredito(req) });
    if (!datos.nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });
    // ID: el que se indique (p.ej. unidad de compra 1422) o el siguiente P-###
    const codigo = limpiarCodigo(req.body.codigo) || await siguienteCodigo();
    await codigoLibre(codigo);
    const cliente = await Cliente.create({ ...datos, codigo });
    res.status(201).json({ ok: true, data: cliente });
  } catch (error) {
    responderError(res, error);
  }
};

// PUT /api/clientes/:id
const actualizarCliente = async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.id);
    if (!cliente) return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    const cambios = datosFicha(sinCredito(req));
    if ("nombre" in cambios && !cambios.nombre) return res.status(400).json({ ok: false, error: "Nombre requerido" });
    // El Cliente general (P-001) es para ventas al público: no se convierte en otro cliente
    if (cliente.codigo === "P-001" && "nombre" in cambios && cambios.nombre !== cliente.nombre) {
      return res.status(400).json({ ok: false, error: "El Cliente general (P-001) es para ventas al público y no se renombra. Para un cliente nuevo usa \"+ Nuevo cliente\"." });
    }
    if (req.body.codigo !== undefined && cliente.codigo !== "P-001") {
      cambios.codigo = limpiarCodigo(req.body.codigo) || cliente.codigo || await siguienteCodigo();
      if (cambios.codigo === "P-001") throw Object.assign(new Error("El ID P-001 es del Cliente general"), { status: 400 });
      await codigoLibre(cambios.codigo, cliente.id);
    }
    await cliente.update(cambios);
    res.json({ ok: true, data: cliente });
  } catch (error) {
    responderError(res, error);
  }
};

// DELETE /api/clientes/:id
const eliminarCliente = async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.id);
    if (!cliente) return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    if (cliente.codigo === "P-001") return res.status(400).json({ ok: false, error: "El Cliente general no se puede borrar" });
    await cliente.destroy();
    res.json({ ok: true, message: "Cliente eliminado" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// GET /api/clientes/:id/ficha   -> todo lo del cliente: cotizaciones, ventas, facturas y lo que debe
const fichaCliente = async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.id);
    if (!cliente) return res.status(404).json({ ok: false, error: "Cliente no encontrado" });
    const [cotizaciones] = await sequelize.query(`SELECT id, numero, empresa, anterior, estado, fecha, total, nombre_cotizacion, id_solicitud
      FROM cotizaciones WHERE cliente_id = :id ORDER BY "createdAt" DESC LIMIT 50`, { replacements: { id: cliente.id } });
    const [ventas] = await sequelize.query(`SELECT id, numero, empresa, fecha, total, monto_pagado, estado, etapa, estado_factura, documento,
        orden_compra_cliente, id_solicitud, fecha_vencimiento, estado_pago
      FROM ventas WHERE cliente_id = :id ORDER BY id DESC LIMIT 100`, { replacements: { id: cliente.id } });
    const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
    const vivas = ventas.filter((v) => v.estado !== "anulada");
    const saldo = (v) => Number(v.total) - Number(v.monto_pagado);
    // Atraso real: días entre el vencimiento y el último cobro, en ventas ya pagadas
    const [[atraso]] = await sequelize.query(`SELECT ROUND(AVG(p.ultimo - v.fecha_vencimiento))::int AS dias, COUNT(*)::int AS n
      FROM ventas v JOIN (SELECT venta_id, MAX(fecha)::date AS ultimo FROM pagos WHERE tipo = 'cobro' GROUP BY venta_id) p ON p.venta_id = v.id
      WHERE v.cliente_id = :id AND v.estado_pago = 'pagada' AND v.fecha_vencimiento IS NOT NULL`, { replacements: { id: cliente.id } });
    const resumen = {
      cotizaciones: cotizaciones.length,
      ganadas: cotizaciones.filter((c) => c.estado === "aceptada").length,
      ventas: vivas.length,
      vendido: Math.round(vivas.reduce((s, v) => s + Number(v.total), 0)),
      por_cobrar: Math.round(vivas.reduce((s, v) => s + saldo(v), 0)),
      vencido: Math.round(vivas.filter((v) => v.fecha_vencimiento && v.fecha_vencimiento < hoy).reduce((s, v) => s + saldo(v), 0)),
      atraso_promedio: atraso?.n ? atraso.dias : null,
    };
    resumen.sobre_limite = cliente.limite_credito != null && Number(cliente.limite_credito) > 0 && resumen.por_cobrar > Number(cliente.limite_credito);
    res.json({ ok: true, data: { cliente, resumen, cotizaciones, ventas } });
  } catch (error) {
    responderError(res, error);
  }
};

module.exports = { fichaCliente, siguienteCodigo, getClientes, crearCliente, actualizarCliente, eliminarCliente };