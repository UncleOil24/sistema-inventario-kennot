const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const { getProveedores, crearProveedor, actualizarProveedor, eliminarProveedor } = require("../controllers/proveedoresController");

router.get("/", getProveedores);
router.post("/", crearProveedor);
router.put("/:id", actualizarProveedor);
router.delete("/:id", soloAdmin, eliminarProveedor);

module.exports = router;
