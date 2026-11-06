import * as THREE from 'three';

type RingTeam='red'|'blue'|null;

/** Cosmetic foot markers, separate from the animated body and all collision.
 * One opaque, depth-tested draw per player; resources belong to this factory.
 * The neutral preview must not imply a team assignment before joining a room.
 */
export function createTeamGroundRings(){
  const material=new THREE.MeshBasicMaterial({vertexColors:true,depthTest:true,depthWrite:true,toneMapped:false});
  function geometry(team:RingTeam){
    const positions:number[]=[],colours:number[]=[];
    const colour=new THREE.Color(team==='red'?0xef675d:team==='blue'?0x50b8f5:0xc7d0da),outline=new THREE.Color(0x172330);
    function triangle(a:number[],b:number[],c:number[],tint:THREE.Color){
      positions.push(...a,...b,...c);for(let i=0;i<3;i++)colours.push(tint.r,tint.g,tint.b);
    }
    for(const [inner,outer,tint] of [[.52,.54,outline],[.54,.70,colour],[.70,.72,outline]] as const){
      for(let i=0;i<32;i++){
        const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
        const ia=[inner*Math.cos(a),0,inner*Math.sin(a)],oa=[outer*Math.cos(a),0,outer*Math.sin(a)];
        const ib=[inner*Math.cos(b),0,inner*Math.sin(b)],ob=[outer*Math.cos(b),0,outer*Math.sin(b)];
        triangle(oa,ia,ob,tint);triangle(ia,ib,ob,tint);
      }
    }
    // A small forward glyph distinguishes teams without relying only on colour.
    if(team==='red')triangle([-.06,0,-.79],[.06,0,-.79],[0,0,-.90],colour);
    if(team==='blue'){
      triangle([-.055,0,-.79],[.055,0,-.79],[.055,0,-.90],colour);
      triangle([-.055,0,-.79],[.055,0,-.90],[-.055,0,-.90],colour);
    }
    const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));result.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));result.computeVertexNormals();result.computeBoundingBox();result.computeBoundingSphere();return result;
  }
  const geometries={red:geometry('red'),blue:geometry('blue'),neutral:geometry(null)};let disposed=false;
  return {
    create(team:RingTeam){
      if(disposed)throw new Error('Team ground rings disposed');
      const marker=new THREE.Mesh(geometries[team??'neutral'],material);
      marker.name=team==='red'?'triangle-team-marker':team==='blue'?'square-team-marker':'neutral-team-marker';
      marker.position.y=.025;marker.userData.team=team;marker.userData.shape=team==='red'?'triangle':team==='blue'?'square':'circle';return marker;
    },
    dispose(){if(disposed)return;disposed=true;for(const value of Object.values(geometries))value.dispose();material.dispose();}
  };
}
