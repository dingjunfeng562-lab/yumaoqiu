import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const input = await FileBlob.load("D:/桌面/秩序册电子版.xlsx");
const workbook = await SpreadsheetFile.importXlsx(input);
for (const query of ["range.format.font", "fontSize", "range.format"]) {
  console.log(`\n=== ${query} ===`);
  console.log(workbook.help(query, { include: "index,examples,notes", maxChars: 10000 }).ndjson);
}

