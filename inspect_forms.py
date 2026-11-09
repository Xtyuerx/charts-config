import zipfile, xml.etree.ElementTree as ET, json
from pathlib import Path
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
for p in Path('E:/rs_zy/work').glob('*职称认定考核表*.xlsx'):
    if p.name.startswith('~$'): continue
    with zipfile.ZipFile(p) as z:
        ss=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            ss=[''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        print('\nFILE',p.name)
        print(z.read('xl/workbook.xml').decode()[:1600])
        for n in z.namelist():
            if n.startswith('xl/worksheets/sheet') and n.endswith('.xml'):
                root=ET.fromstring(z.read(n)); cells=[]
                for c in root.findall('.//m:c',ns):
                    v=c.find('m:v',ns); t=c.get('t'); val=v.text if v is not None else ''
                    if t=='s': val=ss[int(val)]
                    elif t=='inlineStr': val=''.join(c.find('m:is',ns).itertext())
                    if val: cells.append((c.get('r'),val))
                print(n,json.dumps(cells,ensure_ascii=False))
