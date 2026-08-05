require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const sequelize = require("./config/database");
require("./src/models/Producto");
require("./src/models/Cotizacion");
require("./src/models/Cliente");

const productosRoutes = require("./src/routes/productos");
const cotizacionesRoutes = require("./src/routes/cotizaciones");
const clientesRoutes = require("./src/routes/Clientes");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(morgan("dev"));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ ok: true, message: "InventarioSys API corriendo", version: "1.0.0" });
});

app.use("/api/productos", productosRoutes);
app.use("/api/cotizaciones", cotizacionesRoutes);
app.use("/api/clientes", clientesRoutes);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ ok: false, error: err.message });
});

const start = async () => {
  try {
    await sequelize.authenticate();
    console.log("✓ Base de datos conectada");
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