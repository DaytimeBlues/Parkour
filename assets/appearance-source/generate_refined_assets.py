"""Skybound woodland runners / cosmetic wings, original revised Blender source.
Blender 4.3.2. No third-party geometry, images, textures or add-ons.
Runtime units metres, +Y up, -Z forward; cv converts to Blender +Z up.
Invocation: blender -b -noaudio --python source/generate_refined_assets.py -- OUTPUT [ids...]
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
 scene['authoring_revision']='woodland-v2-20261103';scene['cosmetic_only']=True
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
 reset();fox=kind=='fox';root=empty('Avatar');root['species']=kind;root['revision']='woodland-v2';root['cosmetic_only']=True;body=empty('Body',root)
 fur=mat('Fur',(.63,.115,.028) if fox else (.40,.49,.57));light=mat('Cream',(.94,.84,.66) if fox else (.87,.89,.83));dark=mat('Ink',(.018,.027,.036),.62);pink=mat('InnerEar',(.55,.17,.15) if fox else (.68,.28,.30));eye=mat('EyeHighlight',(1,.98,.90),.24);iris=mat('Iris',(.22,.084,.018) if fox else (.09,.16,.21),.3)
 # Rounded but low-resolution designed masses, with a fuller rabbit haunch.
 ell('Silhouette_Torso',(0,.66,.08),(.275 if fox else .30,.275 if fox else .31,.49 if fox else .47),fur,body,14,8)
 ell('Bib',(0,.72,-.235),(.225,.255,.14),light,body,12,7)
 ell('Neck',(0,.90,-.27),(.20,.23,.20),fur,body,12,7)
 ell('Head',(0,1.065,-.40),(.285 if fox else .30,.255,.275),fur,body,14,8)
 # Proper tapering fox snout / rounder split rabbit muzzle.
 if fox:
  loft('TaperedMuzzle',[(0,1.0,-.53),(0,.965,-.69),(0,.965,-.81)],[.18,.12,.055],[.12,.09,.043],light,body,10)
  ell('Nose',(0,.987,-.825),(.063,.041,.037),dark,body,10,5)
 else:
  ell('MuzzleMask',(0,.985,-.605),(.174,.083,.066),light,body,12,6)
  for side in [-1,1]:ell('MuzzleLobe',(side*.062,.972,-.658),(.085,.055,.063),light,body,10,6)
  ell('HeartNose',(0,1.015,-.707),(.04,.025,.022),pink,body,8,5)
  rod('Philtrum',(0,.995,-.709),(0,.965,-.712),.008,dark,body,5)
 for side in [-1,1]:
  # Side-framed eyes with a warm iris, pupil and a single broad catchlight.
  ell('EyeSocket',(side*.205,1.115,-.587),(.065,.071,.037),dark,body,10,6)
  ell('Iris',(side*.207,1.116,-.612),(.039,.050,.016),iris,body,10,6)
  ell('Pupil',(side*.207,1.117,-.626),(.023,.041,.009),dark,body,8,5)
  ell('Catchlight',(side*.194,1.139,-.635),(.014,.019,.007),eye,body,8,5)
  # Brow is fur, so it reads as expression rather than black eyebrows.
  loft('Brow',[(side*.147,1.184,-.579),(side*.21,1.196,-.588),(side*.258,1.177,-.567)],[.025,.027,.012],[.023,.023,.012],fur,body,6)
  if fox:
   # Slightly swept tapered ears with black tips and inset warm inner ears.
   centers=[(side*.19,1.22,-.34),(side*.225,1.35,-.325),(side*.26,1.52,-.30),(side*.27,1.57,-.30)]
   loft('Ear',centers,[.122,.10,.032,.006],[.083,.058,.021,.005],fur,body,8)
   loft('EarTip',centers[-2:],[.034,.004],[.023,.004],dark,body,8)
   solid_panel('EarInset',[(side*.15,1.29,-.409),(side*.28,1.30,-.404),(side*.267,1.494,-.327)],pink,body,.008)
   for i in range(2):
    x=.24+i*.013;y=1.012-i*.073
    loft('CheekTuft',[(side*(x-.04),y,-.49),(side*(x+.055),y-.012,-.49),(side*(x+.105),y+.013,-.46)],[.055,.044,.003],[.058,.034,.003],light,body,7)
  else:
   # Independent ears with asymmetry and an outward curl, not long straight cylinders.
   centers=[(side*.155,1.22,-.34),(side*.185,1.48,-.33),(side*.215,1.77,-.31),(side*(.225 if side<0 else .27),1.98 if side<0 else 1.91,-.30),(side*(.215 if side<0 else .30),2.045 if side<0 else 1.94,-.30)]
   loft('LongEar',centers,[.086,.099,.085,.046,.005],[.064,.061,.052,.035,.005],fur,body,10)
   inset=[(side*.17,1.37,-.393)]+[(p[0],p[1],p[2]-.055) for p in centers[1:]]
   loft('EarInset',inset,[.025,.050,.045,.022,.003],[.007,.010,.010,.008,.003],pink,body,8)
   # Cheeks belong to the head silhouette, not an extra row of cream spheres.
  # Quiet sculpted mouth corners.
  rod('Mouth',(side*.014,.955,-.713 if not fox else -.765),(side*.067,.948,-.681 if not fox else -.712),.007,dark,body,5)
 for side in [-1,1]:
  for end in [-1,1]:
   front=end<0;leg=empty(('Front' if front else 'Back')+('Left' if side<0 else 'Right'),body,(side*(.18 if front else .215),.48 if front else .50,end*.27))
   if not fox and not front:ell('Haunch',(0,-.015,.045),(.18,.22,.205),fur,leg,12,7)
   loft('Leg',[(0,.015,0),(0,-.13,.025 if front else .085),(0,-.26,-.012 if front else .040),(0,-.39,-.045)],[.077 if front else .09,.069,.058,.050],[.087,.078,.064,.053],fur,leg,8)
   pawz=-.043 if fox or front else -.075
   ell('Paw',(0,-.408 if front else -.428,pawz),(.088 if front else .105,.072,.145 if fox or front else .205),dark if fox else light,leg,10,6)
   # Two subtle toe divisions, represented as raised fur strips rather than texture memory.
   for t in [-1,1]:rod('ToeSeam',(t*.028,-.37,pawz-.11),(t*.028,-.415,pawz-.13),.005,fur if fox else pink,leg,5)
   join_by_material(leg);sign=1 if side==end else -1
   clips(leg,{'AvatarIdle':[(1,0),(61,0)],'AvatarRun':[(1,sign*.47),(16,-sign*.47),(31,sign*.47)],'AvatarGlide':[(1,.4),(61,.4)]},0)
 tail=empty('Tail',body)
 if fox:
  loft('BrushTail',[(0,.66,.38),(.02,.72,.58),(.05,.88,.79),(.055,1.04,1.00),(.03,1.11,1.11)],[.105,.20,.225,.175,.12],[.11,.19,.20,.16,.11],fur,tail,10)
  loft('WhiteTip',[(.03,1.11,1.10),(0,1.16,1.23),(-.035,1.18,1.31)],[.122,.10,.004],[.112,.085,.004],light,tail,10)
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

def wings(style):
 reset();root=empty('Wings');root['style']=style;root['cosmetic_only']=True;root['revision']='woodland-v2'
 colors={'angel':((.93,.86,.69),(.53,.30,.065)),'devil':((.39,.018,.052),(.045,.022,.055)),'parakeet':((.028,.38,.16),(.66,.46,.025)),'elephant':((.32,.34,.47),(.66,.27,.31)),'glow':((.015,.73,.61),(.32,.065,.75)),'dragon':((.025,.25,.17),(.43,.24,.055))}
 main=mat('Wing_'+style,colors[style][0],.70,1.0 if style=='glow' else 0);trim=mat('Accent_'+style,colors[style][1],.70 if style=='parakeet' else .6,.75 if style=='glow' else 0)
 secondary=mat('Soft_'+style,tuple(min(1,c*1.12+.06) for c in colors[style][0]),.77)
 rainbow=[mat('Feather_'+str(i),c,.70) for i,c in enumerate([(.62,.018,.038),(.83,.16,.009),(.83,.55,.015),(.035,.48,.12),(.012,.28,.69),(.30,.025,.57)])] if style=='parakeet' else []
 for side,label in [(-1,'Left'),(1,'Right')]:
  h=empty('Wing'+label,root,(side*.12,0,0))
  def R(n,a,b,r=.025,m=trim):return rod(label+'_'+n,(side*a[0],a[1],a[2]),(side*b[0],b[1],b[2]),r,m,h)
  def P(n,pts,m=main,d=.028,z=0):return solid_panel(label+'_'+n,[(side*x,y,z) for x,y in pts],m,h,d)
  if style in ['angel','parakeet']:
   # A swept, arched leading edge and individually curved fanned flight feathers.
   tips=[(.73,.12),(1.02,.17),(1.30,.28),(1.53,.45),(1.71,.68),(1.82,.92)] if style=='angel' else [(.70,.18),(.95,.23),(1.16,.35),(1.35,.53),(1.50,.75),(1.58,.99)]
   for i,end in enumerate(tips):
    start=(.14+i*.12,.32+i*.095,0);finish=(end[0],end[1],0)
    feather(label+'_Primary'+str(i),start,finish,.153 if style=='angel' else .127,rainbow[i] if rainbow else main,h,side,-.005+i*.025,curl=.04,rounded=style=='angel')
   # Broad secondary feathers hide roots and lead smoothly into the hinge.
   for i in range(4):
    feather(label+'_Secondary'+str(i),(.08+i*.18,.29+i*.11,0),(.40+i*.22,.69+i*.11,0),.14 if style=='angel' else .118,secondary if style=='angel' else main,h,side,-.10-i*.012,curl=.025,rounded=style=='angel')
   loft(label+'_Shoulder',[(side*.035,.13,-.08),(side*.18,.54,-.10),(side*.59,.91,-.10),(side*.99,1.05,-.07),(side*1.25,1.01,-.02)],[.045,.065,.067,.045,.007],[.04,.055,.05,.035,.007],main,h,7)
   for i in range(3):
    feather(label+'_Covert'+str(i),(.12+i*.22,.48+i*.105,0),(.49+i*.23,.77+i*.095,0),.106 if style=='angel' else .079,main,h,side,-.155-i*.012,.03,rounded=style=='angel')
   R('ShoulderBand',(.03,.13,-.11),(.16,.46,-.12),.034)
  elif style=='elephant':
   # Volumetric soft lobe with a rolled rim, original generic ear-shaped cosmetic.
   outline=[(.03,.14),(.11,.53),(.27,.83),(.52,1.00),(.88,1.01),(1.20,.86),(1.46,.58),(1.52,.28),(1.42,.02),(1.21,-.10),(.94,-.12),(.63,.02),(.34,.13)]
   controls=outline;outline=[]
   for i,p in enumerate(controls):
    q0=controls[(i-1)%len(controls)];q1=p;q2=controls[(i+1)%len(controls)];q3=controls[(i+2)%len(controls)]
    for k in range(3):
     t=k/3;outline.append(tuple(.5*((2*q1[a])+(-q0[a]+q2[a])*t+(2*q0[a]-5*q1[a]+4*q2[a]-q3[a])*t*t+(-q0[a]+3*q1[a]-3*q2[a]+q3[a])*t*t*t) for a in range(2)))
   P('EarLobe',outline,main,.085)
   inner=[(.24,.22),(.28,.58),(.46,.79),(.72,.86),(1.0,.76),(1.25,.54),(1.30,.28),(1.18,.08),(.97,.06),(.74,.17),(.49,.25)]
   P('InnerEar',inner,trim,.022,-.055)
   loft(label+'_RolledRim',[(side*x,y,-.047) for x,y in outline[2:32]],[.035]*30,[.025]*30,secondary,h,6)
   R('RootFold',(.10,.18,-.055),(.29,.62,-.055),.027)
  elif style=='glow':
   # Detached faceted diamond prisms, clearly different from organic feathers.
   for i,(a,b,width) in enumerate([((.10,.17),(.83,.16),.12),((.17,.29),(1.18,.41),.14),((.27,.43),(1.54,.75),.16),((.43,.57),(1.78,1.10),.135)]):
    av=Vector((a[0],a[1],-.02+i*.022));bv=Vector((b[0],b[1],.035+i*.022));axis=bv-av;perp=Vector((-axis.y,axis.x,0)).normalized();mid=av+axis*.54
    ring=[mid+perp*width,mid+Vector((0,0,.065)),mid-perp*width,mid-Vector((0,0,.040))]
    verts=[(side*av.x,av.y,av.z),*[(side*v.x,v.y,v.z) for v in ring],(side*bv.x,bv.y,bv.z)]
    mesh(label+'_CrystalShard'+str(i),verts,[(0,1,2),(0,2,3),(0,3,4),(0,4,1),(5,2,1),(5,3,2),(5,4,3),(5,1,4)],main if i%2==0 else trim,h,False)
   for i in range(3):
    x=.17+i*.23;y=.42+i*.17;P('LightMote'+str(i),[(x,y-.045),(x-.035,y),(x,y+.06),(x+.035,y)],secondary,.035,-.11)
   R('EnergySpine',(.035,.11,-.09),(.41,.68,-.09),.023,trim)
  else:
   dragon=style=='dragon'
   # Four bony fingers, natural concave scallops and an arched leading edge.
   # The trailing edge is three concave quadratic arcs, not saw teeth.
   top=[(.02,.08),(.08,.60),(.31,1.03),(.62,1.16),(1.03,1.12),(1.46,.92),(1.84,.57)]
   if not dragon:top=[(x*.86,y*.91) for x,y in top]
   outline=top[:]
   arcs=[((1.84,.57),(1.26,.59),(1.40,.015)),((1.40,.015),(.99,.43),(.91,-.12)),((.91,-.12),(.53,.37),(.39,-.12))]
   for start,control,end in arcs:
    for n in range(1,6):
     t=n/5;u=1-t;x=u*u*start[0]+2*u*t*control[0]+t*t*end[0];y=u*u*start[1]+2*u*t*control[1]+t*t*end[1]
     outline.append((x,y) if dragon else (x*.86,y*.91))
   outline.append((.18,.02))
   P('SculptedMembrane',outline,main,.030)
   # A swept arm and supporting fingers articulate the web's structure.
   loft(label+'_LeadingArm',[(side*.025,.13,-.05),(side*.12,.67,-.055),(side*.35,1.03,-.035),(side*.68,1.13,-.025),(side*1.06,1.08,-.02),(side*1.48,.88,-.014),(side*1.82,.56,-.01)],[.045,.042,.036,.030,.024,.017,.005],[.035,.033,.028,.024,.020,.015,.005],trim,h,6)
   tips=[(1.84,.57),(1.40,.015),(.91,-.12),(.39,-.12)]
   for i,(x,y) in enumerate(tips):
    if not dragon:x*=.86;y*=.91
    mid=(.20+(x-.20)*.54,.67+(y-.67)*.34,-.052)
    loft(label+'_Finger'+str(i),[(side*.16,.67,-.059),(side*mid[0],mid[1],mid[2]),(side*x,y,-.02)],[.027,.019,.006],[.025,.017,.006],trim,h,5)
    if dragon:
     loft(label+'_Claw'+str(i),[(side*x,y,-.015),(side*(x+.025),y+.025,-.025),(side*(x+.065),y+.055,-.018)],[.022,.014,.002],[.022,.013,.002],trim,h,5)
   for i,(x,y) in enumerate([(1.20,.20),(.72,.10),(.33,.13)]):R('WebVein'+str(i),(.16,.63,-.021),(x,y,-.021),.009,secondary)
   if dragon:
    for i in range(3):
     x=.24+i*.18;y=.91+i*.08
     loft(label+'_Crest'+str(i),[(side*x,y,-.025),(side*(x-.02),y+.12,-.025),(side*(x+.04),y+.20,-.015)],[.043,.027,.002],[.022,.019,.002],trim,h,6)
  if style=='devil':
   # The web is compact; supporting bones share the same shape transform.
   for obj in h.children:
    if obj.type=='MESH' and ('LeadingArm' in obj.name or 'WebVein' in obj.name):
     for v in obj.data.vertices:v.co.x*=.86;v.co.z*=.91
  join_by_material(h)
  folded=-side*1.32
  clips(h,{'WingOpen':[(1,folded),(21,0)],'WingGlide':[(1,0),(31,side*.045),(61,0)],'WingFold':[(1,0),(21,folded)]})
 save('wings-'+style)

if __name__=='__main__':
 requested=sys.argv[sys.argv.index('--')+2:]
 for name in requested or ['fox','rabbit','angel','parakeet','devil','dragon','elephant','glow']:
  avatar(name) if name in ['fox','rabbit'] else wings(name)
