const router = require("express").Router();
const { soloAdmin, permite } = require("../middlewares/auth");
const comercial = permite("comercial");
const operativo = permite("operativo");
const c = require("../controllers/ventasController");

router.get("/", c.getVentas);
router.get("/:id", c.getVenta);
router.post("/", comercial, c.crearVenta);
router.post("/desde-cotizacion/:id", comercial, c.ventaDesdeCotizacion);
router.put("/:id/datos", comercial, c.actualizarDatos);
router.post("/:id/anular", soloAdmin, c.anularVenta);
router.post("/:id/cobros", soloAdmin, c.registrarCobro); // cobros: Finanzas
// Qué comprar y a quién: lo gestiona Operativo
router.get("/:id/cuadro-compra", operativo, c.getCuadroCompra);
router.post("/:id/cambiar-proveedor", operativo, c.cambiarProveedorLinea);
router.post("/:id/generar-ordenes", operativo, c.generarOrdenes);

module.exports = router;
