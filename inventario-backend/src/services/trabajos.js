// Trabajos en segundo plano (importar, sincronizar): la pantalla consulta el avance por id.
const crypto = require("crypto");
const trabajos = new Map();
const enCurso = new Map(); // tipo -> id

function iniciar(tipo, fn) {
  const actual = enCurso.get(tipo);
  if (actual && trabajos.get(actual)?.estado === "corriendo") return { id: actual, yaCorria: true };
  const id = crypto.randomUUID();
  const t = { tipo, estado: "corriendo", paso: "Comenzando...", inicio: Date.now() };
  trabajos.set(id, t);
  enCurso.set(tipo, id);
  Promise.resolve()
    .then(() => fn((paso, actual = null, total = null) => { Object.assign(t, { paso, actual, total }); }))
    .then((resumen) => Object.assign(t, { estado: "listo", paso: "Terminado", resumen, fin: Date.now() }))
    .catch((e) => { console.error(`${tipo}:`, e.message); Object.assign(t, { estado: "error", error: e.message, fin: Date.now() }); });
  // limpieza de trabajos viejos
  for (const [k, v] of trabajos) if (v.fin && Date.now() - v.fin > 6 * 3600e3) trabajos.delete(k);
  return { id, yaCorria: false };
}

const estado = (id) => {
  const t = trabajos.get(id);
  return t ? { ...t, segundos: Math.round(((t.fin || Date.now()) - t.inicio) / 1000) } : null;
};
const ultimo = (tipo) => (enCurso.get(tipo) ? estado(enCurso.get(tipo)) : null);

module.exports = { iniciar, estado, ultimo };
