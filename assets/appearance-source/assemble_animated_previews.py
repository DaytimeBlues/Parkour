"""Assemble labelled real-render evidence; never synthesizes a pose or image."""
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/appearance-source/v4-previews';OUT.mkdir(exist_ok=True)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
def cell(path,label,size=(320,250)):
 im=Image.open(path).convert('RGB').resize(size,Image.Resampling.LANCZOS);c=Image.new('RGB',(size[0],size[1]+28),'#172431');c.paste(im,(0,28));ImageDraw.Draw(c).text((8,6),label,font=font,fill='#edf2f3');return c
def sheet(name,items,cols,size=(320,250)):
 cells=[cell(p,label,size)for p,label in items];canvas=Image.new('RGB',(cols*cells[0].width,((len(cells)+cols-1)//cols)*cells[0].height),'#172431')
 for i,c in enumerate(cells):canvas.paste(c,((i%cols)*c.width,(i//cols)*c.height))
 canvas.save(OUT/name)
sheet('avatars-contact-sheet.png',[(ROOT/f'final-previews/avatar-{k}-{v}.png',f'{k} / v4 / {v}')for k in ['fox','rabbit']for v in ['quarter','front','side','rear']],4)
sheet('before-after-contact-sheet.png',[(ROOT/f'{p}/avatar-{k}-{v}.png',f'{k} / {label} / {v}')for k in ['fox','rabbit']for v in ['quarter','side']for p,label in [('baseline-previews','v3 before'),('final-previews','v4 candidate')]],4)
for kind in ['fox','rabbit']:
 sheet(kind+'-animation-strips.png',[(ROOT/f'final-previews/avatar-{kind}-{clip}-{i}.png',f'{clip.removeprefix("Avatar")} / {i*20}%')for clip in ['AvatarIdle','AvatarRun','AvatarGlide','AvatarJump','AvatarLand']for i in range(6)],6,(256,200))
sheet('wings-contact-sheet.png',[(ROOT/f'wing-motion-previews/wings-{s}-WingGlide-{i}.png',f'{s} / glide / {i*20}%')for s in ['angel','parakeet','devil','dragon','elephant','glow']for i in [0,1,3]],3)
sheet('attached-contact-sheet.png',[(ROOT/f'attached-final-previews/{k}-{s}-gliding.png',f'{k} + {s} / actual glide')for k in ['fox','rabbit']for s in ['angel','parakeet','devil','dragon','elephant','glow']],4)
for clip,millis in [('AvatarRun',29),('AvatarGlide',67)]:
 frames=[]
 for i in range(24):
  cells=[cell(ROOT/f'final-previews/avatar-{k}-{clip}-motion-{i:02}.png',f'{k} / {clip.removeprefix("Avatar")} / original v4',(480,375))for k in ['fox','rabbit']];canvas=Image.new('RGB',(960,403),'#172431')
  for x,c in enumerate(cells):canvas.paste(c,(x*480,0))
  frames.append(canvas)
 small=[f.resize((640,269),Image.Resampling.LANCZOS)for f in frames]
 palette=small[0].quantize(colors=96,method=Image.Quantize.MEDIANCUT)
 small=[f.quantize(palette=palette,dither=Image.Dither.NONE)for f in small]
 small[0].save(OUT/(clip.removeprefix('Avatar').lower()+'-motion.gif'),save_all=True,append_images=small[1:],duration=[round((i+1)*(700 if clip=='AvatarRun' else 1600)/24/10)*10-round(i*(700 if clip=='AvatarRun' else 1600)/24/10)*10 for i in range(24)],loop=0,optimize=True)
