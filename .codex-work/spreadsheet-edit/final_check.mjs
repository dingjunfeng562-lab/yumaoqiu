import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const xlsxPath = "D:/Ayumaoqiu/outputs/chengjia_mandoubles_group_detail/秩序册电子版_补充成甲男双小组明细.xlsx";
const outputDir = "D:/Ayumaoqiu/outputs/chengjia_mandoubles_group_detail";
const input = await FileBlob.load(xlsxPath);
const workbook = await SpreadsheetFile.importXlsx(input);

async function inspect(label, options) {
  console.log(`\n=== ${label} ===`);
  const result = await workbook.inspect(options);
  console.log(result.ndjson);
}

await inspect("sheets", { kind: "sheet", include: "id,name", maxChars: 8000 });
await inspect("main compact title", {
  kind: "region",
  sheetId: "Sheet1",
  range: "AH793:AP860",
  tableMaxRows: 20,
  tableMaxCols: 9,
  tableMaxCellChars: 60,
  maxChars: 12000,
});
await inspect("order appendix start", {
  kind: "region",
  sheetId: "Sheet1",
  range: "A1932:AF1965",
  tableMaxRows: 34,
  tableMaxCols: 32,
  tableMaxCellChars: 60,
  maxChars: 16000,
});
await inspect("formula errors", {
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  maxChars: 12000,
});

for (const [name, options] of [
  ["final_order_append_start", { sheetName: "Sheet1", range: "A1932:AF1985", scale: 1, format: "png" }],
  ["final_detail_sheet_top", { sheetName: "成甲男双小组明细", range: "A1:AP80", scale: 1, format: "png" }],
]) {
  const preview = await workbook.render(options);
  await fs.writeFile(`${outputDir}/${name}.png`, new Uint8Array(await preview.arrayBuffer()));
  console.log(`RENDERED ${name}.png`);
}

