const router = require("express").Router();
const { getDashboard } = require("../controllers/dashboardController");

router.get("/", getDashboard);

module.exports = router;
