// Lectura y calce con Claude (API de Anthropic).
// Claude solo LEE documentos y PROPONE el producto del catálogo para cada línea.
// Los precios los pone siempre el sistema, y una persona revisa antes de emitir o cambiar un precio.
const ExcelJS = require("exceljs");
const { ErrorNegocio } = require("./erp");
const AuditoriaIA = require("../models/AuditoriaIA");

const MODELO = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
let clienteIA = null;

// Permite inyectar un cliente falso en pruebas
const setClienteIA = (c) => { clienteIA = c; };
const iaConfigurada = () => !!(clienteIA || process.env.ANTHROPIC_API_KEY);
const getCliente = () => {
  if (clienteIA) return clienteIA;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ErrorNegocio("Falta configurar ANTHROPIC_API_KEY en el servidor (Render > Environment)", 503);
  }
  const Anthropic = require("@anthropic-ai/sdk").default;
  clienteIA = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return clienteIA;
};

// --- Archivo -> contenido para Claude --------------------------------------------
const extension = (nombre) => String(nombre || "").toLowerCase().split(".").pop();
const IMAGENES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

async function excelATexto(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const partes = [];
  let filas = 0;
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return;
    partes.push(`### Hoja: ${ws.name}`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (filas >= 1500) return;
      const celdas = (row.values || []).slice(1).map((v) => {
        if (v && typeof v === "object") v = v.result ?? v.text ?? (v.richText ? v.richText.map((r) => r.text).join("") : "");
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        return String(v ?? "").replace(/\s+/g, " ").trim();
      });
      if (celdas.some(Boolean)) { partes.push(celdas.join(" | ")); filas++; }
    });
  });
  return partes.join("\n");
}

// Devuelve los bloques de contenido (texto, PDF o imagen) para el mensaje
async function contenidoArchivo(file) {
  if (!file?.buffer?.length) throw new ErrorNegocio("Adjunta un archivo");
  const ext = extension(file.originalname);
  const mime = file.mimetype || "";
  if (ext === "pdf" || mime === "application/pdf") {
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.buffer.toString("base64") } }];
  }
  if (IMAGENES[ext] || mime.startsWith("image/")) {
    const media = IMAGENES[ext] || mime;
    if (!Object.values(IMAGENES).includes(media)) throw new ErrorNegocio("Formato de imagen no soportado (usa JPG o PNG)");
    return [{ type: "image", source: { type: "base64", media_type: media, data: file.buffer.toString("base64") } }];
  }
  if (ext === "xlsx" || ext === "xlsm") return [{ type: "text", text: `Contenido de la planilla:\n${await excelATexto(file.buffer)}` }];
  if (ext === "docx") {
    const mammoth = require("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return [{ type: "text", text: `Contenido del documento Word:\n${value}` }];
  }
  if (["csv", "txt", "tsv"].includes(ext)) return [{ type: "text", text: `Contenido del archivo:\n${file.buffer.toString("utf8")}` }];
  if (ext === "xls" || ext === "doc") throw new ErrorNegocio("Guarda el archivo en formato nuevo (.xlsx o .docx) y vuelve a subirlo");
  throw new ErrorNegocio("Formato no soportado. Sube Excel, PDF, Word, CSV o una foto");
}

// Llama a Claude obligándolo a responder con la herramienta (JSON con formato fijo)
async function llamar({ system, contenido, herramienta, maxTokens = 8000 }) {
  const cliente = getCliente();
  const r = await cliente.messages.create({
    model: MODELO(),
    max_tokens: maxTokens,
    system,
    tools: [herramienta],
    tool_choice: { type: "tool", name: herramienta.name },
    messages: [{ role: "user", content: contenido }],
  });
  const bloque = (r.content || []).find((b) => b.type === "tool_use");
  if (!bloque) throw new ErrorNegocio("Claude no devolvió una respuesta válida. Intenta de nuevo.", 502);
  return { datos: bloque.input, uso: r.usage || {}, truncado: r.stop_reason === "max_tokens" };
}

const auditar = (datos) => AuditoriaIA.create(datos).catch((e) => { console.error("auditoría IA:", e.message); return null; });

// --- Búsqueda local de candidatos ---------------------------------------------------
const VACIAS = new Set(["MTS", "MT", "DE", "DEL", "LA", "EL", "LOS", "LAS", "PARA", "CON", "SIN", "EN", "Y", "O", "POR", "UN", "UNA", "X", "A", "AL", "C", "S", "TIPO", "COLOR"]);
const normalizar = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
  .replace(/(\d),(\d)/g, "$1.$2")
  .replace(/(\d)\.0+\b/g, "$1")
  .replace(/(\d)([A-Z])/g, "$1 $2").replace(/([A-Z])(\d)/g, "$1 $2")
  .replace(/\b(PULGADAS?|PULG|PLG)\b/g, " ")
  .replace(/[^A-Z0-9./]+/g, " ")
  .replace(/(^|\s)\.|\.(?=\s|$)/g, " ")
  .trim();
const tokens = (s) => normalizar(s).split(/\s+/).filter((t) => t && !VACIAS.has(t));

// indice: [{ id, texto (nombre + descripciones de proveedores), tokens:Set }]
function crearIndice(productos, descripcionesProveedor = new Map()) {
  return productos.map((p) => {
    const extra = descripcionesProveedor.get(p.id) || [];
    return { producto: p, tokens: new Set(tokens(`${p.nombre} ${extra.join(" ")}`)), propios: new Set(tokens(p.nombre)) };
  });
}

function candidatos(descripcion, indice, n = 15) {
  const tl = [...new Set(tokens(descripcion))];
  if (!tl.length) return [];
  const resultados = [];
  for (const e of indice) {
    let s = 0;
    for (const t of tl) {
      const numero = /\d/.test(t);
      if (e.tokens.has(t)) s += numero ? 2.2 : t.length >= 3 ? 1 : 0.4;
      else if (!numero && t.length >= 4) {
        const pref = t.slice(0, 4);
        for (const pt of e.propios) { if (pt.startsWith(pref)) { s += 0.5; break; } }
      }
    }
    if (s > 0) resultados.push({ e, s: s / Math.sqrt(Math.max(e.propios.size, 3)) });
  }
  return resultados.sort((a, b) => b.s - a.s).slice(0, n).map((r) => r.e.producto);
}

// --- Calce con Claude ----------------------------------------------------------------
const HERR_CALCE = {
  name: "registrar_calces",
  description: "Registra, para cada línea, el producto del catálogo que corresponde y el tipo de calce.",
  input_schema: {
    type: "object",
    properties: {
      calces: {
        type: "array",
        items: {
          type: "object",
          properties: {
            linea: { type: "integer", description: "Número de la línea (L1, L2... sin la L)" },
            producto_id: { type: ["integer", "null"], description: "id del candidato elegido, o null si ninguno sirve" },
            calce: { type: "string", enum: ["exacto", "equivalente", "parecido", "sin_producto"] },
            nota: { type: "string", description: "Nota corta en español (máx. 15 palabras): qué difiere o por qué no hay producto" },
          },
          required: ["linea", "producto_id", "calce", "nota"],
        },
      },
    },
    required: ["calces"],
  },
};

const SYSTEM_CALCE = `Eres el asistente de una ferretería chilena (Inversiones Kenott). Calzas descripciones de productos con el catálogo de la empresa.
Para cada línea recibes candidatos del catálogo (id | descripción estándar | unidad). Elige el que corresponde:
- "exacto": mismo producto, misma medida y unidad (aunque esté escrito distinto o con abreviaturas).
- "equivalente": mismo producto y medida, pero cambia la marca o el modelo comercial.
- "parecido": se parece pero difiere en algo importante (medida, calidad, presentación, unidad de venta). Indica qué difiere en la nota.
- "sin_producto": ningún candidato sirve. producto_id = null.
Las medidas importan: 20 mm no es 25 mm, 1/2" no es 3/4", 25 kg no es 50 kg. Nunca inventes un id que no esté en los candidatos.
Notas cortas, en español.`;

async function calzarLineas(lineas, indice, { usuario, tipo, archivo } = {}) {
  const resultado = lineas.map((l) => ({ ...l, candidatos: candidatos(`${l.descripcion} ${l.marca || ""}`, indice) }));
  const BLOQUE = 30;
  let uso = { input_tokens: 0, output_tokens: 0 };
  const respuestas = [];
  for (let i = 0; i < resultado.length; i += BLOQUE) {
    const parte = resultado.slice(i, i + BLOQUE);
    const texto = parte.map((l, k) => {
      const n = i + k + 1;
      const cands = l.candidatos.length
        ? l.candidatos.map((p) => `   ${p.id} | ${p.nombre} | ${p.unidad}`).join("\n")
        : "   (sin candidatos)";
      return `L${n}: "${l.descripcion}"${l.unidad ? ` [unidad: ${l.unidad}]` : ""}${l.marca ? ` [marca: ${l.marca}]` : ""}\n${cands}`;
    }).join("\n\n");
    const { datos, uso: u } = await llamar({
      system: SYSTEM_CALCE,
      contenido: [{ type: "text", text: `Calza estas ${parte.length} líneas:\n\n${texto}` }],
      herramienta: HERR_CALCE,
      maxTokens: 4000,
    });
    uso = { input_tokens: uso.input_tokens + (u.input_tokens || 0), output_tokens: uso.output_tokens + (u.output_tokens || 0) };
    respuestas.push(datos);
    for (const c of datos.calces || []) {
      const l = resultado[Number(c.linea) - 1];
      if (!l || l.calce) continue;
      const elegido = l.candidatos.find((p) => p.id === Number(c.producto_id)) || null;
      l.producto_id = elegido ? elegido.id : null;
      l.calce = elegido ? (c.calce === "sin_producto" ? "parecido" : c.calce) : "sin_producto";
      l.nota = c.nota || "";
    }
  }
  for (const l of resultado) if (!l.calce) Object.assign(l, { producto_id: null, calce: "sin_producto", nota: "Sin respuesta para esta línea" });
  await auditar({ tipo: `calce_${tipo}`, archivo, usuario, modelo: MODELO(), entrada_tokens: uso.input_tokens, salida_tokens: uso.output_tokens, respuesta: respuestas });
  return resultado;
}

// --- Lista del cliente --------------------------------------------------------------
const HERR_LISTA = {
  name: "registrar_lineas",
  description: "Registra cada producto solicitado en la lista del cliente.",
  input_schema: {
    type: "object",
    properties: {
      lineas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string", description: "Descripción tal como la escribe el cliente (incluye medidas y marca)" },
            cantidad: { type: "number" },
            unidad: { type: "string", description: "Unidad que indica el cliente, o vacío" },
          },
          required: ["descripcion", "cantidad"],
        },
      },
      cliente: { type: "string", description: "Nombre del cliente o institución si aparece, o vacío" },
      observaciones: { type: "string", description: "Algo relevante del documento (plazo, lugar de entrega), o vacío" },
    },
    required: ["lineas"],
  },
};

async function leerListaCliente(file, indice, usuario) {
  const contenido = await contenidoArchivo(file);
  const { datos, uso, truncado } = await llamar({
    system: "Lees listas de materiales que envían clientes de una ferretería chilena (Excel, PDF, Word o foto). Extrae cada producto pedido con su cantidad. Ignora encabezados, totales, firmas y textos que no son productos. Si una cantidad no se lee, usa 1.",
    contenido: [...contenido, { type: "text", text: "Extrae todas las líneas de productos de este documento." }],
    herramienta: HERR_LISTA,
    maxTokens: 16000,
  });
  await auditar({ tipo: "lectura_lista_cliente", archivo: file.originalname, usuario, modelo: MODELO(), entrada_tokens: uso.input_tokens, salida_tokens: uso.output_tokens, respuesta: datos });
  const lineas = (datos.lineas || [])
    .filter((l) => l.descripcion && String(l.descripcion).trim())
    .map((l) => ({ descripcion: String(l.descripcion).trim(), cantidad: Number(l.cantidad) > 0 ? Number(l.cantidad) : 1, unidad: l.unidad || "" }));
  if (!lineas.length) throw new ErrorNegocio("No encontré productos en el archivo");
  const calzadas = await calzarLineas(lineas, indice, { usuario, tipo: "lista_cliente", archivo: file.originalname });
  return { lineas: calzadas, cliente: datos.cliente || "", observaciones: datos.observaciones || "", truncado };
}

// --- Documento de proveedor (cotización o factura) -----------------------------------
const HERR_PROVEEDOR = {
  name: "registrar_documento",
  description: "Registra los datos de la cotización o factura del proveedor, línea por línea.",
  input_schema: {
    type: "object",
    properties: {
      proveedor: { type: "string", description: "Nombre comercial del proveedor (corto, ej. MADESUR, CYC, SODIMAC)" },
      razon_social: { type: "string" },
      rut: { type: "string" },
      tipo_documento: { type: "string", enum: ["cotizacion", "factura", "boleta", "web", "otro"] },
      numero_documento: { type: "string", description: "N° de cotización o factura tal como aparece" },
      fecha: { type: "string", description: "Fecha del documento en formato AAAA-MM-DD" },
      precios_incluyen_iva: { type: "boolean", description: "true si los precios unitarios de las líneas incluyen IVA (típico en boletas y tiendas web)" },
      total_neto: { type: ["number", "null"], description: "Total neto del documento (sin IVA), o null si no aparece" },
      total_documento: { type: ["number", "null"], description: "Total final con IVA, o null" },
      lineas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string", description: "Descripción tal cual la escribe el proveedor" },
            codigo_proveedor: { type: "string" },
            marca: { type: "string" },
            unidad: { type: "string" },
            cantidad: { type: "number" },
            precio_unitario: { type: ["number", "null"], description: "Precio unitario tal como aparece (después de descuentos de línea si los hay)" },
            total_linea: { type: ["number", "null"] },
          },
          required: ["descripcion", "cantidad"],
        },
      },
    },
    required: ["proveedor", "lineas"],
  },
};

async function leerDocumentoProveedor(file, indice, usuario) {
  const contenido = await contenidoArchivo(file);
  const { datos, uso, truncado } = await llamar({
    system: "Lees cotizaciones y facturas de proveedores de una ferretería chilena. Extrae proveedor, número, fecha y cada línea con descripción, unidad, cantidad y precio unitario. Los montos chilenos usan punto como separador de miles ($1.392 = 1392). Si hay descuento por línea, el precio unitario es el que queda después del descuento.",
    contenido: [...contenido, { type: "text", text: "Extrae los datos de este documento." }],
    herramienta: HERR_PROVEEDOR,
    maxTokens: 16000,
  });
  await auditar({ tipo: "lectura_documento_proveedor", archivo: file.originalname, usuario, modelo: MODELO(), entrada_tokens: uso.input_tokens, salida_tokens: uso.output_tokens, respuesta: datos });

  const conIva = !!datos.precios_incluyen_iva;
  // Reglas 1 y 2: precio unitario neto
  const lineas = (datos.lineas || []).filter((l) => l.descripcion).map((l) => {
    const cant = Number(l.cantidad) > 0 ? Number(l.cantidad) : 1;
    let unit = Number(l.precio_unitario) > 0 ? Number(l.precio_unitario) : (Number(l.total_linea) > 0 ? Number(l.total_linea) / cant : 0);
    const totalLinea = Number(l.total_linea) > 0 ? Number(l.total_linea) : unit * cant;
    if (conIva) unit /= 1.19;
    return {
      descripcion: String(l.descripcion).trim(), codigo_proveedor: l.codigo_proveedor || "", marca: l.marca || "",
      unidad: l.unidad || "", cantidad: cant, precio_neto: Math.round(unit), total_linea: Math.round(totalLinea),
    };
  });
  if (!lineas.length) throw new ErrorNegocio("No encontré líneas de productos en el documento");

  // Control: la suma de las líneas debe dar el total del documento
  const suma = lineas.reduce((s, l) => s + l.total_linea, 0);
  const referencia = conIva ? Number(datos.total_documento) || null : Number(datos.total_neto) || (Number(datos.total_documento) ? Number(datos.total_documento) / 1.19 : null);
  const control = {
    suma_lineas: Math.round(suma),
    total_documento: referencia ? Math.round(referencia) : null,
    cuadra: referencia ? Math.abs(suma - referencia) <= Math.max(2, referencia * 0.01) : null,
    precios_incluyen_iva: conIva,
  };

  const calzadas = await calzarLineas(lineas, indice, { usuario, tipo: "documento_proveedor", archivo: file.originalname });
  return {
    encabezado: {
      proveedor: String(datos.proveedor || "").trim().toUpperCase(), razon_social: datos.razon_social || "", rut: datos.rut || "",
      tipo_documento: datos.tipo_documento || "cotizacion", numero_documento: datos.numero_documento || "",
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(datos.fecha || "") ? datos.fecha : null,
    },
    control, lineas: calzadas, truncado,
  };
}

module.exports = {
  iaConfigurada, setClienteIA, MODELO, leerListaCliente, leerDocumentoProveedor, crearIndice, candidatos, normalizar, contenidoArchivo,
};
