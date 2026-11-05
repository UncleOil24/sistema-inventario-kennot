const router = require("express").Router();
const { soloAdmin, permite } = require("../middlewares/auth");
// Comercial solo consulta el avance de las compras; las gestiona Operativo. Los pagos son de Finanzas (gerencia).
const operativo = permite("operativo");
const c = require("../controllers/ordenesCompraController");

router.get("/", c.getOrdenes);
router.get("/:id", c.getOrden);
router.post("/", operativo, c.crearOrden);
router.put("/:id", operativo, c.actualizarOrden);
router.put("/:id/venta", operativo, c.asignarVenta);
router.post("/:id/recibir", operativo, c.recibirOrden);
router.post("/:id/anular", operativo, c.anularOrden);
router.post("/:id/pagos", soloAdmin, c.registrarPago);
router.delete("/:id", soloAdmin, c.eliminarOrden);

module.exports = router;
