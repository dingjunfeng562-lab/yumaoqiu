import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const input = await FileBlob.load("D:/Ayumaoqiu/outputs/chengjia_mandoubles_group_detail/秩序册电子版_补充成甲男双小组明细.xlsx");
const workbook = await SpreadsheetFile.importXlsx(input);
const result = await workbook.inspect({
  kind: "computedStyle",
  sheetId: "Sheet1",
  range: "AH793:AP805",
  maxChars: 12000,
});
console.log(result.ndjson);

