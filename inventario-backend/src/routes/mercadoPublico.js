const router = require("express").Router();
const { permite } = require("../middlewares/auth");
const c = require("../controllers/mercadoPublicoController");

router.get("/licitaciones", c.listar);
router.get("/licitaciones/:codigo", c.detalle);
router.put("/licitaciones/:codigo", c.actualizar);
router.post("/licitaciones/:codigo/postular", permite("comercial"), c.postular);
router.delete("/licitaciones/:codigo/postular", permite("comercial"), c.deshacerPostulacion);
router.post("/sincronizar", permite("comercial"), c.sincronizar);
router.post("/traer", permite("comercial"), c.traer);
router.get("/trabajo/:id", c.trabajo);

module.exports = router;
