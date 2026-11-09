import zipfile, re, copy, sys
import xml.etree.ElementTree as E
from pathlib import Path
N='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
ns={'m':N}; E.register_namespace('',N)
out=Path(__file__).parent
def shift(s):
    return re.sub(r'(\$?[A-Z]{1,3}\$?)(\d+)',lambda m:m[1]+str(int(m[2])-3 if int(m[2])>=19 else (15 if int(m[2])==18 else int(m[2]))),s)
for year in (2025,2026):
    original=Path(f'E:/rs_zy/work/张艳职称认定考核表-({year}年).xlsx')
    prepared=out/f'prepared-{year}.xlsx'
    if sys.argv[1]=='prepare':
        with zipfile.ZipFile(original) as z, zipfile.ZipFile(prepared,'w',zipfile.ZIP_DEFLATED) as w:
            for item in z.infolist():
                data=z.read(item.filename)
                if item.filename=='xl/worksheets/sheet1.xml':
                    root=E.fromstring(data); sd=root.find('m:sheetData',ns)
                    for row in list(sd):
                        old=int(row.get('r'))
                        if 16<=old<=18: sd.remove(row); continue
                        if old>=19: row.set('r',str(old-3))
                        if old==9: row.set('ht','150')
                        if old==10: row.set('ht','115')
                        if old==11: row.set('ht','95')
                        for c in row:
                            c.set('r',shift(c.get('r')))
                            f=c.find('m:f',ns)
                            if f is not None:
                                if f.text: f.text=shift(f.text).replace(')=16',')=13')
                                if 'ref' in f.attrib: f.set('ref',shift(f.get('ref')))
                    for el in root.iter():
                        if 'ref' in el.attrib: el.set('ref',shift(el.get('ref')))
                        if 'sqref' in el.attrib: el.set('sqref',shift(el.get('sqref')))
                    data=E.tostring(root,encoding='utf-8',xml_declaration=True)
                elif item.filename=='xl/workbook.xml':
                    data=re.sub(rb'(<definedName[^>]*>)(.*?)(</definedName>)',lambda m:m[1]+shift(m[2].decode()).encode()+m[3],data)
                w.writestr(item,data)
    else:
        donor=out/f'authored-{year}.xlsx'
        with zipfile.ZipFile(prepared) as z, zipfile.ZipFile(donor) as d, zipfile.ZipFile(out/f'张艳职称认定考核表-({year}年)-已替换.xlsx','w',zipfile.ZIP_DEFLATED) as w:
            root=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
            dr=E.fromstring(d.read('xl/worksheets/sheet1.xml'))
            strings=[]
            if 'xl/sharedStrings.xml' in d.namelist():
                strings=[''.join(x.itertext()) for x in E.fromstring(d.read('xl/sharedStrings.xml'))]
            dc={c.get('r'):c for c in dr.findall('.//m:c',ns)}
            changed={f'{c}{r}' for c in 'CDEFGHIJ' for r in range(9,16)}|{'E17','G17','H17','I17','J17','A19','G19','I19'}
            for row in root.find('m:sheetData',ns):
                for i,c in enumerate(list(row)):
                    a=c.get('r')
                    if a not in changed: continue
                    new=copy.deepcopy(dc[a]); new.set('s',c.get('s','0'))
                    if a in {f'{col}{r}' for col in 'CDEFGHIJ' for r in range(9,16)}:
                        for f in list(new.findall('m:f',ns)): new.remove(f)
                    if new.get('t')=='s':
                        text=strings[int(new.find('m:v',ns).text)]
                        new.remove(new.find('m:v',ns)); new.set('t','inlineStr')
                        t=E.SubElement(E.SubElement(new,f'{{{N}}}is'),f'{{{N}}}t');t.text=text;t.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
                    row.remove(c);row.insert(i,new)
            for item in z.infolist():
                data=E.tostring(root,encoding='utf-8',xml_declaration=True) if item.filename=='xl/worksheets/sheet1.xml' else z.read(item.filename)
                w.writestr(item,data)
        print('Saved',year)
