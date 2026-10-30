const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const c = require("../controllers/ventasController");

router.get("/", c.getVentas);
router.get("/:id", c.getVenta);
router.post("/", c.crearVenta);
router.post("/desde-cotizacion/:id", c.ventaDesdeCotizacion);
router.put("/:id/datos", c.actualizarDatos);
router.post("/:id/anular", soloAdmin, c.anularVenta);
router.post("/:id/cobros", c.registrarCobro);
// Cuadro de compra (muestra costos y márgenes: solo admin)
router.get("/:id/cuadro-compra", soloAdmin, c.getCuadroCompra);
router.post("/:id/cambiar-proveedor", soloAdmin, c.cambiarProveedorLinea);
router.post("/:id/generar-ordenes", soloAdmin, c.generarOrdenes);

module.exports = router;
