import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const input = await FileBlob.load("D:/桌面/秩序册电子版.xlsx");
const workbook = await SpreadsheetFile.importXlsx(input);

for (const query of [
  ["insert row", { search: "insert|row", include: "index,examples,notes", maxChars: 8000 }],
  ["worksheet rows", { search: "row|column|insert|delete", include: "index,examples,notes", maxChars: 8000 }],
]) {
  console.log(`\n=== help ${query[0]} ===`);
  console.log(workbook.help("*", query[1]).ndjson);
}

