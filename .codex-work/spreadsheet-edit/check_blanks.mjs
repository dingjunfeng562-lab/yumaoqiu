import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const input = await FileBlob.load("D:/桌面/秩序册电子版.xlsx");
const workbook = await SpreadsheetFile.importXlsx(input);

for (const range of ["A428:AP434", "AH793:AP960", "A1920:AP1935"]) {
  console.log(`\n=== ${range} ===`);
  const result = await workbook.inspect({
    kind: "region",
    sheetId: "Sheet1",
    range,
    tableMaxRows: 20,
    tableMaxCols: 42,
    tableMaxCellChars: 80,
    maxChars: 12000,
  });
  console.log(result.ndjson);
}

