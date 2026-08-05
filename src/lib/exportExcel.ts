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

type WorkbookSheet = { name: string; rows: Record<string, unknown>[] };

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function xmlEscape(value: unknown) {
  return safeExcelCell(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetXml(rows: Record<string, unknown>[]) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const effectiveColumns = columns.length ? columns : ["내용"];
  const allRows = [
    Object.fromEntries(effectiveColumns.map((column) => [column, column])),
    ...(rows.length ? rows : [Object.fromEntries(effectiveColumns.map((column) => [column, ""]))]),
  ];
  const rowXml = allRows.map((row, rowIndex) => {
    const cells = effectiveColumns.map((column, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(row[column])}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function workbookXml(sheets: WorkbookSheet[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name).slice(0, 31)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
</workbook>`;
}

function workbookRelsXml(sheets: WorkbookSheet[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function contentTypesXml(sheets: WorkbookSheet[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="10"/><name val="Malgun Gothic"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="1"><xf xfId="0"/></cellXfs>
</styleSheet>`;
}

function writeUint16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function writeUint32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true); }

function zipFiles(files: { name: string; content: string }[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, nameBytes.length);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, 0);
    writeUint16(centralView, 14, 0);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, data.length);
    writeUint32(centralView, 24, data.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint32(centralView, 42, offset);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  });
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, offset);
  const blobParts = [...localParts, ...centralParts, end].map(part =>
    part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer
  );
  return new Blob(blobParts, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function exportWorkbookToXlsx(filename: string, sheets: WorkbookSheet[]) {
  const safeSheets = sheets.length ? sheets : [{ name: "Sheet1", rows: [] }];
  const files = [
    { name: "[Content_Types].xml", content: contentTypesXml(safeSheets) },
    { name: "_rels/.rels", content: rootRelsXml() },
    { name: "xl/workbook.xml", content: workbookXml(safeSheets) },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelsXml(safeSheets) },
    { name: "xl/styles.xml", content: stylesXml() },
    ...safeSheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheetXml(sheet.rows) })),
  ];
  const blob = zipFiles(files);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/\.(xls|csv)$/i, ".xlsx");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
