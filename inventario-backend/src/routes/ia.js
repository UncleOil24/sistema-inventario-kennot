const router = require("express").Router();
const multer = require("multer");
const { soloAdmin } = require("../middlewares/auth");
const c = require("../controllers/iaController");

const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get("/estado", c.estado);
router.post("/lista-cliente", subir.single("archivo"), c.listaCliente);
router.post("/licitacion/:codigo", c.licitacion);
// Documentos de proveedores cambian precios: encargado de precios (admin)
router.post("/documento-proveedor", soloAdmin, subir.single("archivo"), c.documentoProveedor);
router.post("/documento-proveedor/aprobar", soloAdmin, c.aprobarDocumento);
router.get("/auditoria", soloAdmin, c.auditoria);

module.exports = router;
