import * as XLSX from "xlsx";
export function exportRowsToExcel(filename:string,sheetName:string,rows:Record<string,unknown>[]){const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,sheetName);XLSX.writeFile(wb,filename)}
