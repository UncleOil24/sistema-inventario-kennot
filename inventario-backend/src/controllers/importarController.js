const crypto = require("crypto");
const { handler, ErrorNegocio } = require("../services/erp");
const { importarPlanilla: importar } = require("../services/importarPlanilla");

// La importación corre en segundo plano y la pantalla consulta el avance.
// Así no depende de que la conexión del navegador aguante varios minutos.
const trabajos = new Map(); // id -> { estado: "corriendo"|"listo"|"error", paso, inicio, resumen, error }
let enCurso = null;

// POST /api/precios/importar-planilla   (multipart: archivo=.xlsx, desactivar_otros=1)  -> { id }
const importarPlanilla = handler(async (req, res) => {
  if (!req.file) throw new ErrorNegocio("Adjunta la planilla .xlsx");
  if (!/\.xlsx$/i.test(req.file.originalname || "")) throw new ErrorNegocio("El archivo debe ser .xlsx");
  if (enCurso && trabajos.get(enCurso)?.estado === "corriendo") {
    return res.status(409).json({ ok: false, error: "Ya hay una importación en curso. Espera a que termine.", data: { id: enCurso } });
  }
  const id = crypto.randomUUID();
  const trabajo = { estado: "corriendo", paso: "Leyendo la planilla...", inicio: Date.now(), archivo: req.file.originalname };
  trabajos.set(id, trabajo);
  enCurso = id;
  importar(req.file.buffer, {
    usuario: req.usuario.nombre,
    desactivarOtros: req.body?.desactivar_otros === "1" || req.body?.desactivar_otros === "true",
    onProgreso: (paso) => { trabajo.paso = paso; },
  })
    .then((resumen) => Object.assign(trabajo, { estado: "listo", paso: "Importación terminada", resumen, fin: Date.now() }))
    .catch((e) => { console.error("importación:", e); Object.assign(trabajo, { estado: "error", error: e.message, fin: Date.now() }); });
  res.status(202).json({ ok: true, data: { id } });
});

// GET /api/precios/importar-planilla/:id
const estadoImportacion = handler(async (req, res) => {
  const t = trabajos.get(req.params.id);
  if (!t) throw new ErrorNegocio("No encontré esa importación (el servidor pudo reiniciarse). Vuelve a importar.", 404);
  res.json({ ok: true, data: { ...t, segundos: Math.round(((t.fin || Date.now()) - t.inicio) / 1000) } });
});

module.exports = { importarPlanilla, estadoImportacion };
