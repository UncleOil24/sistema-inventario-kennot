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
router.delete("/:id/facturas/:facturaId", comercial, c.quitarFactura);
router.post("/:id/despachar", operativo, c.despacharVenta);
router.post("/:id/entregar", permite("operativo", "comercial"), c.entregarVenta);
router.post("/:id/retroceder", soloAdmin, c.retrocederEtapa);

module.exports = router;
