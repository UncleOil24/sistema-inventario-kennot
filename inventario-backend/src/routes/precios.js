const router = require("express").Router();
const multer = require("multer");
const { soloAdmin } = require("../middlewares/auth");
const c = require("../controllers/productosController");
const { importarPlanilla, estadoImportacion } = require("../controllers/importarController");

const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.use(soloAdmin);
router.post("/:id/descartar", c.descartarPrecio(true));
router.post("/:id/restaurar", c.descartarPrecio(false));
router.post("/importar-planilla", subir.single("archivo"), importarPlanilla);
router.get("/importar-planilla/:id", estadoImportacion);

module.exports = router;
