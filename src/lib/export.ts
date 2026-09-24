// Exportación de reportes a formatos estándar (RF-REP-09, RNF-12).

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /** Formato para PDF (p. ej. moneda). En CSV se exporta el valor crudo. */
  format?: (v: number) => string;
  align?: "left" | "right";
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV compatible con Excel en configuración regional argentina (separador ";" y coma decimal). */
export function exportCSV<T>(filename: string, cols: ExportColumn<T>[], rows: T[]) {
  const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const cell = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : esc(v));
  const lines = [cols.map((c) => esc(c.header)).join(";"), ...rows.map((r) => cols.map((c) => cell(c.value(r))).join(";"))];
  download(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

export async function exportPDF<T>(opts: { title: string; subtitle?: string; filename: string; cols: ExportColumn<T>[]; rows: T[]; summary?: [string, string][] }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: opts.cols.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(21, 26, 43);
  doc.rect(0, 0, width, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(opts.title, 40, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(opts.subtitle ?? "", 40, 48);
  doc.text(`Generado: ${new Date().toLocaleString("es-AR")}`, width - 40, 48, { align: "right" });
  let y = 84;
  if (opts.summary?.length) {
    doc.setTextColor(51, 58, 82);
    doc.setFontSize(10);
    opts.summary.forEach(([k, v], i) => {
      const x = 40 + (i % 4) * ((width - 80) / 4);
      const row = Math.floor(i / 4);
      doc.setFont("helvetica", "normal");
      doc.text(k, x, y + row * 30);
      doc.setFont("helvetica", "bold");
      doc.text(v, x, y + row * 30 + 13);
    });
    y += Math.ceil(opts.summary.length / 4) * 30 + 6;
  }
  autoTable(doc, {
    startY: y,
    head: [opts.cols.map((c) => c.header)],
    body: opts.rows.map((r) =>
      opts.cols.map((c) => {
        const v = c.value(r);
        if (v === null || v === undefined) return "";
        return typeof v === "number" && c.format ? c.format(v) : String(v);
      }),
    ),
    styles: { fontSize: 8.5, cellPadding: 5, textColor: [51, 58, 82] },
    headStyles: { fillColor: [217, 129, 36], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 245, 241] },
    columnStyles: Object.fromEntries(opts.cols.map((c, i) => [i, { halign: c.align ?? "left" }])),
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(122, 132, 160);
      doc.text("La Barra · Sistema de gestión", 40, doc.internal.pageSize.getHeight() - 20);
    },
  });
  doc.save(opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`);
}
