import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "D:/桌面/秩序册电子版.xlsx";
const outputDir = "D:/Ayumaoqiu/outputs/chengjia_mandoubles_group_detail";
const outputPath = `${outputDir}/秩序册电子版_补充成甲男双小组明细.xlsx`;

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const main = workbook.worksheets.getItem("Sheet1");

const sourceRangeAddress = "A793:AF959";
const sourceListRangeAddress = "A793:B959";
const source = main.getRange(sourceRangeAddress);
const sourceList = main.getRange(sourceListRangeAddress).values;

function parseGroups(rows) {
  const groups = [];
  let current = null;

  for (const row of rows) {
    const left = row[0];
    const name = row[1];
    if (typeof left === "string" && /^[A-Z]{1,2}组$/.test(left.trim())) {
      current = { group: left.trim(), members: [] };
      groups.push(current);
      continue;
    }
    if (current && typeof left === "number" && name) {
      current.members.push({ no: left, name: String(name).trim() });
    }
  }

  return groups;
}

const groups = parseGroups(sourceList);
if (groups.length !== 32) {
  throw new Error(`Expected 32 groups for 成甲男双第一阶段, found ${groups.length}`);
}

function colName(indexOneBased) {
  let n = indexOneBased;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function cell(rowOneBased, colOneBased) {
  return `${colName(colOneBased)}${rowOneBased}`;
}

function rangeAddress(rowOneBased, colOneBased, rows, cols) {
  return `${cell(rowOneBased, colOneBased)}:${cell(rowOneBased + rows - 1, colOneBased + cols - 1)}`;
}

function writeCompactSummary(sheet, startRow, startCol, title) {
  const summaryRows = 2 + Math.ceil(groups.length / 3) * 6 - 1;
  sheet.getRange(rangeAddress(startRow, startCol, summaryRows, 9)).unmerge();

  const titleRange = sheet.getRange(rangeAddress(startRow, startCol, 1, 9));
  titleRange.merge();
  titleRange.values = [[title]];
  titleRange.format = {
    fill: "#D9EAD3",
    font: { bold: true, color: "#000000", size: 9, name: "Microsoft YaHei" },
    horizontalAlignment: "center",
    wrapText: true,
  };
  titleRange.format.rowHeight = 18;
  titleRange.format.borders = { preset: "outside", style: "thin", color: "#000000" };

  const firstDataRow = startRow + 2;
  for (let i = 0; i < groups.length; i += 1) {
    const band = Math.floor(i / 3);
    const slot = i % 3;
    const group = groups[i];
    const row = firstDataRow + band * 6;
    const col = startCol + slot * 3;
    const values = [
      [group.group, "序号", "选手"],
      ["", group.members[0]?.no ?? "", group.members[0]?.name ?? ""],
      ["", group.members[1]?.no ?? "", group.members[1]?.name ?? ""],
      ["", group.members[2]?.no ?? "", group.members[2]?.name ?? ""],
      ["", group.members[3]?.no ?? "", group.members[3]?.name ?? ""],
    ];
    const block = sheet.getRange(rangeAddress(row, col, 5, 3));
    block.values = values;
    block.format = {
      font: { size: 7, name: "Microsoft YaHei" },
      wrapText: true,
      verticalAlignment: "center",
    };
    block.format.borders = { preset: "all", style: "thin", color: "#808080" };
    const header = sheet.getRange(rangeAddress(row, col, 1, 3));
    header.format = {
      fill: "#F2F2F2",
      font: { bold: true, size: 7, name: "Microsoft YaHei" },
      horizontalAlignment: "center",
      wrapText: true,
    };
    const serials = sheet.getRange(rangeAddress(row + 1, col + 1, 4, 1));
    serials.format = { horizontalAlignment: "center" };
  }

  const usedRows = summaryRows;
  const all = sheet.getRange(rangeAddress(startRow, startCol, usedRows, 9));
  all.format.wrapText = true;
  sheet.getRange(rangeAddress(startRow + 2, startCol, usedRows - 2, 9)).format.rowHeight = 15;

  for (let offset = 0; offset < 3; offset += 1) {
    sheet.getRange(`${colName(startCol + offset * 3)}${startRow}:${colName(startCol + offset * 3)}${startRow + usedRows}`).format.columnWidth = 4.2;
    sheet.getRange(`${colName(startCol + offset * 3 + 1)}${startRow}:${colName(startCol + offset * 3 + 1)}${startRow + usedRows}`).format.columnWidth = 4.2;
    sheet.getRange(`${colName(startCol + offset * 3 + 2)}${startRow}:${colName(startCol + offset * 3 + 2)}${startRow + usedRows}`).format.columnWidth = 13.5;
  }
}

// 1) Add a compact detail table directly beside the existing data-exported draw table.
writeCompactSummary(main, 793, 34, "成甲男双第一阶段小组分组明细（数据导出对阵表补充）");

// 2) Append the complete original detailed group table at the end of the main order-book sheet.
const orderBookAppendStart = 1932;
source.copyTo(main.getRange(`A${orderBookAppendStart}:AF${orderBookAppendStart + 166}`), "all");
const appendixTitle = main.getRange(`A${orderBookAppendStart}:AF${orderBookAppendStart}`);
appendixTitle.format = {
  fill: "#D9EAD3",
  font: { bold: true, color: "#000000", size: 13, name: "Microsoft YaHei" },
  wrapText: true,
};

// 3) Add a dedicated sheet with both the original matrix and the compact grouping list.
const detail = workbook.worksheets.add("成甲男双小组明细");
source.copyTo(detail.getRange("A1:AF167"), "all");
writeCompactSummary(detail, 1, 34, "成甲男双第一阶段小组分组明细");
detail.showGridLines = false;
detail.getRange("A1:AF167").format.autofitColumns();
detail.getRange("A1:AF167").format.autofitRows();

// Keep the main sheet readable without altering existing populated columns.
main.getRange("AH793:AP860").format.wrapText = true;
main.getRange("A1932:AF2098").format.wrapText = true;

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 12000,
});
console.log("FORMULA_ERROR_SCAN");
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });

for (const [name, renderOptions] of [
  ["main_data_export_added", { sheetName: "Sheet1", range: "AH793:AP860", scale: 2, format: "png" }],
  ["main_order_append", { sheetName: "Sheet1", range: "A1932:AF2010", scale: 1, format: "png" }],
  ["detail_sheet", { sheetName: "成甲男双小组明细", range: "A1:AP80", scale: 1, format: "png" }],
]) {
  const preview = await workbook.render(renderOptions);
  await fs.writeFile(`${outputDir}/${name}.png`, new Uint8Array(await preview.arrayBuffer()));
  console.log(`RENDERED ${name}.png`);
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`SAVED ${outputPath}`);
