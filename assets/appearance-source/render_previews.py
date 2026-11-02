import bpy,sys,os,math
from mathutils import Vector
ROOT=os.path.abspath(sys.argv[sys.argv.index('--')+1]);OUT=os.path.join(ROOT,'previews');os.makedirs(OUT,exist_ok=True)
def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
for name in ['wings-angel','wings-devil','wings-parakeet','wings-elephant','wings-glow','wings-dragon','avatar-fox','avatar-rabbit']:
 for pose in ['open-front','half-quarter','fold-back'] if name.startswith('wings') else ['front','rear']:
  bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,name+'.blend'))
  for o in bpy.data.objects:
   if o.animation_data:
    for t in o.animation_data.nla_tracks:t.mute=t.name!=("WingOpen" if name.startswith("wings") else "AvatarIdle")
  bpy.context.scene.frame_set(21 if pose=='open-front' else 11 if pose=='half-quarter' else 1)
  scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=False
  scene.render.resolution_x=480;scene.render.resolution_y=400;scene.render.resolution_percentage=100
  scene.world.color=(.16,.18,.23)
  bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=4.55 if name.startswith('wings') else 2.8
  target=(0,0,.6) if name.startswith('wings') else (0,0,.95)
  if pose=='open-front':cam.location=(0,6,.9)
  elif pose in ['fold-back','rear']:cam.location=(3,-5,2.6)
  else:cam.location=(3,5,2.6)
  aim(cam,target)
  for pos,power,size in [((2,4,6),550,5),((-4,1,3),350,4),((1,-4,4),450,3)]:
   bpy.ops.object.light_add(type='AREA',location=pos);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size;aim(l,target)
  scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=os.path.join(OUT,name+'-'+pose+'.png');bpy.ops.render.render(write_still=True)
