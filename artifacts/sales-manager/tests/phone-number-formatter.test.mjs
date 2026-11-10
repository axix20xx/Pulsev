import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { cleanPhoneNumbers, parseDelimitedRows } from "../src/lib/phone-number-formatter.ts";
import { readExcelPhoneCells } from "../src/lib/phone-number-files.ts";

test("formats spaced Persian and ASCII numbers on one comma-separated line", () => {
  const result = cleanPhoneNumbers(["09129179705\n0912 772 666\n82772662"]);
  assert.equal(result.output, "09129179705,0912772666,82772662");
  assert.equal(result.validNumbers.length, 3);
  assert.equal(result.invalidNumbers.length, 0);
});

test("preserves order and leading zeroes while removing duplicates", () => {
  const result = cleanPhoneNumbers(["0912 772 666, ۰۹۱۲۷۷۲۶۶۶; 82772662"]);
  assert.equal(result.output, "0912772666,82772662");
  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(result.totalDetected, 3);
});

test("keeps short or oversized values in the output for review", () => {
  const result = cleanPhoneNumbers(["1234\n091234567890123456"]);
  assert.equal(result.output, "1234,091234567890123456");
  assert.equal(result.validNumbers.length, 0);
  assert.equal(result.invalidNumbers.length, 2);
});

test("preserves existing plus country prefix without adding one", () => {
  const result = cleanPhoneNumbers(["+98 912 345 6789"]);
  assert.equal(result.output, "+989123456789");
});

test("expands pasted scientific notation into ordinary digits", () => {
  const result = cleanPhoneNumbers(["9.129179705E+09"]);
  assert.equal(result.output, "9129179705");
});

test("reads quoted CSV cells and escaped quotes without splitting quoted commas", () => {
  const rows = parseDelimitedRows('"Mobile","Label"\r\n"0912 772 666","A, B"\r\n"82772662","quoted ""name"""');
  assert.deepEqual(rows, [
    ["Mobile", "Label"],
    ["0912 772 666", "A, B"],
    ["82772662", 'quoted "name"'],
  ]);
});

test("supports semicolon-delimited exports", () => {
  assert.deepEqual(parseDelimitedRows("phone;name\n0912772666;Sam"), [
    ["phone", "name"],
    ["0912772666", "Sam"],
  ]);
});

test("processes thousands of entries in order without losing leading zeros", () => {
  const numbers = Array.from({ length: 5_000 }, (_, index) => `09${String(index).padStart(9, "0")}`);
  const result = cleanPhoneNumbers(numbers);
  assert.equal(result.totalDetected, 5_000);
  assert.equal(result.validNumbers.length, 5_000);
  assert.equal(result.invalidNumbers.length, 0);
  assert.equal(result.output.split(",").length, 5_000);
  assert.equal(result.output.split(",")[0], "09000000000");
  assert.equal(result.output.split(",").at(-1), "09000004999");
});

test("reads Excel display values and preserves zero-padded phone formatting", async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["phone", "name"],
    ["0912 772 666", "Sam"],
    [null, null],
  ]);
  sheet.A3 = { t: "n", v: 9123456789, z: "00000000000" };
  sheet["!ref"] = "A1:B3";
  XLSX.utils.book_append_sheet(workbook, sheet, "Numbers");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const values = await readExcelPhoneCells(buffer);
  assert.deepEqual(values, ["phone", "name", "0912 772 666", "Sam", "09123456789"]);
});
