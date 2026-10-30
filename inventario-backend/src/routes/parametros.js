const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const { handler } = require("../services/erp");
const { getParametros, setParametros } = require("../services/parametros");

router.get("/", handler(async (req, res) => res.json({ ok: true, data: await getParametros() })));
router.put("/", soloAdmin, handler(async (req, res) => res.json({ ok: true, data: await setParametros(req.body || {}) })));

module.exports = router;
