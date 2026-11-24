import {CatmullRomCurve3,Vector3,Quaternion,Matrix4} from 'three';
import type {Pickup} from './types';
/** rail: [left, right] guard rails. fork: id of the branch whose road overlaps this frame (lanes merge there). */
export interface TrackFrame {s:number;p:Vector3;tangent:Vector3;up:Vector3;right:Vector3;width:number;gap:boolean;section:string;rotation:Quaternion;rail:[boolean,boolean];fork:number}
/** Side is the sign of the lateral offset: negative = driver's left. */
export const railed=(f:TrackFrame,side:number)=>f.rail[side<0?0:1];
export interface Branch {id:number;start:number;end:number;side:number;entry:number;samples:TrackFrame[]}
export const mod=(n:number,m:number)=>(n%m+m)%m;
const smooth=(n:number)=>n*n*(3-2*n);
export class Track {
 samples:TrackFrame[]=[];length=0;zones:{kind:'loop'|'gap';start:number;end:number}[]=[];checkpoints:number[]=[];pickups:Pickup[]=[];branches:Branch[]=[];obstacles:{s:number;phase:number}[]=[];
 constructor(){
  const raw:{p:Vector3;up:Vector3;section:string}[]=[];
  const add=(p:Vector3,up=new Vector3(0,1,0),section='skyway')=>raw.push({p,up,section});
  for(let z=0;z<150;z+=2)add(new Vector3(0,24,z));
  for(let i=0;i<=240;i++){const a=i/240*Math.PI*2;add(new Vector3(36*smooth(i/240),24+42*(1-Math.cos(a)),150+42*Math.sin(a)),new Vector3(0,Math.cos(a),-Math.sin(a)),'loop')}
  const curve=new CatmullRomCurve3([new Vector3(36,24,150),new Vector3(36,24,235),new Vector3(38,38,310),new Vector3(60,27,390),new Vector3(160,58,460),new Vector3(290,125,395),new Vector3(355,145,240),new Vector3(340,60,70),new Vector3(300,28,-100),new Vector3(210,25,-220),new Vector3(80,40,-260),new Vector3(-80,66,-250),new Vector3(-185,54,-175),new Vector3(-150,36,-95),new Vector3(-60,27,-80),new Vector3(-8,24,-48),new Vector3(0,24,-22),new Vector3(0,24,0)],false,'centripetal');
  const count=Math.ceil(curve.getLength()/2);
  for(let i=1;i<=count;i++)add(curve.getPointAt(i/count));
  let s=0;
  for(let i=0;i<raw.length;i++){
   if(i)s+=raw[i].p.distanceTo(raw[i-1].p);
   const a=raw[Math.max(0,i-1)].p,b=raw[Math.min(raw.length-1,i+1)].p;
   const tangent=b.clone().sub(a).normalize();
   if(i===0||i===raw.length-1)tangent.set(0,0,1);
   // Models face local +Z, so local +X is the driver's LEFT; `right` below is the driver's real right.
   let left=raw[i].up.clone().cross(tangent).normalize();
   let up=tangent.clone().cross(left).normalize();
   if(raw[i].section!=='loop'){
    const bank=Math.sin(i/count*Math.PI*6)*.4*Math.min(1,Math.max(0,(raw[i].p.x-70)/50));
    up.applyAxisAngle(tangent,bank);left=up.clone().cross(tangent).normalize();
   }
   const rotation=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(left,up,tangent));
   this.samples.push({s,p:raw[i].p,tangent,up,right:left.clone().negate(),rotation,width:15,gap:false,section:raw[i].section,rail:[true,true],fork:0});
  }
  this.length=s;
  for(const f of this.samples){
   if(f.p.z>324&&f.p.z<347&&f.p.x<50&&f.section!=='loop'){f.gap=true;f.section='jump'}
   if(f.s>this.length*.49&&f.s<this.length*.58)f.section='tunnel';
   if(f.s>this.length*.66&&f.s<this.length*.73){f.width=7.5;f.section='bridge'}
   if(f.p.y>100&&f.p.x>300)f.section='descent';
  }
  for(const f of this.samples)if(f.gap||f.section==='bridge')f.rail=[false,false];
  // Rails funnel cars onto the narrow bridge instead of dropping the width in a single step.
  const bridge=this.samples.filter(f=>f.section==='bridge'),bs=bridge[0].s,be=bridge[bridge.length-1].s;
  for(const f of this.samples){
   if(f.s>bs-40&&f.s<bs)f.width=15-7.5*smooth((f.s-(bs-40))/40);
   if(f.s>be&&f.s<be+25)f.width=7.5+7.5*smooth((f.s-be)/25);
  }
  for(const kind of ['loop','gap'] as const){
   const inside=this.samples.filter(f=>kind==='gap'?f.gap:f.section==='loop');
   if(inside.length)this.zones.push({kind,start:inside[0].s,end:inside[inside.length-1].s});
  }
  this.checkpoints=Array.from({length:12},(_,i)=>i*this.length/12);
  const kinds:Pickup['kind'][]=['speed','nitro','super','shield','grip','item'];
  for(let i=0;i<30;i++)this.pickups.push({id:`p${i}`,s:(65+i*(this.length-90)/30),lateral:i%3===0?0:i%2?3:-3,kind:kinds[i%6]});
  const jump=this.samples.find(f=>f.gap)!;
  this.pickups.push({id:'jump-super',s:jump.s-28,lateral:0,kind:'super'});
  this.obstacles=[{s:this.length*.45,phase:0},{s:this.length*.63,phase:2},{s:this.length*.87,phase:4}];
  this.makeBranch(1,.585,.637,30,8);this.makeBranch(2,.78,.85,-35,-12);
 }
 /** A side exit: it opens sideways inside the outer lane, climbs or dives away, and merges back the same way. */
 private makeBranch(id:number,a:number,b:number,side:number,height:number){
  const start=this.length*a,end=this.length*b,first=this.sample(start),last=this.sample(end),sign=Math.sign(side),offset=4.5,secret=id===2;
  const at=(f:TrackFrame,forward:number,lateral:number,lift=0)=>f.p.clone().addScaledVector(f.tangent,forward).addScaledVector(f.right,sign*lateral).addScaledVector(f.up,lift);
  const mid=first.p.clone().lerp(last.p,.5).addScaledVector(first.right,side);mid.y+=height;
  const path=new CatmullRomCurve3([at(first,0,offset),at(first,22,offset+11,height*.12),mid,at(last,-22,offset+11,height*.12),at(last,0,offset)],false,'centripetal');
  const frames:TrackFrame[]=[];
  for(let i=0;i<=100;i++){const t=i/100,p=path.getPoint(t),tangent=path.getTangent(t),left=new Vector3(0,1,0).cross(tangent).normalize(),up=tangent.clone().cross(left),rotation=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(left,up,tangent));frames.push({s:start+t*(end-start),p,tangent,right:left.clone().negate(),up,rotation,width:secret?6:10,gap:false,section:secret?'secret':'alternate',rail:secret?[false,false]:[true,true],fork:0})}
  const branch:Branch={id,start,end,side:sign,entry:start,samples:frames};
  // Where both roads overlap, the shared edge has no rails so cars can merge in either direction.
  const inner=sign>0?0:1,outer=1-inner;
  for(const f of frames){const m=this.sample(f.s),lateral=f.p.clone().sub(m.p).dot(m.right);if(Math.abs(lateral)<m.width/2+f.width/2+.5&&Math.abs(f.p.y-m.p.y)<3){f.fork=id;f.rail[inner]=false;if(f.s<(start+end)/2)branch.entry=f.s}}
  this.branches.push(branch);
  for(const m of this.samples)if(m.s>=start&&m.s<=end){const f=this.sample(m.s,id),lateral=f.p.clone().sub(m.p).dot(m.right);if(Math.abs(lateral)<m.width/2+f.width/2+.5&&Math.abs(f.p.y-m.p.y)<3){m.fork=id;m.rail[outer]=false}}
 }
 sample(distance:number,route=0):TrackFrame{
  const s=mod(distance,this.length);const branch=this.branches.find(b=>b.id===route&&s>=b.start&&s<=b.end);const list=branch?.samples??this.samples;
  let lo=0,hi=list.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(list[mid].s<=s)lo=mid;else hi=mid}
  const a=list[lo],b=list[hi],t=Math.max(0,Math.min(1,(s-a.s)/(b.s-a.s||1))),rotation=a.rotation.clone().slerp(b.rotation,t);
  return {s,p:a.p.clone().lerp(b.p,t),rotation,right:new Vector3(-1,0,0).applyQuaternion(rotation),up:new Vector3(0,1,0).applyQuaternion(rotation),tangent:new Vector3(0,0,1).applyQuaternion(rotation),width:a.width+(b.width-a.width)*t,gap:a.gap||b.gap,section:a.section,rail:a.rail,fork:a.fork};
 }
/** Moves a respawn point out of the loop (needs momentum) and away from jump gaps (needs a run-up). */
 safeDistance(distance:number,limit=Infinity):number{
  const lap=Math.floor(distance/this.length)*this.length;let s=distance-lap;
  for(const zone of this.zones){
   if(zone.kind==='loop'&&s>zone.start-4&&s<zone.end)s=zone.start-12;
   if(zone.kind==='gap'&&s>zone.start-45&&s<zone.end+6)s=zone.end+12;
  }
  return Math.max(0,Math.min(lap+s,limit));
 }
 routeScale(s:number,route:number){const b=this.branches.find(b=>b.id===route&&s>=b.start&&s<=b.end);if(!b)return 1;const ds=1;return Math.max(.3,this.sample(s+ds,route).p.distanceTo(this.sample(s,route).p)/ds)}
}
