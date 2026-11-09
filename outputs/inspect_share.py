from pathlib import Path
import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import Image, ImageOps, ImageDraw
root=Path(__file__).parent/'technical-share-qa'
pdf=root/'share.pdf'
reader=PdfReader(str(pdf))
pages=pdfium.PdfDocument(str(pdf))
thumbs=[]
for i,page in enumerate(pages):
    im=page.render(scale=1.5).to_pil().convert('RGB')
    im.save(root/f'page-{i+1}.png')
    thumb=ImageOps.contain(im,(400,570))
    tile=Image.new('RGB',(420,610),'#dddddd'); tile.paste(thumb,((420-thumb.width)//2,20))
    ImageDraw.Draw(tile).text((15,590),str(i+1),fill='black')
    thumbs.append(tile)
    text=reader.pages[i].extract_text()
    print(i+1,len(text),text[:45].replace('\n',' '))
for start in range(0,len(thumbs),4):
    chosen=thumbs[start:start+4]
    sheet=Image.new('RGB',(840,1220),'white')
    for j,tile in enumerate(chosen): sheet.paste(tile,((j%2)*420,(j//2)*610))
    sheet.save(root/f'contact-{start//4+1}.png')
print('pages',len(pages))
