// Tareas programadas. Las llama una tarea de GitHub Actions una vez al día (ver .github/workflows/tareas.yml).
// Es pública (sin sesión) pero solo hace trabajo cuando corresponde, así que llamarla de más no tiene efecto:
//  - sincroniza Mercado Público si pasaron 6 horas desde la última vez (y hay ticket)
//  - envía el respaldo por correo si pasaron 6 días desde el último (y hay correo configurado)
const router = require("express").Router();
const { getParametros } = require("../services/parametros");
const trabajos = require("../services/trabajos");
const mp = require("../services/mercadoPublico");
const { enviarRespaldo, correoConfigurado } = require("../services/respaldo");

let ultimaLlamada = 0;
const horasDesde = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 3600e3 : Infinity);

router.all("/", async (req, res) => {
  if (Date.now() - ultimaLlamada < 10 * 60e3) return res.json({ ok: true, data: { omitido: "llamada reciente" } });
  ultimaLlamada = Date.now();
  try {
    const p = await getParametros();
    const hecho = {};
    if (mp.ticketConfigurado() && horasDesde(p.mp_ultima_sincronizacion) >= 6) {
      hecho.mercado_publico = trabajos.iniciar("mercado_publico", (avisar) => mp.sincronizar({ onProgreso: avisar })).id;
    }
    if (correoConfigurado() && horasDesde(p.ultimo_respaldo) >= 6 * 24) {
      hecho.respaldo = trabajos.iniciar("respaldo", () => enviarRespaldo()).id;
    }
    res.json({ ok: true, data: hecho });
  } catch (e) {
    console.error("tareas:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
