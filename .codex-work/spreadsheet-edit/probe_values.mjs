import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const input = await FileBlob.load("D:/桌面/秩序册电子版.xlsx");
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItem("Sheet1");
const values = sheet.getRange("A793:B805").values;
console.log(JSON.stringify(values, null, 2));

