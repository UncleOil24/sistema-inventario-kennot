const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  res.status(err.status || 500).json({
    ok: false,
    error: process.env.NODE_ENV === "production" ? "Error interno del servidor" : err.message,
  });
};

const notFound = (req, res) => {
  res.status(404).json({ ok: false, error: `Ruta no encontrada: ${req.method} ${req.path}` });
};

module.exports = { errorHandler, notFound };
