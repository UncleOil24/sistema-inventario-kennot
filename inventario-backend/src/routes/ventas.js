const router = require("express").Router();
const { soloAdmin, permite } = require("../middlewares/auth");
const comercial = permite("comercial");
const operativo = permite("operativo");
const c = require("../controllers/ventasController");

router.get("/", c.getVentas);
router.get("/facturas/lista", c.listarFacturas);
router.get("/:id", c.getVenta);
router.post("/", comercial, c.crearVenta);
router.post("/desde-cotizacion/:id", comercial, c.ventaDesdeCotizacion);
router.put("/:id/datos", comercial, c.actualizarDatos);
router.get("/:id/anulacion", c.resumenAnulacion);
router.post("/:id/anular", soloAdmin, c.anularVenta);
router.post("/:id/cobros", soloAdmin, c.registrarCobro); // cobros: Finanzas
// Qué comprar y a quién: lo gestiona Operativo
router.get("/:id/cuadro-compra", operativo, c.getCuadroCompra);
router.post("/:id/cambiar-proveedor", operativo, c.cambiarProveedorLinea);
router.post("/:id/generar-ordenes", operativo, c.generarOrdenes);
// Recorrido: Operativo acepta y confirma (productos listos), Comercial factura, Operativo despacha y entrega
router.post("/:id/aceptar", operativo, c.aceptarVenta);
router.post("/:id/confirmar", operativo, c.confirmarVenta);
router.post("/:id/facturas", comercial, c.agregarFactura);
router.post("/:id/facturas/cerrar", comercial, c.cerrarFacturacion);
const sii = require("../controllers/siiController");
const subirSII = require("multer")({ storage: require("multer").memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.get("/:id/sii", sii.ficha);
router.post("/:id/sii/leer", permite("comercial", "operativo"), subirSII.single("archivo"), sii.leer);
router.post("/:id/sii/registrar", permite("comercial", "operativo"), sii.registrar);
router.get("/:id/documentos/:docId", sii.descargar);
router.delete("/:id/facturas/:facturaId", comercial, c.quitarFactura);
router.post("/:id/despachar", operativo, c.despacharVenta);
router.post("/:id/entregar", operativo, c.entregarVenta);
router.post("/:id/retroceder", operativo, c.retrocederEtapa);

module.exports = router;
