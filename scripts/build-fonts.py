"""Reproducible metric/outline adaptations; NOT an original typeface."""
from fontTools.ttLib import TTFont
from pathlib import Path
import sys
source=Path(sys.argv[1]); out=Path(__file__).resolve().parents[1]/'public/fonts'
out.mkdir(parents=True,exist_ok=True)
for name,sx,tracking in [('PaperRealm QingKai',.98,12),('PaperRealm QingKai Elegant',.96,36)]:
    f=TTFont(source)
    for glyphname in f.getGlyphOrder():
        g=f['glyf'][glyphname]
        if not g.isComposite() and g.numberOfContours>0:
            coords=g.coordinates
            for i,(x,y) in enumerate(coords): coords[i]=(round(x*sx+tracking/2),y)
        width,lsb=f['hmtx'][glyphname]; f['hmtx'][glyphname]=(round(width*sx+tracking),round(lsb*sx+tracking/2))
    for nid,value in [(1,name),(2,'Regular'),(3,name+' 1.0'),(4,name),(6,name.replace(' ','')),(16,name),(17,'Regular')]:
        f['name'].removeNames(nameID=nid)
        f['name'].setName(value,nid,3,1,0x409)
    f['name'].setName('Metric and simple-outline adaptation of LXGW WenKai; not an original glyph design. OFL 1.1.',10,3,1,0x409)
    f.flavor='woff2'; f.save(out/(name.replace(' ','')+'.woff2'))
    print(name,len(f.getBestCmap()),'Unicode codepoints')
