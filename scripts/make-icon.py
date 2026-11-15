from PIL import Image,ImageDraw
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'src-tauri/icons';p.mkdir(exist_ok=True)
im=Image.new('RGBA',(256,256),(0,0,0,0));d=ImageDraw.Draw(im)
d.rounded_rectangle((8,8,248,248),radius=50,fill='#354b3b')
d.rounded_rectangle((26,26,230,230),radius=33,outline='#cdbb87',width=3)
d.polygon([(59,64),(119,77),(119,188),(59,170)],fill='#ded5af')
d.polygon([(137,77),(197,64),(197,170),(137,188)],fill='#c6b986')
d.line([(128,73),(128,195)],fill='#efdfac',width=4)
im.save(p/'icon.png');im.save(p/'icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
