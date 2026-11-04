"""Skybound woodland runners / cosmetic wings, original revised Blender source.
Blender 4.3.2. No third-party geometry, images, textures or add-ons.
Runtime units metres, +Y up, -Z forward; cv converts to Blender +Z up.
Invocation: blender -b -noaudio --python assets/appearance-source/generate_refined_assets.py -- OUTPUT [ids...]
Seedless deterministic geometry. Preserve original baseline as fallback.
"""
import bpy, math, sys, os
from mathutils import Vector
OUT=os.path.abspath(sys.argv[sys.argv.index('--')+1]);os.makedirs(OUT,exist_ok=True)
TAU=math.pi*2

def cv(p):return (p[0],-p[2],p[1])
def reset():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for collection in [bpy.data.materials,bpy.data.actions,bpy.data.meshes,bpy.data.curves]:
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
  tr=obj.animation_data.nla_tracks.new();tr.name=name;st=tr.strips.new(name,1,action);st.name=name
 obj.animation_data.action=None;obj.rotation_euler=(0,0,0)

def save(name):
 scene=bpy.context.scene;scene.frame_set(1)
 # In Blender and in GLTF, pose is selected explicitly, never the sum of three NLA strips.
 for o in bpy.data.objects:
  if o.animation_data:
   for t in o.animation_data.nla_tracks:t.mute=False
 scene['authoring_revision']='woodland-v3-20261104';scene['cosmetic_only']=True
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,name+'.glb'),export_format='GLB',export_yup=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_force_sampling=True,export_optimize_animation_keep_anim_object=True,export_cameras=False,export_lights=False,export_materials='EXPORT',export_extras=True)
 # Save an editable source that opens in an intentional display pose. Export above
 # always restores all NLA tracks, so stored preview mutes cannot drop GLB clips.
 preferred='WingOpen' if name.startswith('wings-') else 'AvatarIdle'
 for obj in bpy.data.objects:
  if obj.animation_data:
   for track in obj.animation_data.nla_tracks:track.mute=track.name!=preferred
 scene.frame_set(21 if name.startswith('wings-') else 1)
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,name+'.blend'))

def avatar(kind):
 reset();fox=kind=='fox';root=empty('Avatar');root['species']=kind;root['revision']='woodland-v2';root['refinement']='woodland-v3';root['cosmetic_only']=True;body=empty('Body',root)
 fur=mat('Fur',(.68,.19,.048) if fox else (.43,.50,.54));light=mat('Cream',(.96,.86,.68) if fox else (.91,.90,.83));dark=mat('Ink',(.018,.027,.036),.62);pink=mat('InnerEar',(.55,.17,.15) if fox else (.68,.28,.30));eye=mat('EyeHighlight',(1,.98,.90),.24);iris=mat('Iris',(.22,.084,.018) if fox else (.09,.16,.21),.3)
 # Rounded but low-resolution designed masses, with a fuller rabbit haunch.
 if fox:
  loft('AthleticTorso',[(0,.69,-.38),(0,.69,-.23),(0,.67,.08),(0,.70,.35),(0,.70,.48)],[.13,.245,.25,.22,.095],[.13,.27,.28,.245,.10],fur,body,14)
 else:ell('Silhouette_Torso',(0,.66,.08),(.315,.33,.45),fur,body,14,8)
 ell('Bib',(0,.735,-.285),(.19 if fox else .225,.255,.143),light,body,12,7)
 ell('Neck',(0,.90,-.27),(.205,.235,.205),fur,body,12,7)
 ell('Head',(0,1.065,-.40),(.30 if fox else .315,.272 if fox else .265,.285),fur,body,14,8)
 # Proper tapering fox snout / rounder split rabbit muzzle.
 if fox:
  loft('TaperedMuzzle',[(0,1.015,-.54),(0,.985,-.70),(0,.98,-.835)],[.185,.125,.055],[.127,.092,.045],light,body,10)
  ell('Nose',(0,1.005,-.85),(.062,.038,.033),dark,body,10,5)
 else:
  ell('MuzzleMask',(0,1.005,-.625),(.183,.096,.068),light,body,12,6)
  for side in [-1,1]:ell('MuzzleLobe',(side*.065,.988,-.674),(.087,.062,.063),light,body,10,6)
  ell('HeartNose',(0,1.03,-.724),(.036,.024,.020),pink,body,8,5)
  rod('Philtrum',(0,1.012,-.727),(0,.978,-.733),.008,dark,body,5)
 for side in [-1,1]:
  # Side-framed eyes with a warm iris, pupil and a single broad catchlight.
  ell('EyeSocket',(side*.184,1.135,-.628),(.069,.080,.025),dark,body,10,6)
  ell('Iris',(side*.184,1.135,-.648),(.044,.060,.013),iris,body,10,6)
  ell('Pupil',(side*.181,1.136,-.659),(.027,.046,.008),dark,body,8,5)
  ell('Catchlight',(side*.168,1.159,-.666),(.015,.020,.006),eye,body,8,5)
  # Brow is fur, so it reads as expression rather than black eyebrows.
  loft('Brow',[(side*.118,1.210,-.616),(side*.181,1.231,-.627),(side*.246,1.204,-.603)],[.025,.027,.012],[.023,.023,.012],fur,body,6)
  if fox:
   # Slightly swept tapered ears with black tips and inset warm inner ears.
   centers=[(side*.195,1.24,-.355),(side*.235,1.38,-.33),(side*.282,1.535,-.30),(side*.293,1.575,-.295)]
   loft('Ear',centers,[.122,.10,.032,.006],[.083,.058,.021,.005],fur,body,8)
   loft('EarTip',centers[-2:],[.034,.004],[.023,.004],dark,body,8)
   solid_panel('EarInset',[(side*.156,1.31,-.420),(side*.285,1.32,-.408),(side*.281,1.512,-.328)],pink,body,.008)
   # A continuous angular cream mask follows the fox cheek, not bead tufts.
   solid_panel('CheekMask',[(side*.11,1.025,-.659),(side*.23,1.085,-.607),(side*.355,1.085,-.483),(side*.301,1.015,-.539),(side*.365,.998,-.471),(side*.25,.965,-.566),(side*.16,.976,-.647)],light,body,.032)
  else:
   # Independent ears with asymmetry and an outward curl, not long straight cylinders.
   centers=[(side*.155,1.22,-.34),(side*.185,1.48,-.33),(side*.215,1.77,-.31),(side*(.225 if side<0 else .295),1.98 if side<0 else 1.88,-.30),(side*(.212 if side<0 else .355),2.045 if side<0 else 1.925,-.325)]
   loft('LongEar',centers,[.086,.099,.085,.046,.005],[.064,.061,.052,.035,.005],fur,body,8)
   inset=[(side*.17,1.37,-.393)]+[(p[0],p[1],p[2]-.055) for p in centers[1:]]
   loft('EarInset',inset,[.025,.050,.045,.022,.003],[.007,.010,.010,.008,.003],pink,body,6)
   # Cheeks belong to the head silhouette, not an extra row of cream spheres.
  # Original cream eye-brow spot and angular crown tuft unify both woodland runners.
  ell('ExpressionPatch',(side*.173,1.245,-.590),(.058,.026,.027),light,body,8,4)
 # Two swept crown tufts, not a high-resolution hair shell.
 for side in [-1,1]:
  loft('CrownTuft',[(side*.065,1.285,-.39),(side*.075,1.345,-.42),(side*.11,1.365,-.45)],[.047,.031,.002],[.037,.021,.002],fur,body,6)
 for side in [-1,1]:
  # Quiet sculpted mouth corners.
  rod('Mouth',(side*.012,.978,-.734 if not fox else -.801),(side*.070,.970,-.704 if not fox else -.734),.007,dark,body,5)
 for side in [-1,1]:
  for end in [-1,1]:
   front=end<0;leg=empty(('Front' if front else 'Back')+('Left' if side<0 else 'Right'),body,(side*(.18 if front else .215),.48 if front else .50,end*.27))
   if not fox and not front:ell('Haunch',(0,-.015,.045),(.19,.235,.215),fur,leg,10,6)
   loft('Leg',[(0,.015,0),(0,-.12,.018 if front else .14),(0,-.27,-.028 if front else .065),(0,-.39,-.045)],[.077 if front else .09,.069,.058,.050],[.087,.078,.064,.053],fur,leg,8)
   pawz=-.043 if fox or front else -.075
   ell('Paw',(0,-.408 if front else -.428,pawz),(.095 if front else .115,.072,.15 if fox or front else .215),dark if fox else light,leg,10,6)
   # Two subtle toe divisions, represented as raised fur strips rather than texture memory.
   for t in [-1,1]:rod('ToeSeam',(t*.028,-.37,pawz-.11),(t*.028,-.415,pawz-.13),.005,fur if fox else pink,leg,5)
   join_by_material(leg);sign=1 if side==end else -1
   clips(leg,{'AvatarIdle':[(1,0),(61,0)],'AvatarRun':[(1,sign*.47),(16,-sign*.47),(31,sign*.47)],'AvatarGlide':[(1,.4),(61,.4)]},0)
 tail=empty('Tail',body)
 if fox:
  loft('BrushTail',[(0,.68,.36),(.03,.69,.58),(.16,.75,.83),(.24,.88,1.06),(.25,.98,1.18)],[.10,.17,.20,.16,.11],[.10,.16,.18,.15,.10],fur,tail,10)
  loft('WhiteTip',[(.25,.98,1.17),(.23,1.04,1.31),(.18,1.065,1.41)],[.112,.085,.004],[.102,.075,.004],light,tail,10)
 else:
  ell('CottonTail',(0,.69,.57),(.15,.15,.15),light,tail,12,7)
 join_by_material(tail);join_by_material(body)
 socket=empty('WingSocket',root,(0,.85,.35));socket['interface']='unchanged from accepted original'
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
 reset();root=empty('Wings');root['style']=style;root['cosmetic_only']=True;root['revision']='woodland-v2';root['refinement']='woodland-v3'
 colors={'angel':((.93,.86,.69),(.53,.30,.065)),'devil':((.39,.018,.052),(.045,.022,.055)),'parakeet':((.028,.38,.16),(.66,.46,.025)),'elephant':((.32,.34,.47),(.66,.27,.31)),'glow':((.015,.73,.61),(.32,.065,.75)),'dragon':((.025,.25,.17),(.43,.24,.055))}
 main=mat('Wing_'+style,colors[style][0],.70 if style=='parakeet' else .84 if style=='elephant' else .35 if style=='glow' else .73,.9 if style=='glow' else 0,.08 if style=='glow' else 0);trim=mat('Accent_'+style,colors[style][1],.70 if style=='parakeet' else .43 if style in ['dragon','angel'] else .64,.7 if style=='glow' else 0,.38 if style in ['dragon','angel'] else 0)
 secondary=mat('Soft_'+style,tuple(min(1,c*1.12+.06) for c in colors[style][0]),.77,.25 if style=='glow' else 0)
 rainbow=[mat('Feather_'+str(i),c,.70) for i,c in enumerate([(.62,.018,.038),(.83,.16,.009),(.83,.55,.015),(.035,.48,.12),(.012,.28,.69),(.30,.025,.57)])] if style=='parakeet' else []
 for side,label in [(-1,'Left'),(1,'Right')]:
  h=empty('Wing'+label,root,(side*.12,0,0))
  def R(n,a,b,r=.025,m=trim):return rod(label+'_'+n,(side*a[0],a[1],a[2]),(side*b[0],b[1],b[2]),r,m,h)
  def P(n,pts,m=main,d=.028,z=0):return solid_panel(label+'_'+n,[(side*x,y,z) for x,y in pts],m,h,d)
  if style in ['angel','parakeet']:
   # A swept, arched leading edge and individually curved fanned flight feathers.
   tips=[(.65,.16),(.99,.18),(1.31,.32),(1.56,.55),(1.76,.82),(1.86,1.10)] if style=='angel' else [(.78,.05),(1.12,.16),(1.39,.32),(1.62,.53),(1.77,.76),(1.85,.98)]
   for i,end in enumerate(tips):
    start=(.14+i*.12,.32+i*.095,0);finish=(end[0],end[1],0)
    feather(label+'_Primary'+str(i),start,finish,.143 if style=='angel' else .112,rainbow[i] if rainbow else main,h,side,-.005+i*.022,curl=.065 if style=='angel' else .015,rounded=style=='angel')
   # Broad secondary feathers hide roots and lead smoothly into the hinge.
   for i in range(4):
    feather(label+'_Secondary'+str(i),(.08+i*.18,.29+i*.11,0),(.41+i*.235,.70+i*.105,0),.126 if style=='angel' else .101,secondary if style=='angel' else main,h,side,-.10-i*.012,curl=.025,rounded=style=='angel')
   loft(label+'_Shoulder',[(side*.035,.13,-.08),(side*.18,.54,-.10),(side*.59,.91,-.10),(side*.99,1.05,-.07),(side*1.25,1.01,-.02)],[.037,.047,.043,.028,.005],[.032,.039,.034,.025,.005],main,h,6)
   for i in range(3):
    feather(label+'_Covert'+str(i),(.12+i*.22,.48+i*.105,0),(.49+i*.23,.77+i*.095,0),.087 if style=='angel' else .070,main,h,side,-.155-i*.012,.03,rounded=style=='angel')
   R('ShoulderBand',(.03,.13,-.11),(.16,.46,-.12),.034)
  elif style=='elephant':
   # Volumetric soft lobe with a rolled rim, original generic ear-shaped cosmetic.
   outline=[(.03,.16),(.10,.58),(.30,.90),(.62,1.06),(.99,1.03),(1.30,.82),(1.51,.48),(1.53,.18),(1.38,-.05),(1.13,-.12),(.87,-.08),(.62,.08),(.33,.15)]
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
  clips(h,{'WingOpen':[(1,folded),(21,0)],'WingGlide':[(1,0),(31,side*.045),(61,0)],'WingFold':[(1,0),(21,folded)]})
 save('wings-'+style)

if __name__=='__main__':
 requested=sys.argv[sys.argv.index('--')+2:]
 for name in requested or ['fox','rabbit','angel','parakeet','devil','dragon','elephant','glow']:
  avatar(name) if name in ['fox','rabbit'] else wings(name)
