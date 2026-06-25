import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "D:/桌面/秩序册电子版.xlsx";
const outputDir = "D:/Ayumaoqiu/.codex-work/spreadsheet-edit/previews";
await fs.mkdir(outputDir, { recursive: true });

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

async function inspect(label, options) {
  console.log(`\n=== ${label} ===`);
  const result = await workbook.inspect(options);
  console.log(result.ndjson);
}

const ranges = [
  ["top_schedule", "A1:AP35"],
  ["draw_export_120_240", "A120:AP240"],
  ["draw_export_240_360", "A240:AP360"],
  ["group_780_880", "A780:AP880"],
  ["group_880_980", "A880:AP980"],
  ["adult_singles_group_start", "A430:AP520"],
  ["order_book_after_groups", "A760:AP840"],
];

for (const [label, range] of ranges) {
  await inspect(label, {
    kind: "region",
    sheetId: "Sheet1",
    range,
    maxChars: 18000,
    tableMaxRows: 80,
    tableMaxCols: 42,
    tableMaxCellChars: 120,
  });
  try {
    const preview = await workbook.render({
      sheetName: "Sheet1",
      range,
      scale: 1,
      format: "png",
    });
    await fs.writeFile(`${outputDir}/${label}.png`, new Uint8Array(await preview.arrayBuffer()));
    console.log(`rendered ${label}.png`);
  } catch (error) {
    console.log(`render failed for ${label}: ${error.message}`);
  }
}

await inspect("styles_group_header", {
  kind: "computedStyle",
  sheetId: "Sheet1",
  range: "A793:AP815",
  maxChars: 8000,
});

