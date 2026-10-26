const router = require("express").Router();
const { getProveedores, crearProveedor, actualizarProveedor, eliminarProveedor } = require("../controllers/proveedoresController");

router.get("/", getProveedores);
router.post("/", crearProveedor);
router.put("/:id", actualizarProveedor);
router.delete("/:id", eliminarProveedor);

module.exports = router;
