import fs from 'node:fs/promises';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const dir=new URL('./',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');
const src=await SpreadsheetFile.importXlsx(await FileBlob.load('E:/rs_zy/work/职称认定考核表-(2025年).xlsx'));
const data=src.worksheets.getItemAt(0).getRange('C9:J15').values;
for (const year of [2025,2026]) {
 const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(dir+`prepared-${year}.xlsx`));
 const sh=wb.worksheets.getItemAt(0);
 sh.getRange('C9:J15').values=data;
 wb.recalculate();
 console.log(year,(await wb.inspect({kind:'table',range:'工作职责评价表!E17:J17',include:'values,formulas',maxChars:1500,tableMaxRows:1})).ndjson);
 console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:10},maxChars:800})).ndjson);
 await (await SpreadsheetFile.exportXlsx(wb)).save(dir+`authored-${year}.xlsx`);
}
process.exit(0);
