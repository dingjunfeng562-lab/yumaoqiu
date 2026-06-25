import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "D:/桌面/秩序册电子版.xlsx";
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

async function inspect(label, range) {
  console.log(`\n=== ${label} ${range} ===`);
  const result = await workbook.inspect({
    kind: "region",
    sheetId: "Sheet1",
    range,
    tableMaxRows: 120,
    tableMaxCols: 42,
    tableMaxCellChars: 80,
    maxChars: 24000,
  });
  console.log(result.ndjson);
}

for (const term of ["成甲男双第一阶段：", "成乙男双第一阶段：", "成甲男双第二阶段", "成乙男双第二阶段", "成年男单第一阶段："]) {
  console.log(`\n=== Match exact-ish: ${term} ===`);
  const result = await workbook.inspect({
    kind: "match",
    searchTerm: term,
    options: { maxResults: 50 },
    maxChars: 12000,
  });
  console.log(result.ndjson);
}

await inspect("end_of_adult_md", "A930:AP970");
await inspect("start_of_draw_export", "A420:AP450");
await inspect("end_of_order_schedule", "A400:AP440");

