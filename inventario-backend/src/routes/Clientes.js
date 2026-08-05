const router = require("express").Router();
const { getClientes, crearCliente, actualizarCliente, eliminarCliente } = require("../controllers/clientesController");

router.get("/", getClientes);
router.post("/", crearCliente);
router.put("/:id", actualizarCliente);
router.delete("/:id", eliminarCliente);

module.exports = router;