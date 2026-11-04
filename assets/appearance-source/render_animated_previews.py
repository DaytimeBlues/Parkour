"""Native-source studio QA. Real authored animation poses, not tweened stills.
blender -b -noaudio --python ... -- SOURCE_DIR OUTPUT_DIR [MODE]
MODE=avatars (default), wings, compare, attachments, rabbit-bound. No scene written to sources.
"""
import bpy,sys,os,math
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:];ROOT=os.path.abspath(args[0]);OUT=os.path.abspath(args[1]);MODE=args[2] if len(args)>2 else 'avatars';os.makedirs(OUT,exist_ok=True)
def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
def studio(wing=False,view='quarter'):
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=False;scene.render.threads_mode='FIXED';scene.render.threads=16
 scene.render.resolution_x=640;scene.render.resolution_y=500;scene.render.resolution_percentage=100;scene.world.color=(.075,.095,.13)
 target=(0,0,1.0) if not wing else (0,0,.62)
 bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=3.05 if not wing else 4.55
 camera.location={'quarter':(3.4,6,2.7),'front':(0,6,1.9),'side':(6,.2,2.1),'rear':(-3,-5,2.6)}[view];aim(camera,target)
 for pos,power,size in [((2,4,6),500,5),((-4,2,3),270,4),((1,-4,4),420,3)]:
  bpy.ops.object.light_add(type='AREA',location=pos);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;aim(light,target)
 if not wing:
  bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.002));floor=bpy.context.object;m=bpy.data.materials.new('QA_Floor');m.diffuse_color=(.105,.135,.16,1);m.use_nodes=True;m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.105,.135,.16,1);m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.9;floor.data.materials.append(m)
 scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';return scene

def pose(clip,frame):
 for o in bpy.data.objects:
  if o.animation_data:
   for track in o.animation_data.nla_tracks:track.mute=track.name!=clip
 bpy.context.scene.frame_set(frame)
def render(scene,name):scene.render.filepath=os.path.join(OUT,name+'.png');bpy.ops.render.render(write_still=True)
if MODE in ['avatars','compare','rabbit-bound']:
 for kind in (['rabbit'] if MODE=='rabbit-bound' else ['fox','rabbit']):
  name='avatar-'+kind
  for view in ['quarter','front','side','rear']:
   bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,name+'.blend'));pose('AvatarIdle',0);scene=studio(view=view);render(scene,name+'-'+view)
  if MODE=='compare':continue
  for clip,duration in ([('AvatarRun',42)] if MODE=='rabbit-bound' else [('AvatarIdle',120),('AvatarRun',42),('AvatarGlide',96),('AvatarJump',24),('AvatarLand',15)]):
   bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,name+'.blend'));scene=studio()
   for i in range(6):pose(clip,round(duration*i/5));render(scene,name+'-'+clip+'-'+str(i))
  for clip,duration in ([('AvatarRun',42)] if MODE=='rabbit-bound' else [('AvatarRun',42),('AvatarGlide',96)]):
   bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,name+'.blend'));scene=studio();scene.render.resolution_x=480;scene.render.resolution_y=375;scene.cycles.samples=12
   for i in range(24):pose(clip,round(duration*i/24));render(scene,name+'-'+clip+'-motion-'+str(i).zfill(2))
if MODE=='wings':
 for style in ['angel','parakeet','devil','dragon','elephant','glow']:
  name='wings-'+style;bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,name+'.blend'));scene=studio(wing=True,view='front')
  for i in range(6):pose('WingGlide',round(96*i/5));render(scene,name+'-WingGlide-'+str(i))
if MODE=='attachments':
 for kind in ['fox','rabbit']:
  for style in ['angel','parakeet','devil','dragon','elephant','glow']:
   bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'avatar-'+kind+'.blend'))
   with bpy.data.libraries.load(os.path.join(ROOT,'wings-'+style+'.blend'),link=False) as (src,dst):dst.objects=list(src.objects)
   for o in dst.objects:
    if o:bpy.context.collection.objects.link(o)
   wings=bpy.data.objects['Wings'];wings.parent=bpy.data.objects['WingSocket'];wings.location=(0,0,0)
   for o in bpy.data.objects:
    if o.animation_data:
     for tr in o.animation_data.nla_tracks:tr.mute=tr.name not in ['AvatarGlide','WingGlide']
   scene=bpy.context.scene;scene.frame_set(24);scene=studio(wing=True);scene.camera.data.ortho_scale=5.0;aim(scene.camera,(0,0,1.15));render(scene,kind+'-'+style+'-gliding')
