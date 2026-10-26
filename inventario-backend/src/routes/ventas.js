const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const c = require("../controllers/ventasController");

router.get("/", c.getVentas);
router.get("/:id", c.getVenta);
router.post("/", c.crearVenta);
router.post("/desde-cotizacion/:id", c.ventaDesdeCotizacion);
router.post("/:id/anular", soloAdmin, c.anularVenta);
router.post("/:id/cobros", c.registrarCobro);

module.exports = router;
