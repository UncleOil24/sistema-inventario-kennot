const router = require("express").Router();
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
router.post("/:id/ajuste", ajustarStock);
router.post("/", crearProducto);
router.put("/:id", actualizarProducto);
router.delete("/:id", eliminarProducto);

module.exports = router;
