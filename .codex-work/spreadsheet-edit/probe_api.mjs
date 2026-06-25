import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const input = await FileBlob.load("D:/桌面/秩序册电子版.xlsx");
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItem("Sheet1");
const range = sheet.getRange("A433:AF433");

console.log("range keys", Object.keys(range).sort().join(","));
console.log("sheet keys", Object.keys(sheet).sort().join(","));
console.log("worksheets keys", Object.keys(workbook.worksheets).sort().join(","));

for (const name of ["insert", "delete", "shiftDown", "insertRows", "addRows", "rows"]) {
  console.log(name, typeof range[name], typeof sheet[name]);
}

