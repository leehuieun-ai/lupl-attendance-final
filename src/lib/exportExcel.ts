function safeExcelCell(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `\t${text}` : text;
}

function htmlCell(value: unknown) {
  return safeExcelCell(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\r?\n/g, "<br>");
}

export function exportRowsToExcel(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[],
  options: { title?: string; subtitle?: string; footer?: string } = {},
) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const generatedAt = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date());
  const tableRows = rows.length
    ? rows.map((row) => `<tr>${columns.map((col) => `<td>${htmlCell(row[col]) || "&nbsp;"}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${Math.max(1, columns.length)}">내보낼 데이터가 없습니다.</td></tr>`;
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${htmlCell(sheetName || "Sheet1")}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <style>
    body { font-family: Pretendard, "Malgun Gothic", Arial, sans-serif; color: #111827; }
    .doc-title { font-size: 20pt; font-weight: 800; text-align: center; padding: 18px 0 6px; }
    .doc-subtitle { font-size: 10pt; color: #4b5563; text-align: center; padding-bottom: 12px; }
    .meta td { border: 1px solid #9ca3af; padding: 7px; font-size: 9pt; }
    .meta .label { background: #eef2f7; font-weight: 700; width: 110px; }
    table.data { border-collapse: collapse; width: 100%; margin-top: 14px; }
    table.data th { background: #1f4e79; color: #fff; border: 1px solid #8096ad; padding: 8px; font-weight: 700; font-size: 9pt; }
    table.data td { border: 1px solid #c7d0dc; padding: 7px; mso-number-format: "\\@"; font-size: 9pt; vertical-align: top; }
    .footer { margin-top: 14px; color: #6b7280; font-size: 8pt; }
  </style>
</head>
<body>
  <div class="doc-title">${htmlCell(options.title || sheetName || "LUPL Report")}</div>
  <div class="doc-subtitle">${htmlCell(options.subtitle || "주식회사 러플 근태관리 시스템 공식 내보내기")}</div>
  <table class="meta">
    <tr><td class="label">문서명</td><td>${htmlCell(sheetName || "Sheet1")}</td><td class="label">생성일시</td><td>${htmlCell(generatedAt)}</td></tr>
    <tr><td class="label">자료건수</td><td>${rows.length.toLocaleString("ko-KR")}건</td><td class="label">확인</td><td>회사 보관용 / 세무·노무 제출 전 최종 확인 필요</td></tr>
  </table>
  <table class="data">
    <thead><tr>${(columns.length ? columns : ["내용"]).map((col) => `<th>${htmlCell(col)}</th>`).join("")}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">${htmlCell(options.footer || "본 문서는 시스템 저장 데이터를 기준으로 생성되었습니다.")}</div>
</body>
</html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/\.(xlsx|xls|csv)$/i, ".xls");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
