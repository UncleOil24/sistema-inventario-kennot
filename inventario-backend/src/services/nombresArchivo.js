// Los navegadores mandan el nombre del archivo en UTF-8, pero multer lo lee como latin1: "Cotización" llegaba como
// "CotizaciÃ³n". Se corrige una vez para todos los archivos subidos (memoryStorage de todas las rutas).
const multer = require("multer");

const arreglar = (s) => {
  const t = String(s || "");
  if (!/[Â-ô][\u0080-¿]/.test(t)) return t; // ya está bien
  try {
    const u = Buffer.from(t, "latin1").toString("utf8");
    return u.includes("�") ? t : u;
  } catch { return t; }
};

const original = multer.memoryStorage;
multer.memoryStorage = (...args) => {
  const s = original(...args);
  const manejar = s._handleFile.bind(s);
  s._handleFile = (req, file, cb) => { file.originalname = arreglar(file.originalname); manejar(req, file, cb); };
  return s;
};

module.exports = { arreglar };
