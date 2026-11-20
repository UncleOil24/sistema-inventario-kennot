// Presentaciones de compra: cuántas unidades nuestras (litro, metro, kilo, unidad) trae cada unidad de la factura.
const EquivalenciaProveedor = require("../models/EquivalenciaProveedor");
const { normProv } = require("./precios");

const normDesc = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim().slice(0, 300);
const normCod = (s) => String(s || "").replace(/[\[\]\s]/g, "").toUpperCase() || null;

// Factor que se lee en la descripción: "5 LT" → 5 litros, "ROLLO 50 MTS" → 50 metros, "25 KG", "CAJA 100" → 100 unidades
function factorDeDescripcion(desc) {
  const t = normDesc(desc).replace(/,/g, ".");
  const pruebas = [
    [/(\d+(?:\.\d+)?)\s*M2\b/, "M2"], // caja de piso 2,23 M2
    [/(\d+(?:\.\d+)?)\s*(?:LTS?|LITROS?|L)\b/, "LITRO"],
    [/(\d+(?:\.\d+)?)\s*(?:MTS?|METROS?|M)\b(?!\s*M)/, "METRO"],
    [/(\d+(?:\.\d+)?)\s*(?:KGS?|KILOS?)\b/, "KILO"],
    [/\b(?:X|CAJA|BOLSA|PACK|PAQ|PAQUETE|C\/)\s*(?:DE\s*)?(\d{2,5})\b(?!\s*(?:MM|CM|MTS?|M|LTS?|L|KG|GR|ML|CC)\b)/, "UNIDAD"],
  ];
  for (const [re, unidad] of pruebas) {
    const m = t.match(re);
    if (m && Number(m[1]) > 1) return { factor: Number(m[1]), unidad };
  }
  return null;
}

// Equivalencias aprendidas de un proveedor, para usarlas al leer una factura
async function equivalenciasDe(proveedor) {
  if (!proveedor) return { buscar: () => null };
  const lista = await EquivalenciaProveedor.findAll({ where: { proveedor: normProv(proveedor) }, order: [["updatedAt", "DESC"]], raw: true });
  return {
    buscar: (l) => {
      const cod = normCod(l.codigo_proveedor); const d = normDesc(l.descripcion);
      return (cod && lista.find((e) => e.codigo_proveedor === cod)) || lista.find((e) => !e.codigo_proveedor && e.descripcion === d) || (d && lista.find((e) => e.descripcion === d)) || null;
    },
  };
}

// Guarda (o actualiza) lo aprendido al registrar la factura
async function aprender({ proveedor, codigo_proveedor, descripcion, producto_id, factor, usuario }, t) {
  const prov = normProv(proveedor); const cod = normCod(codigo_proveedor); const d = normDesc(descripcion);
  if (!prov || !producto_id || !(Number(factor) > 0)) return;
  const where = cod ? { proveedor: prov, codigo_proveedor: cod } : { proveedor: prov, codigo_proveedor: null, descripcion: d };
  const e = await EquivalenciaProveedor.findOne({ where, transaction: t });
  if (e) await e.update({ producto_id, factor, descripcion: d, usos: e.usos + 1, usuario }, { transaction: t });
  else await EquivalenciaProveedor.create({ ...where, descripcion: d, producto_id, factor, usuario }, { transaction: t });
}

module.exports = { factorDeDescripcion, equivalenciasDe, aprender, normDesc, normCod };
