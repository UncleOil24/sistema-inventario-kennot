// Caché corta del Inicio: si dos personas lo abren casi al mismo tiempo no se calcula dos veces.
// Dura 2 minutos y se borra completa con cualquier cambio (POST/PUT/DELETE), así nunca muestra algo ya resuelto.
const DURACION = 2 * 60 * 1000;
const guardado = new Map();
const leer = (clave) => {
  const g = guardado.get(clave);
  if (!g || Date.now() - g.t > DURACION) { guardado.delete(clave); return null; }
  return g.data;
};
const guardar = (clave, data) => guardado.set(clave, { t: Date.now(), data });
const limpiar = () => guardado.clear();
// Middleware: cualquier escritura invalida la caché
const invalidarAlEscribir = (req, res, next) => { if (req.method !== "GET") limpiar(); next(); };
module.exports = { leer, guardar, limpiar, invalidarAlEscribir };
