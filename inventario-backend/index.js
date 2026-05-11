require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const sequelize = require("./config/database");
require("./src/models/Producto");
require("./src/models/Cotizacion");

const productosRoutes = require("./src/routes/productos");
const cotizacionesRoutes = require("./src/routes/cotizaciones");
const { errorHandler, notFound } = require("./src/middlewares/errorHandler");

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(morgan("dev"));
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, message: "InventarioSys API corriendo", version: "1.0.0" });
});

// Rutas
app.use("/api/productos", productosRoutes);
app.use("/api/cotizaciones", cotizacionesRoutes);

// Error handlers
app.use(notFound);
app.use(errorHandler);

// Conectar BD e iniciar servidor
const start = async () => {
  try {
    await sequelize.authenticate();
    console.log("✓ Base de datos conectada");

    // sync({ alter: true }) actualiza tablas sin borrar datos
    await sequelize.sync({ alter: true });
    console.log("✓ Modelos sincronizados");

    app.listen(PORT, () => {
      console.log(`✓ Servidor corriendo en http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("✗ Error al conectar BD:", err.message);
    process.exit(1);
  }
};

start();
