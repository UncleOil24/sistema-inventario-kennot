const router = require("express").Router();
const multer = require("multer");
const { soloAdmin, permite } = require("../middlewares/auth");
const c = require("../controllers/productosController");
const imp = require("../controllers/importarController");

const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// "No cumple" desde el cuadro de compra (Operativo y gerencia): el precio deja de competir para ese producto
router.post("/:id/no-cumple", permite("operativo"), (req, res, next) => { req.body = { ...req.body, motivo: `No cumple: ${String(req.body?.motivo || "especificación").trim()}` }; next(); }, c.descartarPrecio(true));
router.use(soloAdmin);
router.post("/:id/descartar", c.descartarPrecio(true));
router.post("/:id/restaurar", c.descartarPrecio(false));
router.post("/importar-planilla", subir.single("archivo"), imp.importarPlanilla);
router.get("/importar-planilla/:id", imp.estadoImportacion);
router.post("/importar-planilla/:id/aprobar", imp.aprobarImportacion);
router.get("/respaldos", imp.listarRespaldos);
router.get("/respaldos/:id/excel", imp.excelRespaldo);
router.post("/respaldos/:id/deshacer", imp.deshacerImportacion);

module.exports = router;
