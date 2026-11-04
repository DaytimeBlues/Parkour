"""Skybound woodland runners / cosmetic wings, original revised Blender source.
Blender 4.3.2. No third-party geometry, images, textures or add-ons.
Runtime units metres, +Y up, -Z forward; cv converts to Blender +Z up.
Invocation: blender -b -noaudio --python assets/appearance-source/generate_animated_assets.py -- OUTPUT [ids...]
Seedless deterministic geometry. Preserve original baseline as fallback.
"""
import bpy, math, sys, os
from mathutils import Vector
OUT=os.path.abspath(sys.argv[sys.argv.index('--')+1]);os.makedirs(OUT,exist_ok=True)
TAU=math.pi*2

def cv(p):return (p[0],-p[2],p[1])
def reset():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for collection in [bpy.data.meshes,bpy.data.curves,bpy.data.materials,bpy.data.actions]:
  for d in list(collection):
   if d.users==0:collection.remove(d)
 bpy.context.scene.render.fps=60

def empty(name,parent=None,p=(0,0,0)):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;o.location=cv(p);return o

def mat(name,color,rough=.72,emission=0,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;m.use_backface_culling=True
 b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metal
 b.inputs['Emission Color'].default_value=(*color,1);b.inputs['Emission Strength'].default_value=emission
 return m

def mesh(name,verts,faces,material,parent,smooth=False):
 me=bpy.data.meshes.new(name);me.from_pydata([cv(v) for v in verts],[],faces);me.materials.append(material);me.update()
 o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.parent=parent
 # Mesh operators recalculate consistent outside normals, including reflected left wings.
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False)
 for f in me.polygons:f.use_smooth=smooth
 return o

def ell(name,p,s,m,parent,segments=12,rings=7,smooth=True):
 # Explicit closed latitude mesh, no coincident pole rings.
 verts=[(p[0],p[1]+s[1],p[2])]
 for j in range(1,rings):
  a=math.pi*j/rings
  for i in range(segments):
   b=TAU*i/segments;verts.append((p[0]+s[0]*math.sin(a)*math.cos(b),p[1]+s[1]*math.cos(a),p[2]+s[2]*math.sin(a)*math.sin(b)))
 verts.append((p[0],p[1]-s[1],p[2]));faces=[]
 for i in range(segments):faces.append((0,1+i,1+(i+1)%segments))
 for j in range(rings-2):
  for i in range(segments):
   a=1+j*segments+i;b=1+j*segments+(i+1)%segments;faces.append((a,a+segments,b+segments,b))
 last=len(verts)-1;start=last-segments
 for i in range(segments):faces.append((last,start+(i+1)%segments,start+i))
 return mesh(name,verts,faces,m,parent,smooth)

def loft(name,centers,widths,depths,m,parent,segments=8,smooth=True):
 # Elliptic closed tube along an original spatial curve, with caps at both ends.
 verts=[]
 for j,p in enumerate(centers):
  tangent=Vector(centers[min(j+1,len(centers)-1)])-Vector(centers[max(0,j-1)])
  tangent.normalize();a=Vector((1,0,0))
  if abs(tangent.dot(a))>.96:a=Vector((0,0,1))
  a=(a-tangent*a.dot(tangent)).normalized();b=tangent.cross(a).normalized()
  for i in range(segments):
   v=Vector(p)+a*(math.cos(TAU*i/segments)*widths[j])+b*(math.sin(TAU*i/segments)*depths[j]);verts.append(tuple(v))
 faces=[tuple(range(segments-1,-1,-1))]
 for j in range(len(centers)-1):
  for i in range(segments):faces.append((j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i))
 faces.append(tuple(range((len(centers)-1)*segments,len(centers)*segments)))
 return mesh(name,verts,faces,m,parent,smooth)

def rod(name,a,b,r,m,parent,segments=7):
 return loft(name,[a,tuple((a[i]*.45+b[i]*.55) for i in range(3)),b],[r,r*.85,r*.45],[r,r*.85,r*.45],m,parent,segments)

def solid_panel(name,points,m,parent,thickness=.025,smooth=False):
 # Nonconvex surfaces triangulated by Blender, not an invalid convex triangle fan.
 v=[(x,y,z+side*thickness/2) for side in [-1,1] for x,y,z in points];n=len(points)
 faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 o=mesh(name,v,faces,m,parent,smooth);bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.quads_convert_to_tris(quad_method='BEAUTY',ngon_method='BEAUTY');bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False);return o

def join_by_material(parent):
 groups={}
 for o in list(parent.children):
  if o.type=='MESH':groups.setdefault(o.data.materials[0].name,[]).append(o)
 for m,objects in groups.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=parent.name+'_'+m
  bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 bpy.ops.object.select_all(action='DESELECT')

def clips(obj,spec,axis=2):
 obj.animation_data_create()
 for name,values in spec.items():
  action=bpy.data.actions.new(obj.name+'_'+name);obj.animation_data.action=action
  for frame,angle in values:
   v=[0,0,0];v[axis]=angle;obj.rotation_euler=v;obj.keyframe_insert(data_path='rotation_euler',frame=frame,group='Authored rigid joint')
  for fc in action.fcurves:
   for k in fc.keyframe_points:k.interpolation='LINEAR'
  tr=obj.animation_data.nla_tracks.new();tr.name=name;st=tr.strips.new(name,0,action);st.name=name
 obj.animation_data.action=None;obj.rotation_euler=(0,0,0)

def save(name):
 scene=bpy.context.scene;scene.frame_set(1)
 # In Blender and in GLTF, pose is selected explicitly, never the sum of three NLA strips.
 for o in bpy.data.objects:
  if o.animation_data:
   for t in o.animation_data.nla_tracks:t.mute=False
 scene['authoring_revision']='woodland-v4-animated-20261104';scene['cosmetic_only']=True
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,name+'.glb'),export_format='GLB',export_yup=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_force_sampling=True,export_optimize_animation_keep_anim_object=True,export_cameras=False,export_lights=False,export_materials='EXPORT',export_extras=True)
 # Save an editable source that opens in an intentional display pose. Export above
 # always restores all NLA tracks, so stored preview mutes cannot drop GLB clips.
 preferred='WingOpen' if name.startswith('wings-') else 'AvatarIdle'
 for obj in bpy.data.objects:
  if obj.animation_data:
   for track in obj.animation_data.nla_tracks:track.mute=track.name!=preferred
 scene.frame_set(20 if name.startswith('wings-') else 1)
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,name+'.blend'))


# v4 uses one lit, opaque palette material per articulated animal part. Source
# material colours are converted directly to linear glTF vertex colours.
def palette_join(parent,shared):
 objects=[o for o in parent.children if o.type=='MESH']
 if not objects:return
 for o in objects:
  ca=o.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
  for poly in o.data.polygons:
   c=o.data.materials[poly.material_index].diffuse_color
   for i in poly.loop_indices:ca.data[i].color=c
  o.data.materials.clear();o.data.materials.append(shared)
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();bpy.context.object.name=parent.name+'_Surface'
 for attr in list(bpy.context.object.data.color_attributes):
  if attr.name!='Color':bpy.context.object.data.color_attributes.remove(attr)
 bpy.ops.object.select_all(action='DESELECT')

def key_motion(obj,clip,frames):
 obj.animation_data_create();action=bpy.data.actions.new(obj.name+'_'+clip);obj.animation_data.action=action
 for frame,location,rotation in frames:
  obj.location=cv(location);obj.rotation_euler=rotation
  obj.keyframe_insert(data_path='location',frame=frame);obj.keyframe_insert(data_path='rotation_euler',frame=frame)
 for fc in action.fcurves:
  for k in fc.keyframe_points:k.interpolation='LINEAR'
 track=obj.animation_data.nla_tracks.new();track.name=clip;track.strips.new(clip,0,action)
 obj.animation_data.action=None

def sculpt_colour(parent,material,voxel,triangles):
 objects=[o for o in parent.children if o.type=='MESH' and len(o.data.materials)==1 and o.data.materials[0]==material]
 if len(objects)<2:return
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=parent.name+'_Sculpt'
 # Voxel union removes intersecting shell seams. Smooth and decimate are applied
 # in authoring, not shipped as runtime modifiers or hidden duplicate meshes.
 o.data.remesh_voxel_size=voxel;bpy.ops.object.voxel_remesh()
 modifier=o.modifiers.new('SculptRelax','SMOOTH');modifier.factor=.65;modifier.iterations=3;bpy.ops.object.modifier_apply(modifier=modifier.name)
 count=sum(len(poly.vertices)-2 for poly in o.data.polygons)
 modifier=o.modifiers.new('SculptBudget','DECIMATE');modifier.ratio=min(1,triangles/max(1,count));bpy.ops.object.modifier_apply(modifier=modifier.name)
 for poly in o.data.polygons:poly.use_smooth=True
 bpy.ops.object.select_all(action='DESELECT')

def avatar(kind):
 reset();fox=kind=='fox';root=empty('Avatar');root['species']=kind;root['revision']='woodland-v4';root['refinement']='woodland-v4-animated';root['cosmetic_only']=True
 body=empty('Body',root);head=empty('Head',body,(0,.97,-.33));ears=[]
 # Warm, desaturated woodland palette with restrained accent colours.
 fur=mat('Fur',(.67,.205,.064) if fox else (.39,.47,.50));cream=mat('Cream',(.94,.79,.56) if fox else (.89,.87,.77));shade=mat('FurShade',(.33,.072,.021) if fox else (.23,.31,.34));ink=mat('Ink',(.018,.024,.028));rose=mat('InnerEar',(.57,.24,.17) if fox else (.66,.30,.31));iris=mat('Iris',(.49,.26,.052) if fox else (.12,.25,.28));shine=mat('Catchlight',(.99,.98,.90));palette=mat('WoodlandPalette',(1,1,1),.73)
 node=palette.node_tree.nodes.new('ShaderNodeVertexColor');node.layer_name='Color'
 palette.node_tree.links.new(node.outputs['Color'],palette.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 # One continuous tapered trunk provides a deliberate low, athletic silhouette.
 loft('Torso',[(0,.65,.48),(0,.68,.34),(0,.70,.06),(0,.74,-.20),(0,.80,-.36)],[.09,.25 if fox else .32,.285 if fox else .34,.245,.14],[.13,.255 if fox else .30,.28,.28,.20],fur,body,14)
 ell('Shoulder',(0,.79,-.25),(.23,.25,.23),fur,body,12,7)
 loft('Neck',[(0,.79,-.30),(0,.93,-.35),(0,1.03,-.36)],[.19,.195,.17],[.19,.19,.16],fur,body,12)
 # The underside bib is a wrapped volumetric form rather than a floating flat decal.
 ell('ChestBib',(0,.785,-.375),(.174,.21,.10),cream,body,12,6)
 if not fox:
  for side in [-1,1]:ell('PowerHaunch',(side*.205,.58,.28),(.205,.25,.23),fur,body,12,6)
 # Compact wedge head, narrower lower jaw and forehead. It lives on its own pivot.
 ell('Cranium',(0,.135,-.065),(.29 if fox else .302,.258,.248),fur,head,14,8)
 ell('Jaw',(0,.012,-.16),(.19,.12,.18),cream,head,12,6)
 if fox:
  loft('Muzzle',[(0,.04,-.19),(0,.015,-.33),(0,.025,-.455)],[.151,.105,.048],[.090,.071,.032],cream,head,12)
  ell('Nose',(0,.045,-.468),(.053,.030,.026),ink,head,10,5)
  for side in [-1,1]:
   # Broad triangular cheek sweep joins the white muzzle at its rear corners.
   ell('Cheek',(side*.133,.022,-.205),(.134,.087,.125),cream,head,12,6)
   loft('CheekSweep',[(side*.17,.030,-.17),(side*.26,.035,-.10),(side*.307,.07,-.045)],[.066,.046,.003],[.062,.033,.003],cream,head,8)
 else:
  for side in [-1,1]:ell('Muzzle',(side*.065,.018,-.278),(.102,.072,.070),cream,head,12,6)
  solid_panel('Nose',[(-.032,.075,-.348),(.032,.075,-.348),(0,.042,-.362)],rose,head,.018,True)
  rod('Philtrum',(0,.045,-.36),(0,.010,-.356),.006,ink,head,5)
 for side in [-1,1]:
  # Eyes sit inside the forehead plane, smaller and less stalk-like than v3.
  ell('EyeMask',(side*.152,.180,-.256),(.067,.079,.016),shade,head,12,6)
  ell('Eye',(side*.151,.183,-.269),(.050,.061,.009),iris,head,12,6)
  ell('Pupil',(side*.148,.187,-.277),(.035,.050,.005),ink,head,10,5)
  ell('Glint',(side*.137,.208,-.282),(.016,.021,.003),shine,head,8,4)
  loft('Brow',[(side*.094,.247,-.217),(side*.151,.266,-.224),(side*.211,.245,-.203)],[.017,.021,.010],[.014,.015,.009],cream if fox else fur,head,6)
  rod('Smile',(side*.008,-.008,-.406 if fox else -.343),(side*.075,-.015,-.339 if fox else -.319),.006,ink,head,5)
  ear=empty('Ear'+('Left' if side<0 else 'Right'),head,(side*.168,.290,.005));ears.append(ear)
  if fox:
   loft('Ear',[(0,-.045,0),(side*.025,.10,.015),(side*.060,.283,.038),(side*.063,.312,.04)],[.104,.085,.028,.003],[.071,.049,.017,.003],fur,ear,10)
   loft('EarRim',[(side*.051,.242,.032),(side*.063,.312,.04)],[.039,.003],[.023,.003],ink,ear,8)
   solid_panel('EarInner',[(-side*.060,.015,-.060),(side*.080,.033,-.041),(side*.056,.257,.012)],rose,ear,.009,True)
  else:
   # Broad almond ears bend gently, with a rounded tapered tip and raised rim.
   loft('Ear',[(0,-.045,0),(side*.015,.16,.008),(side*.04,.40,.036),(side*(.065 if side<0 else .12),.63 if side<0 else .57,.065),(side*(.07 if side<0 else .16),.683 if side<0 else .60,.08)],[.076,.095,.082,.043,.003],[.058,.057,.046,.027,.003],fur,ear,10)
   loft('EarInner',[(0,.058,-.052),(side*.014,.22,-.048),(side*.043,.43,-.012),(side*(.067 if side<0 else .13),.61 if side<0 else .55,.035)],[.031,.052,.042,.003],[.008,.009,.008,.003],rose,ear,8)
  palette_join(ear,palette)
 # Small tapered crown, no disconnected spiky beads.
 loft('Forelock',[(0,.30,-.02),(0,.355,-.08),(.045,.372,-.105)],[.068,.043,.003],[.052,.029,.003],fur,head,8)
 tail=empty('Tail',body,(0,.69,.40))
 if fox:
  loft('Brush',[(0,0,0),(.05,-.015,.20),(.15,.01,.43),(.20,.09,.63),(.20,.17,.77)],[.11,.175,.20,.15,.095],[.10,.155,.18,.145,.09],fur,tail,12)
  loft('TailTip',[(.20,.17,.75),(.175,.21,.89),(.10,.22,1.01)],[.098,.075,.003],[.094,.068,.003],cream,tail,12)
 else:ell('CottonTail',(0,.015,.17),(.145,.14,.145),cream,tail,12,7)
 sculpt_colour(body,fur,.035,450 if fox else 600)
 sculpt_colour(head,cream,.018,350 if fox else 250)
 palette_join(tail,palette);palette_join(head,palette);palette_join(body,palette)
 legs=[]
 for side in [-1,1]:
  for front in [True,False]:
   name=('Front' if front else 'Back')+('Left' if side<0 else 'Right');hip=(side*(.185 if front else .228),.555 if front else .54,-.275 if front else .29)
   upper=empty(name,body,hip);L1=.24 if front else .25;L2=.30
   lower=empty(name+'Lower',upper,(0,-L1,0));paw=empty(name+'Paw',lower,(0,-L2,0))
   # Rounded overlapping joint caps cover the full authored articulation envelope.
   loft('Upper',[(0,.085,0),(0,-.035,0),(0,-.15,0),(0,-L1,0),(0,-L1-.052,0)],[.040,.085 if front else .107,.073,.055,.003],[.045,.087 if front else .105,.074,.055,.003],fur,upper,10)
   loft('Shin',[(0,.065,0),(0,.018,0),(0,-L2*.35,0),(0,-L2*.74,0),(0,-L2,0)],[.003,.056,.054,.047,.043],[.003,.056,.055,.049,.044],fur,lower,10)
   if fox:loft('Sock',[(0,-L2*.68,0),(0,-L2,0)],[.049,.046],[.051,.047],shade,lower,10)
   ell('Paw',(0,0,-.055),(.099 if front else .115,.065,.155 if fox or front else .205),ink if fox else cream,paw,12,6)
   # Readable two shallow toe ridges, palette-coloured and joined to the paw.
   for t in [-1,1]:rod('Toe',(t*.025,.035,-.12 if fox or front else -.18),(t*.025,-.004,-.15 if fox or front else -.21),.004,shade if fox else rose,paw,5)
   for joint in [upper,lower,paw]:palette_join(joint,palette)
   legs.append((name,hip,L1,L2,upper,lower,paw,front,side))
 socket=empty('WingSocket',root,(0,.85,.35));socket['interface']='local origin identical to woodland-v3'
 durations={'AvatarIdle':120,'AvatarRun':42,'AvatarGlide':96,'AvatarJump':24,'AvatarLand':15}
 # Feet are authored in world-grounded model coordinates using analytic two-link
 # IK. No root translation, dynamic runtime IK, physics or grounding fudge.
 for clip,last in durations.items():
  tracks={o:[] for o in [body,head,tail,*ears,*[o for l in legs for o in l[4:7]]]}
  for n in range(last+1):
   t=n/last;phase=TAU*t;bob=.012*(1-math.cos(phase)) if clip=='AvatarIdle' else .009*(1-math.cos(phase*2)) if clip=='AvatarRun' else .015*math.sin(phase) if clip=='AvatarGlide' else .035*math.sin(math.pi*t) if clip=='AvatarJump' else -.065*math.sin(math.pi*t)
   if not fox and clip=='AvatarRun':bob=.015*(1-math.cos(phase))
   bodyrot=(.025*math.sin(phase),0,0) if clip=='AvatarGlide' else (.035*math.sin(phase),0,0) if not fox and clip=='AvatarRun' else (0,0,0)
   tracks[body].append((n,(0,bob,0),bodyrot))
   nod=.018*math.sin(phase) if clip=='AvatarIdle' else -.035*math.sin(phase*2) if clip=='AvatarRun' else -.045 if clip=='AvatarGlide' else -.10*math.sin(math.pi*t)
   if not fox and clip=='AvatarRun':nod=-.04*math.sin(phase)
   tracks[head].append((n,(0,.97,-.33),(nod,0,.022*math.sin(phase) if clip=='AvatarIdle' else 0)))
   tracks[tail].append((n,(0,.69,.40),(.05*math.sin(phase) if fox else .04*math.sin(phase*2),.07*math.sin(phase),.10*math.sin(phase) if fox else .03*math.sin(phase))))
   for i,ear in enumerate(ears):
    flick=(math.sin(phase)**8)*(.065 if i==0 else -.045) if clip=='AvatarIdle' else .065*math.sin(phase*2+i*.6) if clip=='AvatarRun' else .045*math.sin(phase+i*.5) if clip=='AvatarGlide' else -.15*math.sin(math.pi*t)
    if not fox and clip=='AvatarRun':flick=.085*math.sin(phase+i*.6)
    tracks[ear].append((n,(ear.location.x,ear.location.z,-ear.location.y),(flick,.018*math.sin(phase+i),0)))
   for name,hip,L1,L2,upper,lower,paw,front,side in legs:
    # runtime yz is mirrored into Blender x-rotation. Feet stay level.
    footz=hip[2]+(-.045 if front else .025);footy=.0652;bodyPitch=bodyrot[0]
    if clip=='AvatarRun':
     offset=(0 if ((side<0)==front) else .5) if fox else (0 if front else .5);u=(t+offset)%1
     support=.6 if fox else .4 if front else .32
     base=hip[2]+(-.045 if front else .025)
     if u<support:footz=base-.13+.26*u/support
     else:
      swing=(u-support)/(1-support);footz=base+.13-.26*swing;footy=.0652+(.115 if fox else .13 if front else .15)*math.sin(math.pi*swing)
    elif clip=='AvatarGlide':footz=hip[2]+(.08 if front else .11);footy=.195+.012*math.sin(phase+(0 if front else 1))
    elif clip=='AvatarJump':footz=hip[2]+(.03 if front else -.03)*t;footy=.0652+.13*t
    elif clip=='AvatarLand':footy=.0652+.10*(1-t)**3;footz=hip[2]+.03*(1-t)
    # Account for authored body pitch in body local target coordinates.
    worldy=footy-bob;worldz=footz;localy=worldy*math.cos(bodyPitch)+worldz*math.sin(bodyPitch);localz=-worldy*math.sin(bodyPitch)+worldz*math.cos(bodyPitch)
    dy=localy-hip[1];dz=localz-hip[2];dist=min(L1+L2-.0001,math.hypot(dy,dz));q=math.atan2(-dz,-dy);bend=math.acos(max(-1,min(1,(dist*dist-L1*L1-L2*L2)/(2*L1*L2))));alpha=math.acos(max(-1,min(1,(dist*dist+L1*L1-L2*L2)/(2*dist*L1))))
    a=q-alpha if front else q+alpha;b=bend if front else -bend
    tracks[upper].append((n,hip,(a,0,0)));tracks[lower].append((n,(0,-L1,0),(b,0,0)));tracks[paw].append((n,(0,-L2,0),(-a-b-bodyPitch,0,0)))
  for obj,frames in tracks.items():key_motion(obj,clip,frames)
 save('avatar-'+kind)

def feather(name,start,end,width,m,parent,side,z=0,curl=.07,rounded=False):
 # Thin, closed, curved lancet with a raised rachis, not a flat polygon plate.
 a=Vector(start);b=Vector(end);d=b-a;normal=Vector((-d.y,d.x,0)).normalized();verts=[];steps=5;sections=4
 for j in range(steps):
  t=j/(steps-1);center=a+d*t+normal*(math.sin(math.pi*t)*curl);center.z=z+.055*math.sin(math.pi*t)
  w=width*([.22,.90,1,.72,.12] if rounded else [.22,1,.90,.58,.012])[j];thick=.016*[.6,1,.9,.65,.2][j]
  for k in range(sections):
   theta=TAU*k/sections;p=center+normal*(w*math.cos(theta))+Vector((0,0,thick*math.sin(theta)));verts.append((side*p.x,p.y,p.z))
 faces=[tuple(range(sections-1,-1,-1))]
 for j in range(steps-1):
  for k in range(sections):faces.append((j*sections+k,j*sections+(k+1)%sections,(j+1)*sections+(k+1)%sections,(j+1)*sections+k))
 faces.append(tuple(range((steps-1)*sections,steps*sections)))
 return mesh(name,verts,faces,m,parent,True)

def catmull_outline(controls,subdivisions=3):
 points=[]
 for i,q1 in enumerate(controls):
  q0=controls[(i-1)%len(controls)];q2=controls[(i+1)%len(controls)];q3=controls[(i+2)%len(controls)]
  for k in range(subdivisions):
   t=k/subdivisions;points.append(tuple(.5*(2*q1[a]+(-q0[a]+q2[a])*t+(2*q0[a]-5*q1[a]+4*q2[a]-q3[a])*t*t+(-q0[a]+3*q1[a]-3*q2[a]+q3[a])*t*t*t) for a in range(2)))
 return points

def wings(style):
 reset();root=empty('Wings');root['style']=style;root['cosmetic_only']=True;root['revision']='woodland-v4';root['refinement']='woodland-v4-animated'
 colors={'angel':((.94,.88,.73),(.52,.32,.085)),'devil':((.31,.015,.045),(.065,.030,.070)),'parakeet':((.028,.38,.16),(.66,.46,.025)),'elephant':((.31,.38,.47),(.69,.34,.36)),'glow':((.015,.73,.61),(.32,.065,.75)),'dragon':((.025,.25,.17),(.43,.24,.055))}
 main=mat('Wing_'+style,colors[style][0],.70 if style=='parakeet' else .84 if style=='elephant' else .35 if style=='glow' else .73,.9 if style=='glow' else 0,.08 if style=='glow' else 0);trim=mat('Accent_'+style,colors[style][1],.70 if style=='parakeet' else .43 if style in ['dragon','angel'] else .64,.7 if style=='glow' else 0,.38 if style in ['dragon','angel'] else 0)
 secondary=mat('Soft_'+style,tuple(min(1,c*1.12+.06) for c in colors[style][0]),.77,.25 if style=='glow' else 0)
 rainbow=[mat('Feather_'+str(i),c,.70) for i,c in enumerate([(.62,.018,.038),(.83,.16,.009),(.83,.55,.015),(.035,.48,.12),(.012,.28,.69),(.30,.025,.57)])] if style=='parakeet' else []
 for side,label in [(-1,'Left'),(1,'Right')]:
  h=empty('Wing'+label,root,(side*.12,0,0))
  def R(n,a,b,r=.025,m=trim):return rod(label+'_'+n,(side*a[0],a[1],a[2]),(side*b[0],b[1],b[2]),r,m,h)
  def P(n,pts,m=main,d=.028,z=0):return solid_panel(label+'_'+n,[(side*x,y,z) for x,y in pts],m,h,d)
  if style in ['angel','parakeet']:
   # A swept, arched leading edge and individually curved fanned flight feathers.
   tips=[(.64,.10),(.99,.14),(1.30,.30),(1.59,.57),(1.79,.91),(1.85,1.22)] if style=='angel' else [(.65,-.02),(1.03,.10),(1.36,.30),(1.64,.57),(1.82,.83),(1.89,1.08)]
   for i,end in enumerate(tips):
    start=(.14+i*.12,.32+i*.095,0);finish=(end[0],end[1],0)
    feather(label+'_Primary'+str(i),start,finish,.166 if style=='angel' else .120,rainbow[i] if rainbow else main,h,side,-.005+i*.022,curl=.105 if style=='angel' else -.025,rounded=style=='angel')
   # Broad secondary feathers hide roots and lead smoothly into the hinge.
   for i in range(4):
    feather(label+'_Secondary'+str(i),(.08+i*.18,.29+i*.11,0),(.41+i*.235,.70+i*.105,0),.145 if style=='angel' else .105,secondary if style=='angel' else main,h,side,-.10-i*.012,curl=.025,rounded=style=='angel')
   loft(label+'_Shoulder',[(side*.035,.13,-.08),(side*.18,.54,-.10),(side*.59,.91,-.10),(side*.99,1.05,-.07),(side*1.25,1.01,-.02)],[.037,.047,.043,.028,.005],[.032,.039,.034,.025,.005],main,h,6)
   for i in range(3):
    feather(label+'_Covert'+str(i),(.12+i*.22,.48+i*.105,0),(.49+i*.23,.77+i*.095,0),.087 if style=='angel' else .070,main,h,side,-.155-i*.012,.03,rounded=style=='angel')
   R('ShoulderBand',(.03,.13,-.11),(.16,.46,-.12),.034)
  elif style=='elephant':
   # Volumetric soft lobe with a rolled rim, original generic ear-shaped cosmetic.
   outline=[(.03,.16),(.10,.58),(.30,.90),(.62,1.06),(.99,1.03),(1.30,.82),(1.51,.48),(1.55,.16),(1.40,-.08),(1.12,-.13),(.85,-.08),(.60,.10),(.33,.15)]
   controls=outline;outline=[]
   for i,p in enumerate(controls):
    q0=controls[(i-1)%len(controls)];q1=p;q2=controls[(i+1)%len(controls)];q3=controls[(i+2)%len(controls)]
    for k in range(3):
     t=k/3;outline.append(tuple(.5*((2*q1[a])+(-q0[a]+q2[a])*t+(2*q0[a]-5*q1[a]+4*q2[a]-q3[a])*t*t+(-q0[a]+3*q1[a]-3*q2[a]+q3[a])*t*t*t) for a in range(2)))
   P('EarLobe',outline,main,.085)
   inner=[(.24,.22),(.28,.58),(.46,.79),(.72,.86),(1.0,.76),(1.25,.54),(1.30,.28),(1.18,.08),(.97,.06),(.74,.17),(.49,.25)]
   P('InnerEar',catmull_outline(inner,2),trim,.022,-.059)
   loft(label+'_RolledRim',[(side*x,y,-.047) for x,y in outline[2:32]],[.030]*30,[.023]*30,secondary,h,5)
   R('RootFold',(.10,.18,-.055),(.29,.62,-.055),.027)
  elif style=='glow':
   # Detached faceted diamond prisms, clearly different from organic feathers.
   for i,(a,b,width) in enumerate([((.11,.18),(.83,.09),.10),((.18,.35),(1.28,.38),.15),((.34,.57),(1.65,.79),.19),((.51,.74),(1.80,1.16),.13)]):
    av=Vector((a[0],a[1],-.02+i*.022));bv=Vector((b[0],b[1],.035+i*.022));axis=bv-av;perp=Vector((-axis.y,axis.x,0)).normalized();mid=av+axis*.54
    ring=[mid+perp*width,mid+Vector((0,0,.065)),mid-perp*width,mid-Vector((0,0,.040))]
    verts=[(side*av.x,av.y,av.z),*[(side*v.x,v.y,v.z) for v in ring],(side*bv.x,bv.y,bv.z)]
    mesh(label+'_CrystalShard'+str(i),verts,[(0,1,2),(0,2,3),(0,3,4),(0,4,1),(5,2,1),(5,3,2),(5,4,3),(5,1,4)],main if i%2==0 else trim,h,False)
   for i,(x,y) in enumerate([(.35,.57),(1.40,.94),(1.90,1.12)]):
    P('LightMote'+str(i),[(x,y-.042),(x-.027,y),(x,y+.055),(x+.027,y)],secondary,.035,-.11)
   R('EnergySpine',(.035,.11,-.09),(.41,.68,-.09),.023,trim)
  else:
   dragon=style=='dragon'
   # Four bony fingers, natural concave scallops and an arched leading edge.
   # The trailing edge is three concave quadratic arcs, not saw teeth.
   top=[(.02,.08),(.08,.60),(.31,1.03),(.62,1.16),(1.03,1.12),(1.46,1.01),(1.83,.66)]
   if not dragon:top=[(.02,.10),(.10,.62),(.34,1.19),(.50,1.27),(.80,1.10),(1.18,.83),(1.62,.39)]
   outline=top[:]
   arcs=[((1.83,.66),(1.24,.66),(1.44,.03)),((1.44,.03),(.97,.48),(.92,-.12)),((.92,-.12),(.51,.43),(.37,-.12))] if dragon else [((1.62,.39),(1.10,.56),(1.27,-.08)),((1.27,-.08),(.89,.45),(.77,-.13)),((.77,-.13),(.46,.39),(.32,-.08))]
   for start,control,end in arcs:
    for n in range(1,6):
     t=n/5;u=1-t;x=u*u*start[0]+2*u*t*control[0]+t*t*end[0];y=u*u*start[1]+2*u*t*control[1]+t*t*end[1]
     outline.append((x,y))
   outline.append((.18,.02))
   P('SculptedMembrane',outline,main,.030)
   # A swept arm and supporting fingers articulate the web's structure.
   loft(label+'_LeadingArm',[(side*x,y,z) for x,y,z in ([(.025,.13,-.05),(.12,.67,-.055),(.35,1.03,-.035),(.68,1.13,-.025),(1.06,1.08,-.02),(1.48,.98,-.014),(1.82,.65,-.01)] if dragon else [(.025,.13,-.05),(.10,.62,-.055),(.34,1.19,-.035),(.50,1.27,-.025),(.80,1.10,-.02),(1.18,.83,-.014),(1.62,.39,-.01)])],[.045,.042,.036,.030,.024,.017,.005],[.035,.033,.028,.024,.020,.015,.005],trim,h,6)
   tips=[(1.83,.66),(1.44,.03),(.92,-.12),(.37,-.12)] if dragon else [(1.62,.39),(1.27,-.08),(.77,-.13),(.32,-.08)]
   for i,(x,y) in enumerate(tips):
    # Per-style finger tips already match the membrane.
    mid=(.20+(x-.20)*.54,.67+(y-.67)*.34,-.052)
    loft(label+'_Finger'+str(i),[(side*.16,.67,-.059),(side*mid[0],mid[1],mid[2]),(side*x,y,-.02)],[.027,.019,.006],[.025,.017,.006],trim,h,5)
    if dragon:
     loft(label+'_Claw'+str(i),[(side*x,y,-.015),(side*(x+.025),y+.025,-.025),(side*(x+.065),y+.055,-.018)],[.022,.014,.002],[.022,.013,.002],trim,h,5)
   for i,(x,y) in enumerate(([(1.20,.20),(.72,.10),(.33,.13)] if dragon else [(1.02,.19),(.62,.16),(.29,.21)])):R('WebVein'+str(i),(.16,.63,-.021),(x,y,-.021),.009,secondary)
   if dragon:
    for i in range(3):
     x=.24+i*.18;y=.91+i*.08
     loft(label+'_Crest'+str(i),[(side*x,y,-.025),(side*(x-.065),y+.11,-.025),(side*(x-.015),y+.215,-.015)],[.043,.027,.002],[.022,.019,.002],trim,h,6)
  join_by_material(h)
  folded=-side*1.32
  clips(h,{'WingOpen':[(0,folded),(20,0)],'WingFold':[(0,0),(20,folded)]})
  amplitude={'angel':.055,'parakeet':.075,'devil':.047,'dragon':.038,'elephant':.065,'glow':.025}[style]
  frames=[]
  for n in range(97):
   p=TAU*n/96
   # Blender Y bends vertical silhouette, Z subtly feathers the leading edge.
   flutter=(math.sin(p)+.20*math.sin(2*p)) if style!='parakeet' else (math.sin(2*p)+.18*math.sin(4*p))
   frames.append((n,(side*.12,0,0),(.018*math.sin(p),-side*amplitude*flutter,side*.025*math.sin(p))))
  key_motion(h,'WingGlide',frames)
 save('wings-'+style)


if __name__=='__main__':
 requested=sys.argv[sys.argv.index('--')+2:]
 for name in requested or ['fox','rabbit','angel','parakeet','devil','dragon','elephant','glow']:
  avatar(name) if name in ['fox','rabbit'] else wings(name)
