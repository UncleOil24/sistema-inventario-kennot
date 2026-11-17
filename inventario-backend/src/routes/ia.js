const router = require("express").Router();
const multer = require("multer");
const { soloAdmin, permite } = require("../middlewares/auth");
const catalogoPrecios = permite("comercial", "operativo");
const c = require("../controllers/iaController");

const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get("/estado", c.estado);
router.post("/lista-cliente", subir.single("archivo"), c.listaCliente);
router.post("/licitacion/:codigo", c.licitacion);
// Documentos de proveedores cambian precios: encargado de precios (admin)
router.post("/documento-proveedor", catalogoPrecios, subir.single("archivo"), c.documentoProveedor);
router.post("/documento-proveedor/aprobar", catalogoPrecios, c.aprobarDocumento);
router.get("/documentos-cargados", catalogoPrecios, c.documentosCargados);
router.get("/documentos-cargados/detalle", catalogoPrecios, c.detalleDocumento);
router.post("/documentos-cargados/proveedor", catalogoPrecios, c.cambiarProveedorDocumento);
router.get("/auditoria", soloAdmin, c.auditoria);

module.exports = router;
