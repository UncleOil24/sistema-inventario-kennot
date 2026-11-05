const router = require("express").Router();
const { getUsuarios, crearUsuario, actualizarUsuario, crearEquipo } = require("../controllers/usuariosController");
const { soloAdmin } = require("../middlewares/auth");

router.use(soloAdmin);
router.get("/", getUsuarios);
router.post("/", crearUsuario);
router.post("/equipo", crearEquipo);
router.put("/:id", actualizarUsuario);

module.exports = router;
