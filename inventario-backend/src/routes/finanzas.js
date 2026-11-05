const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const { handler } = require("../services/erp");
const { calcularCobranza, suspenderMorosos } = require("../services/cobranza");

// Finanzas y Control: solo gerencia
router.use(soloAdmin);

// GET /api/finanzas/cobranza?empresa=kenott|tactics
router.get("/cobranza", handler(async (req, res) => {
  const suspendidos = await suspenderMorosos();
  const data = await calcularCobranza({ empresa: ["kenott", "tactics"].includes(req.query.empresa) ? req.query.empresa : undefined });
  res.json({ ok: true, data: { ...data, suspendidos_ahora: suspendidos } });
}));

module.exports = router;
