import openpyxl, zipfile
from pathlib import Path
p=Path(__file__).parent
s=openpyxl.load_workbook('E:/rs_zy/work/职称认定考核表-(2025年).xlsx',data_only=True).active
for y in (2025,2026):
 original=Path(f'E:/rs_zy/work/张艳职称认定考核表-({y}年).xlsx')
 output=p/f'张艳职称认定考核表-({y}年)-已替换.xlsx'
 a=openpyxl.load_workbook(original,data_only=True).active
 b=openpyxl.load_workbook(output,data_only=True).active
 for row in range(9,16):
  for col in range(3,11): assert b.cell(row,col).value==s.cell(row,col).value,(y,row,col)
 for row in range(1,28):
  if 9<=row<=18: continue
  for col in range(1,12):
   if row in (20,22): continue
   nr=row-3 if row>=19 else row
   assert a.cell(row,col).value==b.cell(nr,col).value,(y,row,col,'unrelated value')
 assert [b[x].value for x in ['E17','G17','H17','I17','J17']]==[100,88.7,86.7,87.7,'良好']
 with zipfile.ZipFile(original) as z,zipfile.ZipFile(output) as w:
  assert z.namelist()==w.namelist()
  for n in z.namelist():
   if n not in ('xl/worksheets/sheet1.xml','xl/workbook.xml'): assert z.read(n)==w.read(n),n
 print(y,'PASS: 56 section cells match; unrelated values and formatting preserved; totals correct.')
