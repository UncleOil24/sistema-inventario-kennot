const { firma } = require("../middlewares/auth");
const crypto = require("crypto");
const sequelize = require("../../config/database");
const { handler, ErrorNegocio } = require("../services/erp");
const { leerPlanilla, planificar, aplicar } = require("../services/importarPlanilla");
const { generarPlanilla } = require("../services/planillaExcel");
const Producto = require("../models/Producto");
const PrecioProveedor = require("../models/PrecioProveedor");
const RegistroCambio = require("../models/RegistroCambio");
const RespaldoCatalogo = require("../models/RespaldoCatalogo");

// Importación de la planilla en dos pasos (M37):
//  1) se sube y el sistema la compara con el catálogo: vista previa (no guarda nada)
//  2) se aprueba: respaldo automático y luego se combina (nunca borra ni desactiva productos)
// Corre en segundo plano y la pantalla consulta el avance.
const trabajos = new Map(); // id -> { estado: "leyendo"|"vista_previa"|"aplicando"|"listo"|"error", paso, ... }
let enCurso = null;
const ocupado = () => enCurso && ["leyendo", "aplicando"].includes(trabajos.get(enCurso)?.estado);
const limpiar = () => { for (const [id, t] of trabajos) if (Date.now() - t.inicio > 3 * 3600e3) trabajos.delete(id); };

// POST /api/precios/importar-planilla   (multipart: archivo=.xlsx) -> { id }
const importarPlanilla = handler(async (req, res) => {
  if (!req.file) throw new ErrorNegocio("Adjunta la planilla .xlsx");
  if (!/\.xlsx$/i.test(req.file.originalname || "")) throw new ErrorNegocio("El archivo debe ser .xlsx");
  if (ocupado()) return res.status(409).json({ ok: false, error: "Ya hay una importación en curso. Espera a que termine.", data: { id: enCurso } });
  limpiar();
  const id = crypto.randomUUID();
  const trabajo = { estado: "leyendo", paso: "Leyendo la planilla...", inicio: Date.now(), archivo: req.file.originalname, por: firma(req) };
  trabajos.set(id, trabajo);
  enCurso = id;
  (async () => {
    const datos = await leerPlanilla(req.file.buffer);
    trabajo.paso = `Planilla leída: ${datos.filas.length} productos. Comparando con el sistema...`;
    const plan = await planificar(datos, { onProgreso: (p) => { trabajo.paso = p; } });
    Object.assign(trabajo, { estado: "vista_previa", paso: "Revisa y aprueba", datos, plan, fin: Date.now() });
  })().catch((e) => { console.error("importación:", e); Object.assign(trabajo, { estado: "error", error: e.message, fin: Date.now() }); });
  res.status(202).json({ ok: true, data: { id } });
});

// GET /api/precios/importar-planilla/:id
const estadoImportacion = handler(async (req, res) => {
  const t = trabajos.get(req.params.id);
  if (!t) throw new ErrorNegocio("No encontré esa importación (el servidor pudo reiniciarse). Vuelve a subir la planilla.", 404);
  const { datos, plan, ...resto } = t;
  res.json({ ok: true, data: { ...resto, vista: plan && t.estado === "vista_previa" ? plan : plan ? { resumen: plan.resumen } : null,
    segundos: Math.round(((t.fin || Date.now()) - t.inicio) / 1000) } });
});

// Respaldo antes de aplicar: productos tal como están, hasta dónde llegaba el historial y la planilla en Excel
const respaldar = async (motivo, por, archivo) => {
  const productos = await Producto.findAll({ raw: true });
  const [[m]] = await sequelize.query("SELECT COALESCE(MAX(id),0) AS p FROM productos");
  const [[h]] = await sequelize.query("SELECT COALESCE(MAX(id),0) AS h FROM precios_proveedor");
  const wb = await generarPlanilla({ version: "respaldo" });
  const excel = Buffer.from(await wb.xlsx.writeBuffer());
  return RespaldoCatalogo.create({ motivo, por, archivo, productos, max_producto_id: Number(m.p), max_precio_id: Number(h.h), excel });
};

// POST /api/precios/importar-planilla/:id/aprobar   { decisiones: { fila: "mismo"|"nuevo"|"ignorar" }, excluir: [fila] }
const aprobarImportacion = handler(async (req, res) => {
  const t = trabajos.get(req.params.id);
  if (!t) throw new ErrorNegocio("La vista previa ya no está (el servidor pudo reiniciarse). Vuelve a subir la planilla.", 404);
  if (t.estado !== "vista_previa") throw new ErrorNegocio("Esta importación ya se aplicó o no está lista");
  if (ocupado()) throw new ErrorNegocio("Ya hay una importación en curso. Espera a que termine.", 409);
  const usuario = firma(req);
  Object.assign(t, { estado: "aplicando", paso: "Guardando respaldo del catálogo...", inicio: Date.now(), fin: null });
  enCurso = req.params.id;
  (async () => {
    const r = await respaldar(`Antes de importar ${t.archivo}`, usuario, t.archivo);
    t.respaldo_id = r.id;
    t.paso = "Respaldo listo. Combinando la planilla...";
    const resumen = await aplicar(t.datos, t.plan, { decisiones: req.body?.decisiones || {}, excluir: req.body?.excluir || [], usuario, onProgreso: (p) => { t.paso = p; } });
    await r.update({ resumen });
    Object.assign(t, { estado: "listo", paso: "Importación terminada", resumen, fin: Date.now(), datos: null });
  })().catch((e) => { console.error("importación:", e); Object.assign(t, { estado: "error", error: e.message, fin: Date.now() }); });
  res.status(202).json({ ok: true, data: { id: req.params.id } });
});

// GET /api/precios/respaldos
const listarRespaldos = handler(async (req, res) => {
  const lista = await RespaldoCatalogo.findAll({ attributes: ["id", "motivo", "por", "archivo", "resumen", "deshecho", "deshecho_por", "createdAt"], order: [["id", "DESC"]], limit: 10 });
  res.json({ ok: true, data: lista });
});

// GET /api/precios/respaldos/:id/excel
const excelRespaldo = handler(async (req, res) => {
  const r = await RespaldoCatalogo.findByPk(req.params.id, { attributes: ["id", "excel", "createdAt"] });
  if (!r?.excel) throw new ErrorNegocio("Respaldo no encontrado", 404);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Respaldo_catalogo_${new Date(r.createdAt).toISOString().slice(0, 10)}_${r.id}.xlsx"`);
  res.end(r.excel);
});

// POST /api/precios/respaldos/:id/deshacer   deja el catálogo como estaba antes de esa importación (solo la última)
const deshacerImportacion = handler(async (req, res) => {
  const r = await RespaldoCatalogo.findByPk(req.params.id);
  if (!r) throw new ErrorNegocio("Respaldo no encontrado", 404);
  if (r.deshecho) throw new ErrorNegocio("Esa importación ya se deshizo");
  const ultimo = await RespaldoCatalogo.findOne({ where: { deshecho: false }, order: [["id", "DESC"]] });
  if (ultimo?.id !== r.id) throw new ErrorNegocio("Solo se puede deshacer la última importación");
  if (ocupado()) throw new ErrorNegocio("Hay una importación en curso", 409);
  const usuario = firma(req);
  const resumen = await sequelize.transaction(async (t) => {
    const [, borrados] = await sequelize.query("DELETE FROM precios_proveedor WHERE id > :m", { replacements: { m: r.max_precio_id }, transaction: t });
    const [, nuevos] = await sequelize.query(`UPDATE productos SET activo = false, "updatedAt" = NOW() WHERE id > :m AND activo`, { replacements: { m: r.max_producto_id }, transaction: t });
    const filas = r.productos;
    const campos = Object.keys(filas[0] || {}).filter((k) => !["id", "createdAt"].includes(k));
    for (let i = 0; i < filas.length; i += 500) await Producto.bulkCreate(filas.slice(i, i + 500), { transaction: t, updateOnDuplicate: campos });
    await r.update({ deshecho: true, deshecho_por: usuario }, { transaction: t });
    await RegistroCambio.create({ usuario, tabla: "productos", campo: "importación", despues: "Deshecha", motivo: `Se deshizo la importación de ${r.archivo || "planilla"}` }, { transaction: t });
    return { productos_restaurados: filas.length, productos_nuevos_desactivados: Number(nuevos?.rowCount ?? nuevos) || 0, precios_quitados: Number(borrados?.rowCount ?? borrados) || 0 };
  });
  res.json({ ok: true, data: resumen });
});

module.exports = { importarPlanilla, estadoImportacion, aprobarImportacion, listarRespaldos, excelRespaldo, deshacerImportacion, respaldar };
