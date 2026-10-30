const router = require("express").Router();
const { soloAdmin } = require("../middlewares/auth");
const { handler } = require("../services/erp");
const { generarRespaldo, enviarRespaldo, correoConfigurado } = require("../services/respaldo");
const { getParametros } = require("../services/parametros");

router.use(soloAdmin);

// GET /api/respaldo/estado
router.get("/estado", handler(async (req, res) => {
  const p = await getParametros();
  res.json({ ok: true, data: { correo: correoConfigurado(), para: p.respaldo_email || process.env.SMTP_USER || "", ultimo: p.ultimo_respaldo || null } });
}));

// GET /api/respaldo/excel   -> descarga el respaldo completo
router.get("/excel", async (req, res) => {
  try {
    const r = await generarRespaldo();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${r.nombre}"`);
    res.end(r.buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/respaldo/enviar   -> lo envía por correo ahora
router.post("/enviar", handler(async (req, res) => res.json({ ok: true, data: await enviarRespaldo() })));

module.exports = router;
