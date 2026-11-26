const router = require("express").Router();
const { permite } = require("../middlewares/auth");
const c = require("../controllers/bandejaController");
const multer = require("multer");
const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 20 } });
// Suben documentos Comercial, Operativo y gerencia; los procesa Operativo con "Subir factura"
const equipo = permite("comercial", "operativo");
router.get("/", equipo, c.listar);
router.get("/resumen", equipo, c.resumen);
router.post("/", equipo, subir.array("archivos", 20), c.subir);
router.get("/:id/archivo", equipo, c.archivo);
router.get("/:id/lectura", equipo, c.lectura);
router.put("/:id", equipo, c.actualizar);
router.post("/:id/leer", equipo, c.releer);
router.post("/:id/a-venta", equipo, c.aVenta);
module.exports = router;
