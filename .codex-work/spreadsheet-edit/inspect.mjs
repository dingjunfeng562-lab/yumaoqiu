import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "D:/桌面/秩序册电子版.xlsx";
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

async function logInspect(label, options) {
  console.log(`\n=== ${label} ===`);
  const result = await workbook.inspect(options);
  console.log(result.ndjson);
}

await logInspect("Sheets", {
  kind: "sheet",
  include: "id,name",
  maxChars: 12000,
});

await logInspect("Workbook Summary", {
  kind: "workbook,sheet,table",
  tableMaxRows: 5,
  tableMaxCols: 8,
  tableMaxCellChars: 80,
  maxChars: 20000,
});

for (const term of ["成甲男双", "男双", "第一阶段", "秩序册", "对阵", "小组", "分组"]) {
  await logInspect(`Match: ${term}`, {
    kind: "match",
    searchTerm: term,
    options: { maxResults: 100 },
    maxChars: 20000,
  });
}

