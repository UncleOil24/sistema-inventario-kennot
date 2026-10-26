const router = require("express").Router();
const { login, yo, cambiarPassword } = require("../controllers/authController");
const { requiereAuth } = require("../middlewares/auth");

router.post("/login", login);
router.get("/me", requiereAuth, yo);
router.post("/cambiar-password", requiereAuth, cambiarPassword);

module.exports = router;
