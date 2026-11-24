import {Body,Box,Vec3,World} from 'cannon-es';
import {Vector3,Euler,Quaternion} from 'three';
import {Track,mod,railed} from './track';
import type {Booster,Controls,Item,PlayerState,Profile,Trap,V3} from './types';
export const ITEMS:Item[]=['oil','emp','ice','block','shockwave','slow','orb','switch'];
export const ITEM_NAMES:Record<Item,string>={oil:'Oil Spill',emp:'EMP Trap',ice:'Ice Trap',block:'Road Block',shockwave:'Shockwave',slow:'Slow Zone',orb:'Homing Orb',switch:'Trap Switch'};
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
export class Simulation {
 state:PlayerState;track:Track;world=new World({gravity:new Vec3(0,-28,0)});body:Body;
 distance=0;lateral=0;lateralVelocity=0;route=0;airborne=false;airTime=0;flight:'ballistic'|'physics'='physics';jumpHeight=0;jumpVelocity=0;time=0;lapTimes:number[]=[];proof:{laps:number[];checkpoints:number[][]}={laps:[],checkpoints:[]};
 traps:Trap[]=[];events:string[]=[];remotes:PlayerState[]=[];
 private effects:Record<string,number>={};private collected=new Map<string,number>();private hit=new Set<string>();private lastItem=-10;private checkpointDistance=0;private nextGate=1;private lapStart=0;private lapPenalty=0;private lastRespawn=-10;private currentProof:number[]=[];private obstacleCooldown=0;private lastScrape=-10;
 constructor(track:Track,profile:Profile,id:string){
  this.track=track;this.body=new Body({mass:180,shape:new Box(new Vec3(.9,.45,1.8)),linearDamping:.03,angularDamping:.8});this.world.addBody(this.body);
  const f=track.sample(0);this.state={id,...profile,position:f.p.clone().addScaledVector(f.up,.45).toArray() as V3,rotation:f.rotation.toArray(),velocity:[0,0,0],s:0,speed:0,lap:1,progress:0,nitro:70,item:null,drifting:false,boosting:false,shield:false,grip:false,finished:false,raceTime:0,bestLap:0,penalty:0,checkpoint:0,connected:true,timestamp:0};this.syncBody();
 }
 private syncBody(){this.body.position.set(...this.state.position);this.body.quaternion.set(...this.state.rotation);this.body.velocity.set(...this.state.velocity)}
 addTrap(t:Trap){if(!this.traps.some(x=>x.id===t.id))this.traps.push({...t,position:[...t.position]})}
 applyBooster(kind:Booster){
  if(kind==='nitro')this.state.nitro=clamp(this.state.nitro+38,0,100);
  else this.effects[kind]=this.time+({speed:3,super:2.5,shield:7,grip:7}[kind]);
  this.events.push(kind);
 }
 useItem(now=Date.now()):Trap|null{
  if(!this.state.item||this.time-this.lastItem<5||this.state.finished)return null;
  const kind=this.state.item;this.state.item=null;this.lastItem=this.time;
  const s=mod(this.state.s-(kind==='shockwave'||kind==='switch'||kind==='orb'?0:7),this.track.length),f=this.track.sample(s,this.route);
  const pos=f.p.clone().addScaledVector(f.right,this.lateral).addScaledVector(f.up,.5);
  const target=this.remotes.filter(r=>r.progress>this.state.progress&&!r.finished).sort((a,b)=>a.progress-b.progress)[0];
  const trap:Trap={id:`${this.state.id}-${Math.round(now)}-${Math.floor(Math.random()*9999)}`,owner:this.state.id,kind,position:pos.toArray(),s,lateral:this.lateral,createdAt:now,expiresAt:now+(kind==='shockwave'?1000:kind==='orb'?6500:10000),...(target?{target:target.id}:{})};
  this.addTrap(trap);this.events.push(kind);return trap;
 }
 respawn(){
  if(this.state.finished||this.time-this.lastRespawn<1)return;
  this.lastRespawn=this.time;this.state.penalty+=5;this.distance=this.track.safeDistance(this.checkpointDistance,this.nextGate*this.track.length/12-1);this.route=0;this.lateral=0;this.lateralVelocity=0;this.airborne=false;this.airTime=0;this.jumpHeight=0;this.jumpVelocity=0;this.state.speed=0;
  const f=this.track.sample(this.distance);this.state.s=f.s;this.state.position=f.p.clone().addScaledVector(f.up,.45).toArray();this.state.rotation=f.rotation.toArray();this.state.velocity=[0,0,0];this.state.progress=this.distance/this.track.length;this.syncBody();this.events.push('respawn');
 }
 step(dt:number,input:Controls,now=Date.now()){
  if(this.state.finished)return;dt=clamp(dt,0,1/30);this.time+=dt;this.state.raceTime=this.time+this.state.penalty;
  const active=(k:string)=>(this.effects[k]??0)>this.time;
  const f=this.track.sample(this.distance,this.route);const previous=this.distance;
  const stun=active('emp'),ice=active('ice'),oil=active('oil'),slow=active('slow');
  this.state.shield=active('shield');this.state.grip=active('grip');
  this.state.boosting=input.nitro&&this.state.nitro>0&&input.throttle>0&&!stun;
  this.state.drifting=input.drift&&Math.abs(this.state.speed)>16&&!this.airborne;
  const vehicle=this.state.vehicle;
  let acceleration=vehicle==='phantom'?31:vehicle==='titan'?24:28;
  const boosted=active('speed')||active('super')||this.state.boosting;
  if(boosted)acceleration*=1.8;
  const max=active('super')?112:boosted?94:vehicle==='phantom'?70:vehicle==='titan'?76:73;
  if(this.state.boosting)this.state.nitro=Math.max(0,this.state.nitro-dt*23);
  else this.state.nitro=Math.min(100,this.state.nitro+dt*(this.state.drifting&&Math.abs(input.steer)>.12?11:1.5));
  if(!this.airborne){
   const throttle=clamp(input.throttle,-1,1);
   this.state.speed+=throttle*(throttle<0&&this.state.speed>0?60:acceleration)*dt;
   this.state.speed-=this.state.speed*(input.brake?.95:.11)*dt;
   this.state.speed-=f.tangent.y*18*dt;
   if(this.state.drifting)this.state.speed*=1-dt*.15;
   if(stun||slow)this.state.speed*=Math.exp(-dt*(stun?1.8:.9));
   this.state.speed=clamp(this.state.speed,-14,max);
   const steer=clamp(input.steer,-1,1)*(ice?.25:1);
   const target=steer*(this.state.drifting?16:11)*Math.min(1,Math.abs(this.state.speed)/20);
   const response=this.state.grip?14:oil?1.3:this.state.drifting?3:8;
   this.lateralVelocity+=(target-this.lateralVelocity)*Math.min(1,dt*response);
   if(oil)this.lateralVelocity+=Math.sin(this.time*7)*dt*8;
   this.lateral+=this.lateralVelocity*dt;
   const edge=f.width/2-1.05;
   if(railed(f,this.lateral)&&Math.abs(this.lateral)>edge){
    const impact=Math.sign(this.lateralVelocity)===Math.sign(this.lateral)?Math.abs(this.lateralVelocity):0;
    this.lateral=Math.sign(this.lateral)*edge;
    if(impact>0){this.lateralVelocity*=-.35;this.state.speed*=1-Math.min(.35,impact*.012);if(impact>6&&this.time-this.lastScrape>.35){this.lastScrape=this.time;this.events.push('collision')}}
   }
  }
  this.distance=Math.max(0,this.distance+this.state.speed*dt/this.track.routeScale(f.s,this.route));
  const next=this.track.sample(this.distance,this.route);
  this.switchRoute(next);
  const frame=this.track.sample(this.distance,this.route);
  if(!this.airborne){
   // Gap jumps fly in track coordinates so landings stay predictable on curves; leaving the road uses Cannon-es.
   if(frame.gap){this.airborne=true;this.flight='ballistic';this.airTime=0;this.jumpHeight=0;this.jumpVelocity=9;this.events.push('jump')}
   else if(Math.abs(this.lateral)>frame.width/2+.5)this.fall(frame,0);
  }
  if(this.airborne&&this.flight==='ballistic'){
   this.airTime+=dt;this.jumpVelocity-=28*dt;this.jumpHeight+=this.jumpVelocity*dt;this.lateral+=clamp(input.steer,-1,1)*3*dt;
   if(!frame.gap&&this.jumpHeight<=0&&this.jumpHeight>-1.5&&Math.abs(this.lateral)<frame.width/2){this.airborne=false;this.jumpHeight=0;this.lateralVelocity*=.5;this.events.push('land')}
   else if(this.jumpHeight<=-1.5)this.fall(frame,this.jumpVelocity);
   else{
    this.state.position=frame.p.clone().addScaledVector(frame.right,this.lateral).addScaledVector(frame.up,.45+this.jumpHeight).toArray();
    this.state.rotation=frame.rotation.clone().multiply(new Quaternion().setFromEuler(new Euler(clamp(-this.jumpVelocity*.012,-.25,.25),0,0))).toArray();
    this.state.velocity=frame.tangent.clone().multiplyScalar(this.state.speed).addScaledVector(frame.up,this.jumpVelocity).toArray();
   }
  }
  if(this.airborne&&this.flight==='physics'){
   this.airTime+=dt;this.body.force.set(frame.right.x*input.steer*500,frame.right.y*input.steer*500,frame.right.z*input.steer*500);this.world.step(dt);
   const pos=new Vector3(this.body.position.x,this.body.position.y,this.body.position.z),offset=pos.clone().sub(frame.p);
   this.lateral=offset.dot(frame.right);const height=offset.dot(frame.up);
   this.state.position=pos.toArray();this.state.velocity=[this.body.velocity.x,this.body.velocity.y,this.body.velocity.z];
   const q=new Quaternion(...this.state.rotation).slerp(frame.rotation,dt*2);this.state.rotation=q.toArray();
   if(!frame.gap&&height<=.7&&height>=-4&&Math.abs(this.lateral)<frame.width/2&&this.airTime>.2&&new Vector3(...this.state.velocity).dot(frame.up)<0){this.airborne=false;this.lateralVelocity*=.5;this.events.push('land')}
   else if(this.airTime>2.5||pos.y<-70)this.respawn();
  }
  if(!this.airborne){
   const pose=this.track.sample(this.distance,this.route);this.state.position=pose.p.clone().addScaledVector(pose.right,this.lateral).addScaledVector(pose.up,.45).toArray();
   const yaw=clamp(-this.lateralVelocity*.025,-.4,.4);const q=pose.rotation.clone().multiply(new Quaternion().setFromEuler(new Euler(0,yaw,0)));
   this.state.rotation=q.toArray();this.state.velocity=pose.tangent.clone().multiplyScalar(this.state.speed).addScaledVector(pose.right,this.lateralVelocity).toArray();this.syncBody();
  }
  this.state.s=mod(this.distance,this.track.length);this.state.progress=this.distance/this.track.length;
  if(this.distance>previous&&(!this.airborne||this.airTime<1.3))this.checkGates(previous);
  this.pickups();this.collisions(now,dt);this.state.timestamp=now;
 }
 /** Moves between the main road and a branch, converting the lateral offset through the car's world position. */
 private switchRoute(main:ReturnType<Track['sample']>){
  const convert=(from:ReturnType<Track['sample']>,route:number)=>{const world=from.p.clone().addScaledVector(from.right,this.lateral),to=this.track.sample(this.distance,route);this.lateral=world.sub(to.p).dot(to.right);this.route=route};
  for(const b of this.track.branches){
   if(this.route===0&&main.s>=b.start&&main.s<=b.entry&&Math.sign(this.lateral)===b.side&&Math.abs(this.lateral)>3.2){convert(main,b.id);this.events.push(b.id===2?'secret':'alternate');return}
   if(this.route===0&&main.fork===b.id&&!railed(main,b.side)&&this.lateral*b.side>main.width/2-1.05){convert(main,b.id);return}
   if(this.route!==b.id)continue;
   if(main.s>b.end||main.s<b.start){const end=b.samples[b.samples.length-1];const world=end.p.clone().addScaledVector(end.right,this.lateral);this.route=0;const to=this.track.sample(this.distance);this.lateral=world.sub(to.p).dot(to.right);return}
   const f=this.track.sample(this.distance,b.id);
   if(f.fork===b.id&&!railed(f,-b.side)&&-this.lateral*b.side>f.width/2-1.05){convert(f,0);return}
  }
 }
 private fall(frame:ReturnType<Track['sample']>,upward:number){
  this.airborne=true;this.flight='physics';this.airTime=0;this.syncBody();
  const velocity=frame.tangent.clone().multiplyScalar(this.state.speed).addScaledVector(frame.right,this.lateralVelocity).addScaledVector(frame.up,upward);
  this.body.velocity.set(velocity.x,velocity.y,velocity.z);this.body.angularVelocity.set(0,0,0);this.events.push('fall');
 }
 private checkGates(previous:number){
  const spacing=this.track.length/12;
  while(this.nextGate*spacing<=this.distance&&this.nextGate*spacing>previous){
   const index=this.nextGate%12;this.checkpointDistance=this.nextGate*spacing;this.state.checkpoint=index;this.nextGate++;
   // Proof is ordered by passage, with the start/finish gate last.
   this.currentProof.push((index+11)%12);this.events.push('checkpoint');
   if(index===0){
    const lap=this.time-this.lapStart+this.state.penalty-this.lapPenalty;this.lapTimes.push(lap);this.proof.laps.push(lap);this.proof.checkpoints.push([...this.currentProof]);this.currentProof=[];
    this.state.bestLap=Math.min(...this.lapTimes);this.lapStart=this.time;this.lapPenalty=this.state.penalty;
    if(this.lapTimes.length===3){this.state.finished=true;this.state.speed=0;this.state.lap=3;this.events.push('finish');break}
    this.state.lap=this.lapTimes.length+1;this.events.push('lap');
   }
  }
 }
 private pickups(){
  if(this.airborne)return;
  for(const p of this.track.pickups){const d=Math.abs(p.s-this.state.s);if(Math.min(d,this.track.length-d)>3.5||Math.abs(this.lateral-p.lateral)>3)continue;if(this.time-(this.collected.get(p.id)??-50)<18)continue;this.collected.set(p.id,this.time);
   if(p.kind==='item'){if(!this.state.item)this.state.item=ITEMS[Math.floor(Math.random()*ITEMS.length)];this.events.push('item')}
   else this.applyBooster(p.kind);
  }
 }
 private collisions(now:number,dt:number){
  const p=new Vector3(...this.state.position);
  this.traps=this.traps.filter(t=>t.expiresAt>now);
  for(const t of this.traps){
   if(t.kind==='orb'){
    const target=[this.state,...this.remotes].find(r=>r.id===t.target);if(target){const a=new Vector3(...t.position),b=new Vector3(...target.position);a.add(b.sub(a).normalize().multiplyScalar(80*dt));t.position=a.toArray()}
   }
   if(t.owner===this.state.id||this.hit.has(t.id))continue;
   if(t.kind==='switch'){this.effects.switch=this.time+(t.expiresAt-now)/1000;this.hit.add(t.id);continue}
   const radius=t.kind==='shockwave'?17:t.kind==='slow'?8:t.kind==='block'?4:3.5;
   if(p.distanceTo(new Vector3(...t.position))>radius)continue;this.hit.add(t.id);
   if(this.state.shield){this.events.push('shield');continue}
   if(t.kind==='shockwave'){this.lateralVelocity+=this.lateral>=t.lateral?19:-19;this.state.speed*=.8}
   else if(t.kind==='block'||t.kind==='orb'){this.state.speed*=.38;this.effects.emp=this.time+1.5}
   else this.effects[t.kind]=this.time+({oil:3.5,ice:3,emp:2.5,slow:3}[t.kind]??3);
   this.events.push('hit');
  }
  if(this.obstacleCooldown>this.time)return;
  for(const o of this.track.obstacles){
   const frame=this.track.sample(o.s),l=Math.sin(now/1000*1.6+o.phase)*frame.width*.38;
   if(p.distanceTo(frame.p.clone().addScaledVector(frame.right,l))<3.3&&!this.state.shield){this.state.speed*=.32;this.lateralVelocity+=(this.lateral>l?1:-1)*7;this.obstacleCooldown=this.time+1.5;this.events.push('hit')}
   if((this.effects.switch??0)>this.time&&Math.abs(this.state.s-o.s)<10&&!this.state.shield){this.state.speed*=.5;this.obstacleCooldown=this.time+2;this.events.push('hit')}
  }
  for(const remote of this.remotes){if(!remote.connected||remote.finished)continue;
   const other=new Vector3(...remote.position);if(p.distanceTo(other)<3.2){const frame=this.track.sample(this.state.s);const side=p.clone().sub(other).dot(frame.right);this.lateralVelocity+=(side>=0?1:-1)*dt*28;this.state.speed+=(remote.speed-this.state.speed)*dt*3;this.events.push('collision')}
  }
 }
}
