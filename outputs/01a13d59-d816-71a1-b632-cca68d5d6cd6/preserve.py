import zipfile,xml.etree.ElementTree as E,copy,re,json
from pathlib import Path
base=Path(__file__).parent
original=Path(r'E:\rs_zy\work\张艳职称认定考核表-(2025年).xlsx')
final=base/'张艳职称认定考核表-(2025年)-研发工作已替换.xlsx'
N='http://schemas.openxmlformats.org/spreadsheetml/2006/main';ns={'s':N}
E.register_namespace('',N)
def q(t):return '{'+N+'}'+t
def strings(z):
 return [''.join(si.itertext()) for si in E.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
def value(c,ss):
 if c is None:return None
 v=c.find(q('v'))
 if c.get('t')=='s':return ss[int(v.text)]
 if c.get('t')=='inlineStr':return ''.join(c.find(q('is')).itertext())
 return v.text if v is not None else None
with zipfile.ZipFile(original) as oz,zipfile.ZipFile(base/'authored.xlsx') as az:
 root=E.fromstring(oz.read('xl/worksheets/sheet1.xml')); oldroot=copy.deepcopy(root)
 ar=E.fromstring(az.read('xl/worksheets/sheet1.xml')); ass=strings(az)
 ac={c.get('r'):c for c in ar.findall('.//s:sheetData/s:row/s:c',ns)}
 data=root.find(q('sheetData'));rows={int(r.get('r')):r for r in data}
 for row in list(data):
  r=int(row.get('r'))
  if r>=16:
   row.set('r',str(r+3))
   for c in row:c.set('r',re.sub(r'\d+$',str(r+3),c.get('r')))
 for r in range(16,19):
  row=copy.deepcopy(rows[12]);row.set('r',str(r))
  for c in row:
   c.set('r',re.sub(r'\d+$',str(r),c.get('r')))
   for el in list(c):c.remove(el)
   c.attrib.pop('t',None)
  data.append(row)
 data[:]=sorted(data,key=lambda x:int(x.get('r')))
 rows={int(r.get('r')):r for r in data}
 def overlay(addr):
  row=rows[int(re.search(r'\d+',addr).group())]; target=next((c for c in row if c.get('r')==addr),None)
  if target is None:target=E.SubElement(row,q('c'),{'r':addr})
  for el in list(target):target.remove(el)
  target.attrib.pop('t',None)
  src=ac.get(addr)
  if src is None:return
  if src.get('t')=='s':
   target.set('t','inlineStr');si=E.SubElement(target,q('is'));t=E.SubElement(si,q('t'));t.text=value(src,ass);t.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
  else:
   if src.get('t'):target.set('t',src.get('t'))
   for el in src:target.append(copy.deepcopy(el))
 for r in range(9,19):
  rows[r].set('ht','90');rows[r].set('customHeight','1')
  for col in 'CDEFGHIJ':overlay(f'{col}{r}')
 for addr in ['E20','G20','H20','I20','J20','A22','G22','I22','A24']:overlay(addr)
 merges=root.find(q('mergeCells'))
 def shift(m):
  return re.sub(r'(\$?[A-Z]+\$?)(\d+)',lambda z:z[1]+str(int(z[2])+3 if int(z[2])>=16 else int(z[2])),m)
 for m in merges:
  ref=m.get('ref');m.set('ref',{'A9:A15':'A9:A18','B9:B15':'B9:B18'}.get(ref,shift(ref)))
 root.find(q('dimension')).set('ref','A1:K27')
 for row in data:row[:]=sorted(row,key=lambda c:sum((ord(x)-64)*26**i for i,x in enumerate(re.match('[A-Z]+',c.get('r')).group()[::-1])))
 with zipfile.ZipFile(final,'w',zipfile.ZIP_DEFLATED) as out:
  for item in oz.infolist():
   raw=oz.read(item.filename)
   if item.filename=='xl/worksheets/sheet1.xml':raw=E.tostring(root,encoding='utf-8',xml_declaration=True)
   elif item.filename=='xl/workbook.xml':
    wr=E.fromstring(raw)
    changed=False
    for dn in wr.findall('.//s:definedName',ns):
     if dn.get('name')=='_xlnm.Print_Area' and dn.text:dn.text=shift(dn.text);changed=True
    if changed:raw=E.tostring(wr,encoding='utf-8',xml_declaration=True)
   out.writestr(item,raw)
with zipfile.ZipFile(final) as z,zipfile.ZipFile(original) as old:
 rt=E.fromstring(z.read('xl/worksheets/sheet1.xml'));cs={c.get('r'):c for c in rt.findall('.//s:sheetData/s:row/s:c',ns)};ss=strings(z)
 src=json.loads((base/'source-values.json').read_text('utf-8'))
 for i,r in enumerate(range(9,19)):
  for j,col in enumerate('CDEFGH'):
   actual=value(cs.get(f'{col}{r}'),ss);expected=src[i][j]
   assert (actual is None and expected is None) or str(actual)==str(expected),(r,col,actual,expected)
 oldcells={c.get('r'):c for c in oldroot.findall('.//s:sheetData/s:row/s:c',ns)};oss=strings(old)
 for addr,c in oldcells.items():
  r=int(re.search(r'\d+',addr).group())
  if r<=8 or r==16 or r>=22:
   target=addr if r<=8 else shift(addr)
   assert value(c,oss)==value(cs.get(target),ss),(addr,target)
 assert abs(float(value(cs['G20'],ss))-89.7)<1e-9
 assert float(value(cs['E20'],ss))==100
 for item in old.namelist():
  if item not in ['xl/worksheets/sheet1.xml','xl/workbook.xml']:assert old.read(item)==z.read(item),item
 print(json.dumps({'output':str(final),'self_total':89.7,'max_points':100,'research_items':10,'verified':True},ensure_ascii=False))
