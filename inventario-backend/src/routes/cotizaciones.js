const router = require("express").Router();
const { exportarCotizacion, getCotizaciones, getCotizacion } = require("../controllers/cotizacionesController");

router.get("/", getCotizaciones);
router.get("/:id", getCotizacion);
router.post("/export", exportarCotizacion);

module.exports = router;
