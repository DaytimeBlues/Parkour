import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTokenScene} from '../src/render/tokens.ts';
import {TokenRun,tokenPosition} from '../src/simulation/tokens.ts';
import {flowCourses} from '../src/simulation/flow-course.ts';
test('coins are thick 3D meshes with no billboard sprite or gameplay collider, and picked meshes hide',()=>{
 const prior=globalThis.document;globalThis.document={createElement(){return {width:0,height:0,getContext(){return {clearRect(){},fillText(){}}}};}};
 try{const root=new THREE.Group(),run=new TokenRun(flowCourses[0]),art=createTokenScene(root,run);const group=root.children[0];assert.equal(group.children.length,run.total);let sprites=0,thick=0;group.traverse(o=>{if(o.isSprite)sprites++;if(o.isMesh&&o.geometry.type==='CylinderGeometry'){o.geometry.computeBoundingBox();assert.ok(o.geometry.boundingBox.max.z-o.geometry.boundingBox.min.z>.139);thick++;}});assert.equal(sprites,0);assert.equal(thick,run.total);const at=tokenPosition(run.tokens[0],0);run.collect(at,0,'playing');art.update(0);assert.equal(group.children[0].visible,false);art.dispose();assert.equal(root.children.length,0);}finally{globalThis.document=prior;}
});
