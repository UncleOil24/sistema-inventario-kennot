const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const c = require("../controllers/mercadoPublicoController");

router.get("/licitaciones", c.listar);
router.get("/licitaciones/:codigo", c.detalle);
router.put("/licitaciones/:codigo", c.actualizar);
router.post("/sincronizar", soloAdmin, c.sincronizar);
router.get("/trabajo/:id", c.trabajo);

module.exports = router;
