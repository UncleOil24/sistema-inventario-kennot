const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const c = require("../controllers/cotizacionesController");

router.get("/", c.getCotizaciones);
router.get("/:id", c.getCotizacion);
router.get("/:id/excel", c.descargarExcel);
router.get("/:id/pdf", c.descargarPdf);
router.post("/", c.crearCotizacion);
router.put("/:id", c.actualizarCotizacion);
router.post("/:id/estado", c.cambiarEstado);
router.delete("/:id", soloAdmin, c.eliminarCotizacion);

module.exports = router;
