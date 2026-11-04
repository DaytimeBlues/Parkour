"""Verify saved editable files export the same GLBs as the deterministic generator.
blender -b -noaudio --python ... -- INPUT OUTPUT
"""
import bpy,sys,os,importlib.util
args=sys.argv[sys.argv.index('--')+1:];src=os.path.abspath(args[0]);out=os.path.abspath(args[1]);os.makedirs(out,exist_ok=True)
# Import without generating; provide its supported OUTPUT argument.
sys.argv=sys.argv[:sys.argv.index('--')+1]+[out]
spec=importlib.util.spec_from_file_location('animated_author',os.path.join(os.path.dirname(__file__),'generate_animated_assets.py'));author=importlib.util.module_from_spec(spec);spec.loader.exec_module(author)
for filename in sorted(os.listdir(src)):
 if filename.endswith('.blend'):
  bpy.ops.wm.open_mainfile(filepath=os.path.join(src,filename));author.save(filename[:-6])
