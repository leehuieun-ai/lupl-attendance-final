function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeExcelCell(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `\t${text}` : text;
}

export function exportRowsToExcel(filename: string, sheetName: string, rows: Record<string, unknown>[]) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const safeSheetName = escapeHtml(sheetName || "Sheet1");
  const tableRows = rows.map((row) => (
    `<tr>${columns.map((col) => `<td>${escapeHtml(safeExcelCell(row[col]))}</td>`).join("")}</tr>`
  )).join("");
  const tableHead = `<tr>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${safeSheetName}</title></head><body><table>${tableHead}${tableRows}</table></body></html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/\.xlsx$/i, ".xls");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
