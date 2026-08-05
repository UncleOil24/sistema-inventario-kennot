const router = require("express").Router();
const { getClientes, crearCliente, actualizarCliente, eliminarCliente } = require("../controllers/ClientesController");

router.get("/", getClientes);
router.post("/", crearCliente);
router.put("/:id", actualizarCliente);
router.delete("/:id", eliminarCliente);

module.exports = router;