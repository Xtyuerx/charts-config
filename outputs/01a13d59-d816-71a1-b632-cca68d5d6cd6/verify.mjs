import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(new URL('张艳职称认定考核表-(2025年)-研发工作已替换.xlsx',import.meta.url))));
const s=wb.worksheets.getItemAt(0);
for(const [name,range] of [['final-content','B15:J19'],['final-summary','A20:K27']]){
 const p=await wb.render({sheetName:s.name,range,scale:1.3,format:'png'});
 await fs.writeFile(new URL(name+'.png',import.meta.url),new Uint8Array(await p.arrayBuffer()));
}
console.log('Final file rendered');
