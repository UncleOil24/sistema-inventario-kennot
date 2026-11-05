const router = require("express").Router();
const { soloAdmin, permite } = require("../middlewares/auth");
const { getProveedores, crearProveedor, actualizarProveedor, eliminarProveedor } = require("../controllers/proveedoresController");

router.get("/", getProveedores);
router.post("/", permite("comercial", "operativo"), crearProveedor);
router.put("/:id", permite("comercial", "operativo"), actualizarProveedor);
router.delete("/:id", soloAdmin, eliminarProveedor);

module.exports = router;
