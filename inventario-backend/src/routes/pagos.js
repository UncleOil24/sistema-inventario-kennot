const router = require("express").Router();
const { getPagos, eliminarPago } = require("../controllers/pagosController");

router.get("/", getPagos);
router.delete("/:id", eliminarPago);

module.exports = router;
