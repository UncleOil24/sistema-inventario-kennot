const router = require("express").Router();
const { soloAdmin, permite } = require("../middlewares/auth");
const comercial = permite("comercial");
const c = require("../controllers/cotizacionesController");

router.get("/", c.getCotizaciones);
router.get("/por-seguir/cantidad", c.cantidadPorSeguir);
router.get("/:id", c.getCotizacion);
router.get("/:id/excel", c.descargarExcel);
router.get("/:id/pdf", c.descargarPdf);
router.get("/:id/interna", c.descargarInterna);
router.post("/", comercial, c.crearCotizacion);
router.put("/:id", comercial, c.actualizarCotizacion);
router.post("/:id/estado", comercial, c.cambiarEstado);
router.post("/:id/seguimiento", comercial, c.registrarSeguimiento);
router.delete("/:id", soloAdmin, c.eliminarCotizacion);

module.exports = router;
