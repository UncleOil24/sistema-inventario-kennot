const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const { getClientes, crearCliente, actualizarCliente, eliminarCliente } = require("../controllers/ClientesController");

router.get("/", getClientes);
router.post("/", crearCliente);
router.put("/:id", actualizarCliente);
router.delete("/:id", soloAdmin, eliminarCliente);

module.exports = router;