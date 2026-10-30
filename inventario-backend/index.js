require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const sequelize = require("./config/database");
require("./src/models/Producto");
require("./src/models/Cotizacion");
require("./src/models/Cliente");
require("./src/models/Proveedor");
require("./src/models/OrdenCompra");
require("./src/models/Venta");
require("./src/models/Pago");
require("./src/models/Usuario");
require("./src/models/PrecioProveedor");
require("./src/models/Parametro");
require("./src/models/Gasto");
require("./src/models/RegistroCambio");
require("./src/models/AuditoriaIA");

const productosRoutes = require("./src/routes/productos");
const cotizacionesRoutes = require("./src/routes/cotizaciones");
const clientesRoutes = require("./src/routes/Clientes");
const proveedoresRoutes = require("./src/routes/proveedores");
const ordenesCompraRoutes = require("./src/routes/ordenesCompra");
const ventasRoutes = require("./src/routes/ventas");
const pagosRoutes = require("./src/routes/pagos");
const dashboardRoutes = require("./src/routes/dashboard");
const authRoutes = require("./src/routes/auth");
const usuariosRoutes = require("./src/routes/usuarios");
const preciosRoutes = require("./src/routes/precios");
const gastosRoutes = require("./src/routes/gastos");
const parametrosRoutes = require("./src/routes/parametros");
const iaRoutes = require("./src/routes/ia");
const { migrar } = require("./src/services/migracion");
const { requiereAuth } = require("./src/middlewares/auth");
const { crearAdminInicial } = require("./src/controllers/authController");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(morgan("dev"));
app.use(express.json({ limit: "5mb" }));
// Render está detrás de un proxy: así req.ip es la IP real del cliente
app.set("trust proxy", 1);

app.get("/", (req, res) => {
  res.json({ ok: true, message: "InventarioSys API corriendo", version: "3.0.0-ventas" });
});

// Login es público; todo lo demás bajo /api exige sesión
app.use("/api/auth", authRoutes);
app.use("/api", requiereAuth);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/productos", productosRoutes);
app.use("/api/cotizaciones", cotizacionesRoutes);
app.use("/api/clientes", clientesRoutes);
app.use("/api/proveedores", proveedoresRoutes);
app.use("/api/ordenes-compra", ordenesCompraRoutes);
app.use("/api/ventas", ventasRoutes);
app.use("/api/pagos", pagosRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/precios", preciosRoutes);
app.use("/api/gastos", gastosRoutes);
app.use("/api/parametros", parametrosRoutes);
app.use("/api/ia", iaRoutes);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  console.error(err.message);
  if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ ok: false, error: "El archivo es demasiado grande" });
  res.status(err.status || 500).json({ ok: false, error: err.message });
});

const start = async () => {
  try {
    await sequelize.authenticate();
    console.log("✓ Base de datos conectada");
    await sequelize.sync({ alter: true });
    console.log("✓ Modelos sincronizados");
    await migrar();
    await crearAdminInicial();
    app.listen(PORT, () => {
      console.log(`✓ Servidor corriendo en http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("✗ Error al conectar BD:", err.message);
    process.exit(1);
  }
};

start();