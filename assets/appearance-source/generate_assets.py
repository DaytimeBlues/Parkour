"""Original Skybound faceted character + cosmetic wing authoring. Blender 4.3.2.
Invocation: blender -b -noaudio --python generate_assets.py -- OUTPUT_DIR
All dimensions metres. Authored in converted runtime coordinates: +Y up, -Z forward.
No downloaded assets, textures, addons or collision geometry. Seedless deterministic geometry.
"""
import bpy, math, sys, os, json
from mathutils import Vector
OUT=os.path.abspath(sys.argv[sys.argv.index('--')+1]); os.makedirs(OUT,exist_ok=True)
def cv(p):return (p[0],-p[2],p[1])
def reset():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for coll in [bpy.data.materials,bpy.data.actions,bpy.data.meshes]:
  for d in list(coll):
   if d.users==0:coll.remove(d)
 bpy.context.scene.render.fps=60

def empty(name,parent=None):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;return o

def mat(name,color,emission=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;m.use_backface_culling=False
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=.72
 bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=emission
 return m

def ell(name,p,s,m,parent,sub=1):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=cv(p));o=bpy.context.object;o.name=name;o.scale=(s[0],s[2],s[1]);o.data.materials.append(m);o.parent=parent;return o

def panel(name,pts,m,parent,depth=.024):
 # Points in runtime local XY plane; original solid bevel-like faceted plate.
 verts=[cv((x,y,z)) for z in [-depth/2,depth/2] for x,y in pts];n=len(pts)
 faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.materials.append(m);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.parent=parent;return o

def rod(name,a,b,r,m,parent):
 aa=Vector(cv(a));bb=Vector(cv(b));d=bb-aa
 bpy.ops.mesh.primitive_cone_add(vertices=6,radius1=r,radius2=r*.65,depth=d.length,location=(aa+bb)/2)
 o=bpy.context.object;o.name=name;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(m);o.parent=parent;return o

def merge(parent):
 # Join rigid geometry by material, retaining authored hinge/leg hierarchy.
 children=[o for o in parent.children if o.type=='MESH'];groups={}
 for o in children:groups.setdefault(o.data.materials[0].name,[]).append(o)
 for name,objs in groups.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in objs:o.select_set(True)
  bpy.context.view_layer.objects.active=objs[0];bpy.ops.object.join();o=bpy.context.object;o.name=parent.name+'_'+name
  bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)

def clips(obj,spec,axis=2):
 obj.animation_data_create()
 for name,values in spec.items():
  action=bpy.data.actions.new(obj.name+'_'+name);obj.animation_data.action=action
  for f,z in values:
   angles=[0,0,0];angles[axis]=z;obj.rotation_euler=angles;obj.keyframe_insert(data_path='rotation_euler',frame=f,group='Hinge')
  for fc in action.fcurves:
   for k in fc.keyframe_points:k.interpolation='LINEAR'
  tr=obj.animation_data.nla_tracks.new();tr.name=name;st=tr.strips.new(name,1,action);st.name=name
 obj.animation_data.action=None;obj.rotation_euler=(0,0,0)

def save(name):
 bpy.context.scene.frame_set(21)
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,name+'.blend'))
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,name+'.glb'),export_format='GLB',export_yup=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_force_sampling=True,export_optimize_animation_keep_anim_object=True,export_cameras=False,export_lights=False,export_materials='EXPORT',export_extras=True)

def wings(style):
 reset();root=empty('Wings');root['style']=style;root['cosmetic_only']=True
 colors={'angel':((1,.93,.72),(.91,.59,.18)),'devil':((.48,.025,.11),(.13,.06,.16)),'parakeet':((.08,.62,.35),(.94,.7,.09)),'elephant':((.46,.43,.64),(.9,.4,.56)),'glow':((.1,.9,.85),(.64,.3,1)),'dragon':((.055,.38,.28),(.69,.39,.13))}
 main=mat('Wing_'+style,colors[style][0],1.2 if style=='glow' else 0);trim=mat('Accent_'+style,colors[style][1],.9 if style=='glow' else 0)
 rainbow=[mat('Feather_'+str(i),c) for i,c in enumerate([(.88,.07,.2),(.95,.3,.04),(.95,.75,.06),(.15,.7,.3),(.05,.52,.9),(.5,.15,.83)])] if style=='parakeet' else []
 for side,label in [(-1,'Left'),(1,'Right')]:
  h=empty('Wing'+label,root);h.location=cv((side*.12,0,0))
  def P(name,pts,m=main,d=.025,zoff=0):
   o=panel(label+'_'+name,[(side*min(x,1.9),min(y,1.28)) for x,y in pts],m,h,d);o.location=cv((0,0,zoff));return o
  def R(name,a,b,r=.025,m=trim):return rod(label+'_'+name,(side*a[0],a[1],a[2]),(side*b[0],b[1],b[2]),r,m,h)
  if style in ['angel','parakeet']:
   # Six layered, individually pointed flight feathers; shorter overlapping coverts.
   for i in range(6):
    x=.37+i*.205;y=.52+i*.055
    P('primary'+str(i),[(.05,.1),(x-.1,y+.24),(x+.26,y+.34),(min(1.9,x+.49),y-.08),(x+.3,y-.29),(x+.08,y-.16)],rainbow[i] if rainbow else main,.035,i*.045)
   P('scapular',[(0,.03),(.02,.55),(.48,1.06),(.95,1.04),(1.3,.8),(.72,.55)],trim,.025,-.06)
   for i in range(4):
    x=.16+i*.23;P('covert'+str(i),[(x,.47),(x+.15,.86),(x+.43,.91),(x+.35,.58)],main,.026,-.10-i*.035)
  elif style=='elephant':
   P('floppy_outline',[(0,.12),(.12,.67),(.51,.97),(1.05,1.07),(1.45,.86),(1.55,.42),(1.27,-.13),(.88,-.15),(.5,.02)],main,.06)
   P('soft_inner',[(.22,.22),(.36,.67),(.73,.87),(1.14,.82),(1.31,.48),(1.1,.06),(.83,.04)],trim,.075)
   R('ear_ridge',(.12,.15,.05),(.48,.66,.05),.035)
  elif style=='glow':
   for i in range(4):
    x=.36+i*.35;y=.35+i*.11
    P('luminous_blade'+str(i),[(.02,.08),(x,y+.5),(x+.19,y+.64),(min(1.92,x+.46),y+.07),(x+.24,y-.21)],main if i%2==0 else trim,.035)
   P('heart',[(0,.05),(.12,.65),(.46,.91),(.66,.7),(.34,.25)],trim,.08)
   for i in range(3):ell(label+'_light_seed'+str(i),(side*(.38+i*.48),.65+i*.12,.08),(.045,.045,.045),main,h)
  else:
   dragon=style=='dragon';tips=[(.6,1.22),(1.3,1.1),(1.87,.67)] if dragon else [(.44,1.17),(1.15,1.05),(1.77,.48)]
   P('membrane',[(0,.02),(.05,.67),*tips,(1.48,.08),(1.18,.32),(.95,-.1),(.68,.13),(.37,-.13)],main,.035)
   for i,(x,y) in enumerate(tips):
    R('finger'+str(i),(.04,.18,-.045),(x,y,-.045),.028)
    P('tip'+str(i),[(x-.055,y-.055),(x,y+.07),(x+.07,y-.04)],trim,.06)
   R('leading_edge',(.02,.03,-.04),(.08,.68,-.04),.05)
   if dragon:
    for i in range(3):P('spine'+str(i),[(.13+i*.19,.69+i*.16),(.12+i*.19,.96+i*.11),(.31+i*.19,.82+i*.12)],trim,.055)
  merge(h)
  folded=-side*1.32
  clips(h,{'WingOpen':[(1,folded),(21,0)],'WingGlide':[(1,0),(31,side*.045),(61,0)],'WingFold':[(1,0),(21,folded)]})
 save('wings-'+style)

def avatar(kind):
 reset();root=empty('Avatar');root['species']=kind;body=empty('Body',root)
 fur=mat('Fur',(.88,.21,.1) if kind=='fox' else (.66,.72,.81));cream=mat('Cream',(.98,.91,.76));dark=mat('Ink',(.027,.05,.085));pink=mat('InnerEar',(.91,.36,.43));eye=mat('EyeHighlight',(1,1,1))
 ell('Torso',(0,.66,.05),(.29,.31,.49),fur,body,2);ell('Chest',(0,.73,-.25),(.25,.28,.18),cream,body,2)
 ell('Head',(0,1.03,-.38),(.29,.27,.29),fur,body,2)
 for side in [-1,1]:
  ell('Cheek',(side*.15,.94,-.56),(.16,.13,.18),cream,body,1)
  ell('Eye',(side*.205,1.1,-.59),(.053,.064,.034),dark,body,2);ell('EyeGlint',(side*.195,1.12,-.619),(.017,.021,.009),eye,body,1)
  if kind=='fox':
   o=panel('PointedEar',[(side*.06,1.2),(side*.34,1.2),(side*.24,1.59)],fur,body,.17);o.location=cv((0,0,-.31))
   o=panel('InnerEar',[(side*.13,1.28),(side*.29,1.28),(side*.235,1.51)],pink,body,.02);o.location=cv((0,0,-.405))
  else:
   ell('LongEar',(side*.17,1.58,-.34),(.105,.49,.1),fur,body,2);ell('InnerEar',(side*.17,1.62,-.431),(.053,.32,.018),pink,body,2)
 ell('Muzzle',(0,.94,-.68),(.15,.11,.18 if kind=='fox' else .08),cream,body,1);ell('Nose',(0,.97,-.84 if kind=='fox' else -.75),(.065,.05,.045),dark,body,1)
 for side in [-1,1]:
  for end in [-1,1]:
   leg=empty(('Front' if end<0 else 'Back')+('Left' if side<0 else 'Right'),body)
   leg.location=cv((side*.19,.5,end*.28))
   ell('Leg',(0,-.2,0),(.085,.23,.105),fur,leg,1);ell('Boot',(0,-.41,-.035),(.095,.09,.15),dark,leg,1);merge(leg)
   sign=1 if side==end else -1
   clips(leg,{'AvatarIdle':[(1,0),(61,0)],'AvatarRun':[(1,sign*.5),(16,-sign*.5),(31,sign*.5)],'AvatarGlide':[(1,.4),(61,.4)]},0)
 tail=empty('Tail',body)
 if kind=='fox':
  rod('TailBase',(0,.66,.4),(0,.92,.96),.19,fur,tail);rod('TailCream',(0,.92,.96),(0,1.04,1.22),.14,cream,tail)
 else:ell('CottonTail',(0,.68,.59),(.16,.16,.16),cream,tail,2)
 merge(tail);merge(body)
 socket=empty('WingSocket',root);socket.location=cv((0,.85,.35))
 save('avatar-'+kind)

if __name__=='__main__':
 requested=sys.argv[sys.argv.index('--')+2:]
 for name in requested or ['angel','devil','parakeet','elephant','glow','dragon','fox','rabbit']:
  avatar(name) if name in ['fox','rabbit'] else wings(name)
