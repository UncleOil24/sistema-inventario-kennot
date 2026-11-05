const router = require("express").Router();
const { soloAdmin, permite } = require("../middlewares/auth");
const { getClientes, crearCliente, actualizarCliente, eliminarCliente } = require("../controllers/ClientesController");

router.get("/", getClientes);
router.post("/", permite("comercial"), crearCliente);
router.put("/:id", permite("comercial"), actualizarCliente);
router.delete("/:id", soloAdmin, eliminarCliente);

module.exports = router;