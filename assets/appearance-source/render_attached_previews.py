"""Reproducible standalone Blender attachment contact-sheet views, not browser QA."""
import bpy,sys,os
from mathutils import Vector
ROOT=os.path.abspath(sys.argv[sys.argv.index('--')+1]);OUT=os.path.join(ROOT,'attached-previews');os.makedirs(OUT,exist_ok=True)
def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
for kind in ['fox','rabbit']:
 for style in ['angel','devil','parakeet','elephant','glow','dragon']:
  for pose,frame in [('open',21),('folded',1)]:
   bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'avatar-'+kind+'.blend'))
   with bpy.data.libraries.load(os.path.join(ROOT,'wings-'+style+'.blend'),link=False) as (src,dst):dst.objects=list(src.objects)
   for obj in dst.objects:
    if obj: bpy.context.collection.objects.link(obj)
   root=bpy.data.objects.get('Wings');root.parent=bpy.data.objects.get('WingSocket');root.location=(0,0,0)
   for obj in bpy.data.objects:
    if obj.animation_data:
     for track in obj.animation_data.nla_tracks:track.mute=track.name not in ['AvatarIdle','WingOpen']
   scene=bpy.context.scene;scene.frame_set(frame);scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=False
   scene.render.resolution_x=600;scene.render.resolution_y=500;scene.render.resolution_percentage=100
   scene.world.color=(.13,.16,.22)
   bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=4.9
   target=(0,0,1.2);cam.location=(2.7,6,2.9);aim(cam,target)
   for pos,power,size in [((2,4,6),550,5),((-4,1,3),350,4),((1,-4,4),450,3)]:
    bpy.ops.object.light_add(type='AREA',location=pos);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;aim(light,target)
   scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=os.path.join(OUT,kind+'-'+style+'-'+pose+'.png');bpy.ops.render.render(write_still=True)
