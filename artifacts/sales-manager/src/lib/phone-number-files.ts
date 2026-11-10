export async function readExcelPhoneCells(buffer: ArrayBuffer): Promise<string[]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array", dense: true });
  const values: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    for (const row of rows) {
      for (const cell of row) {
        if (cell !== null && cell !== undefined && String(cell).trim()) values.push(String(cell));
      }
    }
  }
  return values;
}
