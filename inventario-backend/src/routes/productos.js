const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const {
  getProductos,
  getProducto,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  getMovimientos,
  ajustarStock,
} = require("../controllers/productosController");

router.get("/", getProductos);
router.get("/:id", getProducto);
router.get("/:id/movimientos", getMovimientos);
router.post("/:id/ajuste", soloAdmin, ajustarStock);
router.post("/", crearProducto);
router.put("/:id", actualizarProducto);
router.delete("/:id", soloAdmin, eliminarProducto);

module.exports = router;
