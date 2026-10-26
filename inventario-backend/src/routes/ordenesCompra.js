const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const c = require("../controllers/ordenesCompraController");

router.get("/", c.getOrdenes);
router.get("/:id", c.getOrden);
router.post("/", c.crearOrden);
router.put("/:id", c.actualizarOrden);
router.post("/:id/recibir", c.recibirOrden);
router.post("/:id/anular", soloAdmin, c.anularOrden);
router.post("/:id/pagos", c.registrarPago);
router.delete("/:id", soloAdmin, c.eliminarOrden);

module.exports = router;
