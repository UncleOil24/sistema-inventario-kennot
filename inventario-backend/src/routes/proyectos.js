const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const c = require("../controllers/proyectosController");

router.get("/", c.getProyectos);
router.get("/:id", c.getProyecto);
router.post("/", c.crearProyecto);
router.put("/:id", c.actualizarProyecto);
router.post("/:id/ventas", c.agregarVentas);
router.delete("/:id/ventas/:ventaId", c.quitarVenta);
router.delete("/:id", soloAdmin, c.eliminarProyecto);
router.get("/:id/cuadro-compra", soloAdmin, c.getCuadroCompra);
router.post("/:id/generar-ordenes", soloAdmin, c.generarOrdenes);
router.post("/:id/unir-ordenes", soloAdmin, c.unirOrdenes);

module.exports = router;
