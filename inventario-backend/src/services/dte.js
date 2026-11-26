// Facturas electrónicas (DTE) del SII en XML: el documento original, con los datos exactos.
// Se leen sin IA: proveedor (emisor), RUT, folio, fecha, a nombre de quién viene (receptor), cada línea y los totales.
// Un archivo puede traer varios DTE (EnvioDTE): se devuelve uno por documento.

const TIPOS = { 33: "factura", 34: "factura", 46: "factura", 39: "boleta", 41: "boleta", 52: "guia", 56: "nota_debito", 61: "nota_credito" };

// Decodifica según la declaración (los DTE suelen venir en ISO-8859-1)
function texto(buf) {
  const cabeza = buf.slice(0, 200).toString("latin1");
  return /encoding=["']ISO-8859-1["']/i.test(cabeza) ? buf.toString("latin1") : buf.toString("utf8");
}

const esXML = (file) => /\.xml$/i.test(file?.originalname || "") || /xml/i.test(file?.mimetype || "") ||
  (file?.buffer && /^\s*(<\?xml|<EnvioDTE|<DTE)/.test(file.buffer.slice(0, 100).toString("latin1")));

const entidades = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).trim();
const tag = (xml, nombre) => { const m = xml.match(new RegExp(`<${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${nombre}>`)); return m ? entidades(m[1]) : ""; };
const bloques = (xml, nombre) => [...xml.matchAll(new RegExp(`<${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${nombre}>`, "g"))].map((m) => m[1]);
const num = (s) => { const n = Number(String(s || "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

function leerUno(doc) {
  const enc = bloques(doc, "Encabezado")[0] || "";
  const idDoc = bloques(enc, "IdDoc")[0] || "";
  const emisor = bloques(enc, "Emisor")[0] || "";
  const receptor = bloques(enc, "Receptor")[0] || "";
  const totales = bloques(enc, "Totales")[0] || "";
  const tipo = Number(tag(idDoc, "TipoDTE"));
  const folio = tag(idDoc, "Folio");
  const neto = num(tag(totales, "MntNeto")) + num(tag(totales, "MntExe"));
  const iva = num(tag(totales, "IVA"));
  const total = num(tag(totales, "MntTotal"));
  // En boletas los precios vienen con IVA
  const conIva = tipo === 39 || tipo === 41;
  const lineas = bloques(doc, "Detalle").map((d) => {
    const cant = num(tag(d, "QtyItem")) || 1;
    const monto = num(tag(d, "MontoItem"));
    const unit = monto ? monto / cant : num(tag(d, "PrcItem"));
    const nombre = [tag(d, "NmbItem"), tag(d, "DscItem")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return {
      descripcion: nombre, codigo_proveedor: tag(bloques(d, "CdgItem")[0] || "", "VlrCodigo") || "", marca: "",
      unidad: tag(d, "UnmdItem") || "", cantidad: cant, precio_neto: Math.round(conIva ? unit / 1.19 : unit), total_linea: Math.round(monto || unit * cant), pack: null,
    };
  }).filter((l) => l.descripcion);
  // Descuento o recargo global: se reparte en las líneas en proporción
  const sumaLineas = lineas.reduce((s, l) => s + l.total_linea, 0);
  const refNeto = conIva ? total : neto;
  if (refNeto && sumaLineas && Math.abs(sumaLineas - refNeto) > Math.max(2, refNeto * 0.005) && bloques(doc, "DscRcgGlobal").length) {
    const f = refNeto / sumaLineas;
    for (const l of lineas) { l.precio_neto = Math.round(l.precio_neto * f); l.total_linea = Math.round(l.total_linea * f); }
  }
  const suma = lineas.reduce((s, l) => s + l.total_linea, 0);
  return {
    encabezado: {
      proveedor: tag(emisor, "RznSoc") || tag(emisor, "RznSocEmisor"), razon_social: tag(emisor, "RznSoc") || tag(emisor, "RznSocEmisor"), rut: tag(emisor, "RUTEmisor"),
      cliente_razon_social: tag(receptor, "RznSocRecep"), cliente_rut: tag(receptor, "RUTRecep"),
      tipo_documento: TIPOS[tipo] || "factura", tipo_dte: tipo || null, numero_documento: folio,
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(tag(idDoc, "FchEmis")) ? tag(idDoc, "FchEmis") : null,
      valido_hasta: null, validez_dias: null, total_documento: Math.round(total) || null, neto: Math.round(neto) || null, iva: Math.round(iva) || null,
    },
    control: { suma_lineas: Math.round(suma), total_documento: refNeto ? Math.round(refNeto) : null, cuadra: refNeto ? Math.abs(suma - refNeto) <= Math.max(2, refNeto * 0.01) : null, precios_incluyen_iva: conIva },
    lineas, truncado: false, origen: "xml",
  };
}

// Devuelve [{ xml, datos }] con un elemento por DTE del archivo
function leerDTE(buf) {
  const xml = texto(buf);
  const docs = bloques(xml, "Documento");
  if (!docs.length) throw new Error("El XML no trae un documento tributario electrónico (DTE)");
  return docs.map((d) => ({ xml: d, datos: leerUno(d) }));
}

module.exports = { esXML, leerDTE, TIPOS };
