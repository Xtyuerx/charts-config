import fs from 'node:fs/promises';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const dir=new URL('./',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');
for(const year of [2025,2026]){
 const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(dir+`张艳职称认定考核表-(${year}年)-已替换.xlsx`));
 console.log(year,(await wb.inspect({kind:'table',range:'工作职责评价表!G17:J19',include:'values,formulas',maxChars:1200,tableMaxRows:3})).ndjson);
 if(year===2025){
  const b=await wb.render({sheetName:'工作职责评价表',range:'A9:K19',scale:1,format:'png'});
  await fs.writeFile(dir+'final-preview.png',new Uint8Array(await b.arrayBuffer()));
 }
}
process.exit(0);
