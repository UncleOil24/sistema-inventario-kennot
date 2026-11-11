const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const { handler } = require("../services/erp");
const { generarJSON, generarExcel } = require("../services/respaldoDatos");
const RegistroCambio = require("../models/RegistroCambio");
const { firma } = require("../middlewares/auth");

const fecha = () => new Date().toLocaleString("sv-SE", { timeZone: "America/Santiago" }).slice(0, 16).replace(" ", "_").replace(":", "-");

// GET /api/respaldo/datos?formato=json|excel&archivos=0|1   (solo gerencia)
router.get("/datos", soloAdmin, handler(async (req, res) => {
  const excel = req.query.formato === "excel";
  const buf = excel ? await generarExcel() : await generarJSON({ conArchivos: req.query.archivos !== "0" });
  await RegistroCambio.create({ usuario: firma(req), tabla: "sistema", campo: "respaldo", despues: excel ? "Excel" : "JSON", motivo: "Descarga de respaldo de datos" });
  const nombre = `Respaldo_datos_SyncroGes_${fecha()}.${excel ? "xlsx" : "json.gz"}`;
  res.setHeader("Content-Type", excel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/gzip");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
  res.end(buf);
}));

module.exports = router;
