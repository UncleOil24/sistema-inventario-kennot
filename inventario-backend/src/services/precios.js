// Reglas de precios (las mismas de la planilla LISTADO_CONSOLIDADO):
//  1. El precio de compra es siempre NETO (un precio web / con IVA se divide por 1,19).
//  2. Se toma el precio UNITARIO (si solo viene el total de la línea, se divide por la cantidad).
//  4. Gana el más barato. De cada proveedor vale su precio más reciente.
//  5. Opción 2 y 3 = segundo y tercer proveedor más baratos, nunca el mismo del principal.
//  6. Un precio CONFIRMADO solo lo reemplaza un precio nuevo más barato
//     ("MÁS BARATA que tu confirmado $X"). Si el nuevo es más caro, se mantiene y se avisa.
//  7. Si gana un precio web y hay cotización de proveedor más cara, se avisa en REVISAR.
const { Op } = require("sequelize");
const PrecioProveedor = require("../models/PrecioProveedor");
const Proveedor = require("../models/Proveedor");
const RegistroCambio = require("../models/RegistroCambio");
const { ErrorNegocio } = require("./erp");

const IVA = 1.19;
const normProv = (s) => String(s || "").trim().toUpperCase();
const pesos = (n) => `$${Math.round(Number(n)).toLocaleString("es-CL")}`;

// Convierte lo que se ingresó al precio neto unitario (reglas 1 y 2)
const precioNetoUnitario = ({ precio, total_linea, cantidad, con_iva }) => {
  let p = Number(precio);
  if (!(p > 0) && Number(total_linea) > 0 && Number(cantidad) > 0) p = Number(total_linea) / Number(cantidad);
  if (!(p > 0)) throw new ErrorNegocio("Indica un precio unitario (o el total de la línea y la cantidad)");
  if (con_iva) p /= IVA;
  return Math.round(p);
};

// El precio más reciente de cada proveedor (sin descartados), ordenado del más barato al más caro
const vigentesPorProveedor = (precios) => {
  const porProv = new Map();
  // Más reciente primero; si el mismo proveedor tiene dos precios el mismo día, vale el más barato
  const orden = [...precios].sort((a, b) =>
    String(b.fecha).localeCompare(String(a.fecha)) || Number(a.precio) - Number(b.precio) || b.id - a.id);
  for (const p of orden) {
    if (p.descartado) continue;
    const k = normProv(p.proveedor);
    if (!porProv.has(k)) porProv.set(k, p);
  }
  return [...porProv.values()].sort((a, b) => Number(a.precio) - Number(b.precio) || String(b.fecha).localeCompare(String(a.fecha)));
};

const registrar = (datos, t) => RegistroCambio.create(datos, { transaction: t });

// Recalcula precio vigente, opciones 2/3 y avisos de un producto.
// Devuelve los cambios aplicados.
const recalcular = async (producto, { t, usuario, motivo } = {}) => {
  const precios = await PrecioProveedor.findAll({ where: { producto_id: producto.id }, transaction: t });
  const vigentes = vigentesPorProveedor(precios);
  if (vigentes.length === 0) return {}; // sin historial: no se toca lo que tenga

  const avisos = [];
  let principal; // { proveedor, precio, fecha }
  let confirmado = producto.confirmado;
  const compraActual = Number(producto.precio_compra) || 0;

  if (producto.confirmado && compraActual > 0) {
    // Solo cuentan los precios cargados después de confirmar
    const desde = producto.fecha_confirmado ? new Date(producto.fecha_confirmado) : new Date(0);
    const nuevos = vigentes.filter((p) => new Date(p.createdAt) > desde);
    const masBarato = nuevos.find((p) => Number(p.precio) < compraActual);
    if (masBarato) {
      principal = masBarato;
      confirmado = false;
      avisos.push(`MÁS BARATA que tu confirmado ${pesos(compraActual)} (${producto.proveedor || "sin proveedor"})`);
    } else {
      principal = { proveedor: producto.proveedor, precio: compraActual, fecha: producto.fecha_precio, origen: null };
      const caros = nuevos.filter((p) => normProv(p.proveedor) !== normProv(producto.proveedor) || Number(p.precio) !== compraActual);
      caros.forEach((p) => avisos.push(`COT. ${p.proveedor} ${pesos(p.precio)} más cara que tu confirmado - se mantiene`));
    }
  } else {
    principal = vigentes[0];
  }

  // Regla 7: gana un precio web y existe cotización de proveedor más cara
  if (principal.origen === "web") {
    const cot = vigentes.find((p) => p.origen !== "web" && Number(p.precio) > Number(principal.precio));
    if (cot) avisos.push(`WEB ${principal.proveedor} | COT. ${cot.proveedor} ${pesos(cot.precio)} más cara - revisar`);
  }

  const otros = vigentes.filter((p) => normProv(p.proveedor) !== normProv(principal.proveedor));
  const [op2, op3] = otros;

  let contacto = producto.contacto;
  if (normProv(principal.proveedor) !== normProv(producto.proveedor)) {
    const prov = await Proveedor.findOne({ where: { nombre: { [Op.iLike]: String(principal.proveedor).trim() } }, transaction: t });
    contacto = prov ? (prov.contacto || prov.telefono || prov.email || null) : null;
  }

  const cambios = {
    precio_compra: Number(principal.precio),
    proveedor: principal.proveedor,
    contacto,
    fecha_precio: principal.fecha,
    opcion2_proveedor: op2?.proveedor || null,
    opcion2_precio: op2 ? Number(op2.precio) : null,
    opcion2_fecha: op2?.fecha || null,
    opcion3_proveedor: op3?.proveedor || null,
    opcion3_precio: op3 ? Number(op3.precio) : null,
    opcion3_fecha: op3?.fecha || null,
    confirmado,
  };
  // Los avisos nuevos reemplazan a los anteriores; un confirmado sin avisos queda limpio
  if (avisos.length) cambios.revisar = avisos.join(" | ");
  else if (confirmado) cambios.revisar = null;
  else if (principal.origen === "web") cambios.revisar = `WEB ${principal.proveedor}`;
  else cambios.revisar = principal.proveedor ? `${principal.proveedor}` : null;

  for (const campo of ["precio_compra", "proveedor"]) {
    const antes = producto[campo];
    if (String(Number(antes) || antes || "") !== String(Number(cambios[campo]) || cambios[campo] || "")) {
      await registrar({ usuario, tabla: "productos", registro_id: producto.id, campo, antes: antes == null ? null : String(antes), despues: String(cambios[campo]), motivo: motivo || "Recálculo de precios" }, t);
    }
  }
  await producto.update(cambios, { transaction: t });
  return cambios;
};

// Origen web si el proveedor está marcado como tienda web
const origenDe = async (nombreProveedor, t) => {
  const prov = await Proveedor.findOne({ where: { nombre: { [Op.iLike]: String(nombreProveedor).trim() } }, transaction: t });
  return prov?.tipo === "web" ? "web" : "proveedor";
};

// Qué cuenta como aviso real en REVISAR (el resto del texto es solo el origen del precio, ej. "WEB SODIMAC")
const SQL_AVISO = `(NOT confirmado AND precio_compra > 0 AND revisar ~* '(revis|verific|m[aá]s barat|m[aá]s car|antes \\$|pendiente)')`;

module.exports = { SQL_AVISO, recalcular, precioNetoUnitario, vigentesPorProveedor, normProv, origenDe, registrar, IVA };
