// Respaldo completo de la base en un Excel (una hoja por tabla) y envío por correo.
const ExcelJS = require("exceljs");
const Producto = require("../models/Producto");
const PrecioProveedor = require("../models/PrecioProveedor");
const Proveedor = require("../models/Proveedor");
const Cliente = require("../models/Cliente");
const Cotizacion = require("../models/Cotizacion");
const Venta = require("../models/Venta");
const OrdenCompra = require("../models/OrdenCompra");
const Pago = require("../models/Pago");
const Gasto = require("../models/Gasto");
const Usuario = require("../models/Usuario");
const { getParametros, setParametros } = require("./parametros");
const { ErrorNegocio } = require("./erp");

const valorCelda = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
};

// Agrega una hoja con todas las columnas del modelo (y líneas aparte para los documentos con items)
const hoja = (wb, nombre, filas) => {
  const ws = wb.addWorksheet(nombre);
  if (!filas.length) { ws.addRow(["(sin registros)"]); return; }
  const cols = Object.keys(filas[0]);
  ws.addRow(cols);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  filas.forEach((f) => ws.addRow(cols.map((c) => valorCelda(f[c]))));
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(Math.max(c.length + 2, 12), 45); });
};

const lineas = (docs, campoDoc) => docs.flatMap((d) => (d.items || []).map((i, k) => ({ [campoDoc]: d.numero, linea: k + 1, ...i })));

async function generarRespaldo() {
  const plano = (r) => r.map((x) => (typeof x.toJSON === "function" ? x.toJSON() : x));
  const [productos, precios, proveedores, clientes, cotizaciones, ventas, ordenes, pagos, gastos, usuarios, params] = await Promise.all([
    Producto.findAll({ order: [["codigo", "ASC"]] }), PrecioProveedor.findAll({ order: [["id", "ASC"]] }),
    Proveedor.findAll({ order: [["nombre", "ASC"]] }), Cliente.findAll({ order: [["nombre", "ASC"]] }),
    Cotizacion.findAll({ order: [["id", "ASC"]] }), Venta.findAll({ order: [["id", "ASC"]] }),
    OrdenCompra.findAll({ order: [["id", "ASC"]] }), Pago.findAll({ order: [["id", "ASC"]] }),
    Gasto.findAll({ order: [["id", "ASC"]] }), Usuario.findAll({ order: [["id", "ASC"]] }), getParametros(),
  ]).then((r) => r.map((x, i) => (i === 10 ? x : plano(x))));

  const sinItems = (docs) => docs.map(({ items, seguimientos, ...resto }) => ({ ...resto, ...(seguimientos ? { seguimientos } : {}) }));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sistema Kenott";
  wb.created = new Date();
  hoja(wb, "Productos", productos.map(({ stock, stock_minimo, precio_venta, ...p }) => p));
  hoja(wb, "Precios proveedor", precios);
  hoja(wb, "Proveedores", proveedores);
  hoja(wb, "Clientes", clientes);
  hoja(wb, "Cotizaciones", sinItems(cotizaciones));
  hoja(wb, "Cotizaciones lineas", lineas(cotizaciones, "cotizacion"));
  hoja(wb, "Ventas", sinItems(ventas));
  hoja(wb, "Ventas lineas", lineas(ventas, "venta"));
  hoja(wb, "Ordenes compra", sinItems(ordenes));
  hoja(wb, "Ordenes lineas", lineas(ordenes, "orden"));
  hoja(wb, "Pagos y cobros", pagos);
  hoja(wb, "Gastos", gastos);
  hoja(wb, "Usuarios", usuarios.map(({ password_hash, token_version, ...u }) => u));
  hoja(wb, "Parametros", Object.entries(params).map(([clave, valor]) => ({ clave, valor })));
  const buffer = await wb.xlsx.writeBuffer();
  const fecha = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
  return { buffer: Buffer.from(buffer), nombre: `Respaldo_Kenott_${fecha}.xlsx`, resumen: { productos: productos.length, precios: precios.length, cotizaciones: cotizaciones.length, ventas: ventas.length } };
}

// Correo por SMTP (Gmail con contraseña de aplicación). Variables en Render:
// SMTP_USER, SMTP_PASS y opcionales SMTP_HOST (smtp.gmail.com), SMTP_PORT (465)
const correoConfigurado = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

async function enviarCorreo({ para, asunto, texto, adjuntos }) {
  if (!correoConfigurado()) throw new ErrorNegocio("Falta configurar el correo (SMTP_USER y SMTP_PASS en Render)", 503);
  const nodemailer = require("nodemailer");
  const puerto = Number(process.env.SMTP_PORT) || 465;
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com", port: puerto, secure: puerto === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  try {
    await t.sendMail({ from: `"Sistema Kenott" <${process.env.SMTP_USER}>`, to: para, subject: asunto, text: texto, attachments: adjuntos });
  } catch (e) {
    console.error("correo:", e.message);
    const msg = /invalid login|username and password|535/i.test(e.message)
      ? "El correo rechazó el usuario o la contraseña: revisa SMTP_USER y SMTP_PASS (en Gmail se usa una contraseña de aplicación)"
      : `No se pudo enviar el correo: ${e.message}`;
    throw new ErrorNegocio(msg, 502);
  }
}

async function enviarRespaldo() {
  if (!correoConfigurado()) throw new ErrorNegocio("Falta configurar el correo (SMTP_USER y SMTP_PASS en Render)", 503);
  const params = await getParametros();
  const para = params.respaldo_email || process.env.SMTP_USER;
  if (!para) throw new ErrorNegocio("Indica en Configuración a qué correo llega el respaldo");
  const r = await generarRespaldo();
  await enviarCorreo({
    para,
    asunto: `Respaldo semanal Sistema Kenott (${r.nombre.slice(16, 26)})`,
    texto: `Respaldo automático del sistema de ventas.\n\nProductos: ${r.resumen.productos}\nPrecios en historial: ${r.resumen.precios}\nCotizaciones: ${r.resumen.cotizaciones}\nVentas: ${r.resumen.ventas}\n\nGuarda este archivo: tiene toda la información del sistema en Excel.`,
    adjuntos: [{ filename: r.nombre, content: r.buffer }],
  });
  await setParametros({ ultimo_respaldo: new Date().toISOString() });
  return { para, archivo: r.nombre, ...r.resumen };
}

module.exports = { generarRespaldo, enviarRespaldo, enviarCorreo, correoConfigurado };
