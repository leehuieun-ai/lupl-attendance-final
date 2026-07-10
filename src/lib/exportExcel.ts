function safeExcelCell(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `\t${text}` : text;
}

function csvCell(value: unknown) {
  return `"${safeExcelCell(value).replace(/"/g, '""')}"`;
}

export function exportRowsToExcel(filename: string, _sheetName: string, rows: Record<string, unknown>[]) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const body = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((col) => csvCell(row[col])).join(",")),
  ].join("\r\n");
  const blob = new Blob(["\ufeff", body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/\.(xlsx|xls)$/i, ".csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
