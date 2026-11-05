const router = require("express").Router();
const { soloAdmin, permite } = require("../middlewares/auth");
const catalogoPrecios = permite("comercial", "operativo");
const c = require("../controllers/productosController");

router.get("/", c.getProductos);
router.get("/categorias", c.getCategorias);
router.get("/resumen", c.getResumen);
router.get("/similares", c.getSimilares);
router.get("/unidades", c.getUnidades);
router.get("/:id", c.getProducto);
router.post("/", c.crearProducto);
router.put("/:id", c.actualizarProducto);
router.delete("/:id", soloAdmin, c.eliminarProducto);
router.post("/:id/fusionar", soloAdmin, c.fusionar);

// Precios (encargado de precios = admin)
router.get("/:id/precios", catalogoPrecios, c.getPrecios);
router.post("/:id/precios", catalogoPrecios, c.agregarPrecio);
router.post("/:id/confirmar", soloAdmin, c.confirmarPrecio);
router.post("/:id/desconfirmar", soloAdmin, c.desconfirmarPrecio);

module.exports = router;
