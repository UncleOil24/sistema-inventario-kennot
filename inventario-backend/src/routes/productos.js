const router = require("express").Router();
const { soloAdmin, permite } = require("../middlewares/auth");
const catalogoPrecios = permite("comercial", "operativo");
const c = require("../controllers/productosController");

router.get("/", c.getProductos);
router.get("/categorias", c.getCategorias);
router.get("/resumen", c.getResumen);
router.get("/llenados", c.getLlenados);
router.get("/similares", c.getSimilares);
router.get("/unidades", c.getUnidades);
router.get("/exportar/para-cotizar", c.exportarParaCotizar);
router.get("/exportar/consolidado", catalogoPrecios, c.exportarConsolidado);
router.get("/exportar/planilla", soloAdmin, c.exportarPlanilla);
router.get("/:id", c.getProducto);
router.post("/", c.crearProducto);
router.put("/:id", soloAdmin, c.actualizarProducto); // editar el catálogo: solo gerencia
router.delete("/:id", soloAdmin, c.eliminarProducto);
router.post("/:id/fusionar", soloAdmin, c.fusionar);

// Precios (encargado de precios = admin)
router.get("/:id/precios", catalogoPrecios, c.getPrecios);
router.post("/:id/precios", soloAdmin, c.agregarPrecio); // precio a mano: solo gerencia (los documentos de proveedores entran por /ia y compras)
router.post("/:id/confirmar", soloAdmin, c.confirmarPrecio);
router.post("/:id/desconfirmar", soloAdmin, c.desconfirmarPrecio);

module.exports = router;
