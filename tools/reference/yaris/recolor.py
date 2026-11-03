from pathlib import Path
from io import BytesIO
import json,struct
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[3]
b=(Path(__file__).parent/'approved.glb').read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);start=28+n
body=next(m for m in g['materials'] if m['name']=='Body');image=g['images'][g['textures'][body['pbrMetallicRoughness']['baseColorTexture']['index']]['source']];view=g['bufferViews'][image['bufferView']];off=start+view.get('byteOffset',0)
a=np.array(Image.open(BytesIO(b[off:off+view['byteLength']])).convert('RGB'));y,x=np.indices(a.shape[:2]);portraits=((x%512>=158)&(x%512<=356)&(y>=586)&(y<=718));region=~((x<512)&(y<512))&~portraits
colours=[(235,72,150),(46,205,224),(109,78,185)]
variants={2:[(48,120,198),(242,201,76),(35,63,121)],3:[(30,52,93),(225,232,239),(67,93,142)],4:[(117,165,66),(65,80,48),(164,190,101)],5:[(242,194,58),(50,58,68),(184,126,33)]}
for v,palette in variants.items():
 out=a.copy();distance=np.stack([np.linalg.norm(a.astype(float)-c,axis=2) for c in colours]);nearest=distance.argmin(axis=0);mask=distance.min(axis=0)<45
 for i,col in enumerate(palette):out[region&mask&(nearest==i)]=col
 Image.fromarray(out).save(root/f'web/models/yaris/wrap-{v}.jpg',quality=87,optimize=True,subsampling=0)
