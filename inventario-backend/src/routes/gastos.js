const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const c = require("../controllers/gastosController");

// Los gastos afectan la utilidad: se ven y editan como administración (admin)
router.use(soloAdmin);
router.get("/", c.getGastos);
router.post("/", c.crearGasto);
router.put("/:id", c.actualizarGasto);
router.delete("/:id", c.eliminarGasto);

module.exports = router;
