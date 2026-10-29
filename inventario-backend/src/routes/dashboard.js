const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const { getDashboard, getReportes } = require("../controllers/dashboardController");

router.get("/", getDashboard);
router.get("/reportes", soloAdmin, getReportes);

module.exports = router;
