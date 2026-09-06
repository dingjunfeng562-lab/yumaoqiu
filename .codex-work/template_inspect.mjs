import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = 'D:/桌面/比赛/应职院“ST运动馆”羽毛球双打比赛对阵表.xlsx';
const outDir = 'D:/Ayumaoqiu/.codex-work/template-inspect';
await fs.mkdir(outDir, { recursive: true });
const input = await FileBlob.load(inputPath);
const wb = await SpreadsheetFile.importXlsx(input);
const summary = await wb.inspect({
  kind: 'workbook,sheet,table,definedName,drawing',
  maxChars: 20000,
  tableMaxRows: 30,
  tableMaxCols: 20,
  tableMaxCellChars: 120,
});
await fs.writeFile(`${outDir}/summary.ndjson`, summary.ndjson ?? String(summary));
const sheets = await wb.inspect({ kind: 'sheet', include: 'id,name', maxChars: 10000 });
await fs.writeFile(`${outDir}/sheets.ndjson`, sheets.ndjson ?? String(sheets));
for (const sheet of wb.worksheets.items) {
  const used = sheet.getUsedRange();
  const name = sheet.name;
  const safe = name.replace(/[\\/:*?"<>|]/g, '_');
  const inspect = await wb.inspect({
    kind: 'table,region,formula,computedStyle',
    sheetId: name,
    range: used ? used.address : 'A1:Z50',
    maxChars: 30000,
    tableMaxRows: 100,
    tableMaxCols: 40,
    tableMaxCellChars: 160,
    options: { maxResults: 200 },
  });
  await fs.writeFile(`${outDir}/${safe}.ndjson`, inspect.ndjson ?? String(inspect));
  const preview = await wb.render({ sheetName: name, autoCrop: 'all', scale: 1, format: 'png' });
  await fs.writeFile(`${outDir}/${safe}.png`, new Uint8Array(await preview.arrayBuffer()));
}
console.log(JSON.stringify({ sheets: wb.worksheets.items.map((s) => s.name), outDir }));
