const router = require("express").Router();
const { exportarCotizacion, getCotizaciones, getCotizacion, eliminarCotizacion, reexportarCotizacion } = require("../controllers/cotizacionesController");

router.get("/", getCotizaciones);
router.get("/:id", getCotizacion);
router.post("/export", exportarCotizacion);
router.post("/reexport/:id", reexportarCotizacion);
router.delete("/:id", eliminarCotizacion);

module.exports = router;