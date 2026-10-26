const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const { getPagos, eliminarPago } = require("../controllers/pagosController");

router.get("/", soloAdmin, getPagos);
router.delete("/:id", soloAdmin, eliminarPago);

module.exports = router;
