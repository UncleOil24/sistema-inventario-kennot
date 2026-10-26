const router = require("express").Router();
const { getUsuarios, crearUsuario, actualizarUsuario } = require("../controllers/usuariosController");
const { soloAdmin } = require("../middlewares/auth");

router.use(soloAdmin);
router.get("/", getUsuarios);
router.post("/", crearUsuario);
router.put("/:id", actualizarUsuario);

module.exports = router;
