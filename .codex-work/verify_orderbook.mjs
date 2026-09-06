import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const input = await FileBlob.load('D:/Ayumaoqiu/apps/backend/_check.xlsx');
const workbook = await SpreadsheetFile.importXlsx(input);
const outDir = 'D:/Ayumaoqiu/outputs/orderbook_template_preview';
await fs.mkdir(outDir, { recursive: true });
const summary = await workbook.inspect({
  kind: 'workbook,sheet,table,formula',
  maxChars: 12000,
  tableMaxRows: 8,
  tableMaxCols: 10,
  tableMaxCellChars: 120,
});
await fs.writeFile(`${outDir}/inspect.ndjson`, summary.ndjson ?? String(summary));
for (const name of workbook.worksheets.items.map((sheet) => sheet.name)) {
  const preview = await workbook.render({ sheetName: name, autoCrop: 'all', scale: 1, format: 'png' });
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  await fs.writeFile(`${outDir}/${safe}.png`, new Uint8Array(await preview.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outDir}/秩序册综合模板示例.xlsx`);
console.log(JSON.stringify({ sheets: workbook.worksheets.items.map((sheet) => sheet.name), outDir }));
