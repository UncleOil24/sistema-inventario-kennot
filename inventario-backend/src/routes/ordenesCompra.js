const router = require("express").Router();
const { soloAdmin, permite } = require("../middlewares/auth");
// Comercial solo consulta el avance de las compras; las gestiona Operativo. Los pagos son de Finanzas (gerencia).
const operativo = permite("operativo");
const c = require("../controllers/ordenesCompraController");

const fc = require("../controllers/facturaCompraController");
const subirFactura = require("multer")({ storage: require("multer").memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
router.post("/factura/leer", operativo, subirFactura.single("archivo"), fc.leer);
router.post("/factura/registrar", operativo, fc.registrarFactura);
router.get("/:id/documentos/:docId", fc.descargar);
router.get("/", c.getOrdenes);
router.get("/:id", c.getOrden);
router.post("/", operativo, c.crearOrden);
router.put("/:id", operativo, c.actualizarOrden);
router.put("/:id/venta", operativo, c.asignarVenta);
router.put("/:id/factura", operativo, c.registrarFactura);
router.post("/:id/recibir", operativo, c.recibirOrden);
router.post("/:id/anular", operativo, c.anularOrden);
router.post("/:id/pagos", soloAdmin, c.registrarPago);
router.delete("/:id", soloAdmin, c.eliminarOrden);

module.exports = router;
