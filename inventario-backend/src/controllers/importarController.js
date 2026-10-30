const { handler, ErrorNegocio } = require("../services/erp");
const { importarPlanilla: importar } = require("../services/importarPlanilla");

// POST /api/precios/importar-planilla   (multipart: archivo=.xlsx, desactivar_otros=1)
const importarPlanilla = handler(async (req, res) => {
  if (!req.file) throw new ErrorNegocio("Adjunta la planilla .xlsx");
  if (!/\.xlsx$/i.test(req.file.originalname || "")) throw new ErrorNegocio("El archivo debe ser .xlsx");
  const resumen = await importar(req.file.buffer, {
    usuario: req.usuario.nombre,
    desactivarOtros: req.body?.desactivar_otros === "1" || req.body?.desactivar_otros === "true",
  });
  res.json({ ok: true, data: resumen });
});

module.exports = { importarPlanilla };
