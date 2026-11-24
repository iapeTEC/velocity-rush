import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, inMemoryPersistence, setPersistence, signInAnonymously, type Auth } from 'firebase/auth';
import { connectDatabaseEmulator, get, getDatabase, onDisconnect, onValue, ref, remove, runTransaction, set, update, type Database, type Unsubscribe } from 'firebase/database';
import type { PlayerState, Profile, RoomData, RoomPlayer, Trap } from './types';
import { claimSlot, electHost, normalizeCode, PublishGate, sanitizeProfile, sanitizeState, sanitizeTrap, SnapshotBuffer } from './network-utils';

interface Race {status:RoomData['status'];startAt:number;roster?:Record<string,string>}
interface Lobby {code:string;host:string;createdAt:number;race:Race;slots:Record<string,RoomPlayer>}
/** RTDB returns integer-keyed objects as arrays, with null holes for empty slots. */
const slotEntries=(lobby:Lobby|null):[string,RoomPlayer][]=>Object.entries(lobby?.slots??{}).filter((entry):entry is [string,RoomPlayer]=>!!entry[1]&&typeof entry[1].uid==='string');
export interface MultiplayerConfig extends FirebaseOptions {emulator?:{host?:string;databasePort?:number;authPort?:number}}

/** Firebase transport. All timestamps are milliseconds on the database server clock. */
export class Multiplayer {
  readonly uid:string;
  latency=0;
  connected=false;
  room:RoomData|null=null;
  onRoom:(room:RoomData|null)=>void=()=>{};
  onStates:(states:PlayerState[])=>void=()=>{};
  onTrap:(trap:Trap)=>void=()=>{};
  onError:(message:string)=>void=()=>{};
  private offset=0;
  private code:string|null=null;
  private slot:string|null=null;
  private raw:Lobby|null=null;
  private listeners:Unsubscribe[]=[];
  private timer:ReturnType<typeof setInterval>|null=null;
  private frames=new SnapshotBuffer();
  private gate=new PublishGate();
  private seenTraps=new Set<string>();
  private publishing=false;
  private maintaining=false;
  private receiptSent=false;
  private finishing=false;
  private inflight:Promise<void>=Promise.resolve();
  private lastPublished=-Infinity;
  private lastTrapAt=-Infinity;
  private pendingPresence:Promise<void>=Promise.resolve();

  private constructor(private db:Database,private auth:Auth){
    this.uid=auth.currentUser!.uid;
    onValue(ref(db,'.info/serverTimeOffset'),snap=>{this.offset=Number(snap.val())||0;});
    onValue(ref(db,'.info/connected'),snap=>{
      this.connected=snap.val()===true;
      if(this.connected&&this.slot!==null&&this.code) this.pendingPresence=this.armPresence().catch(e=>this.report(e));
    });
  }
  static async connect(config:object):Promise<Multiplayer>{
    const {emulator,...options}=config as MultiplayerConfig;
    if(!options.projectId||!options.apiKey||!options.databaseURL) throw new Error('Configure projectId, apiKey e databaseURL do Firebase.');
    const app=initializeApp(options,`velocity-${crypto.randomUUID()}`);
    const auth=getAuth(app),db=getDatabase(app);
    if(emulator){const host=emulator.host??'127.0.0.1';connectAuthEmulator(auth,`http://${host}:${emulator.authPort??9099}`,{disableWarnings:true});connectDatabaseEmulator(db,host,emulator.databasePort??9000);}
    await setPersistence(auth,inMemoryPersistence);
    await signInAnonymously(auth);
    return new Multiplayer(db,auth);
  }
  now():number{return Date.now()+this.offset;}
  async getIdToken():Promise<string>{return this.auth.currentUser!.getIdToken();}
  private report(error:unknown):void {this.onError(error instanceof Error?error.message:String(error));}

  async create(profile:Profile):Promise<string>{
    const clean=sanitizeProfile(profile);
    await this.leave();
    for(let attempt=0;attempt<8;attempt++){
      // Rejection sampling keeps all 26 letters equally likely.
      let code='';while(code.length<6){const byte=crypto.getRandomValues(new Uint8Array(1))[0];if(byte<234)code+=String.fromCharCode(65+byte%26);}
      const lobby:Lobby={code,host:this.uid,createdAt:this.now(),race:{status:'lobby',startAt:0},slots:{'0':claimSlot(null,this.uid,clean,this.now())!}};
      const result=await runTransaction(ref(this.db,`lobbies/${code}`),current=>current?undefined:lobby,{applyLocally:false});
      if(result.committed){await this.adopt(code,'0');return code;}
    }
    throw new Error('Não foi possível gerar uma sala. Tente novamente.');
  }
  async join(invitation:string,profile:Profile):Promise<void>{
    const code=normalizeCode(invitation),clean=sanitizeProfile(profile);
    await this.leave();
    const initial=(await get(ref(this.db,`lobbies/${code}`))).val() as Lobby|null;
    if(!initial) throw new Error('Sala não encontrada.');
    if(initial.race.status!=='lobby') throw new Error('Esta corrida já começou. Crie outra sala para a próxima.');
    for(let i=0;i<4;i++){
      const slot=String(i);
      try{
        const result=await runTransaction(ref(this.db,`lobbies/${code}/slots/${slot}`),current=>claimSlot(current,this.uid,clean,this.now()),{applyLocally:false});
        if(result.committed){await this.adopt(code,slot);return;}
      }catch(error){
        // A concurrent claim can win before our transaction is authorized.
        const current=(await get(ref(this.db,`lobbies/${code}`))).val() as Lobby|null;
        if(!current||current.race.status!=='lobby')throw new Error('A corrida começou durante a entrada.');
        if(!String(error).includes('permission_denied')&&!String(error).includes('PERMISSION_DENIED'))throw error;
      }
    }
    throw new Error('Sala cheia: máximo de quatro pilotos.');
  }
  private async adopt(code:string,slot:string):Promise<void>{
    this.code=code;this.slot=slot;this.receiptSent=false;this.finishing=false;this.lastPublished=-Infinity;this.gate=new PublishGate();this.lastTrapAt=-Infinity;
    try{await this.armPresence();}catch(error){await remove(ref(this.db,`lobbies/${code}/slots/${slot}`)).catch(()=>{});this.resetRoom();throw error;}
    this.listeners.push(onValue(ref(this.db,`lobbies/${code}`),snap=>{
      const value=snap.val() as Lobby|null;
      if(!value||!slotEntries(value).some(([,p])=>p.uid===this.uid)){
        this.resetRoom();this.onError('Sua vaga foi liberada após a desconexão. Entre novamente.');return;
      }
      this.raw=value;
      const players=Object.fromEntries(slotEntries(value).map(([,p])=>[p.uid,p]));
      this.room={code:value.code,host:value.host,createdAt:value.createdAt,status:value.race.status,startAt:value.race.startAt,players};
      this.onRoom(this.room);
      void this.maintain();
    },e=>this.report(e)));
    this.listeners.push(onValue(ref(this.db,`states/${code}`),snap=>{
      const states=Object.values(snap.val()??{}) as PlayerState[];
      this.frames.push(states.filter(s=>s.id!==this.uid&&this.room?.players[s.id]?.connected).map(s=>({...s,item:s.item??null})));
    },e=>this.report(e)));
    this.listeners.push(onValue(ref(this.db,`traps/${code}`),snap=>{
      for(const trap of Object.values(snap.val()??{}) as Trap[])if(trap.owner!==this.uid&&trap.expiresAt>this.now()&&!this.seenTraps.has(trap.id)){
        this.seenTraps.add(trap.id);this.onTrap(trap);
      }
      if(this.seenTraps.size>512)this.seenTraps=new Set([...this.seenTraps].slice(-256));
    },e=>this.report(e)));
    this.timer=setInterval(()=>{
      this.onStates(this.frames.sample(this.now()).filter(s=>this.room?.players[s.id]?.connected));
      void this.maintain();
    },1000/30);
  }
  private async armPresence():Promise<void>{
    if(!this.code||this.slot===null)return;
    const presence=ref(this.db,`lobbies/${this.code}/slots/${this.slot}`);
    // Register server-side cleanup before announcing that the connection is live.
    await onDisconnect(presence).update({connected:false,ready:false});
    await update(presence,{connected:true});
  }
  private async maintain():Promise<void>{
    if(this.maintaining||!this.connected||!this.raw||!this.room||!this.code)return;
    this.maintaining=true;
    const code=this.code,room=this.room;
    try{
      if(!room.players[room.host]?.connected&&electHost(room.players)===this.uid){
        await runTransaction(ref(this.db,`lobbies/${code}/host`),old=>old===room.host?this.uid:undefined,{applyLocally:false});
      }
      if(room.host===this.uid&&room.status==='countdown'&&this.now()>=room.startAt){
        await runTransaction(ref(this.db,`lobbies/${code}/race`),(race:Race|null)=>race?.status==='countdown'?{...race,status:'racing'}:undefined,{applyLocally:false});
      }
    }catch(error){if(this.code===code)this.report(error);}finally{this.maintaining=false;}
  }
  async setReady(ready:boolean):Promise<void>{
    if(!this.code||this.slot===null||this.room?.status!=='lobby')throw new Error('Você precisa estar no lobby.');
    await update(ref(this.db,`lobbies/${this.code}/slots/${this.slot}`),{ready:!!ready});
  }
  async updateProfile(profile:Profile):Promise<void>{
    if(!this.code||this.slot===null||this.room?.status!=='lobby')throw new Error('Altere seu perfil antes da largada.');
    await update(ref(this.db,`lobbies/${this.code}/slots/${this.slot}`),{profile:sanitizeProfile(profile),ready:false});
  }
  async start():Promise<void>{
    const room=this.room,raw=this.raw,code=this.code;
    if(!room||!raw||!code||room.host!==this.uid)throw new Error('Somente o anfitrião pode iniciar.');
    const active=slotEntries(raw).filter(([,p])=>p.connected);
    if(room.status!=='lobby'||!active.length||active.some(([,p])=>!p.ready))throw new Error('Todos os pilotos devem estar prontos.');
    const roster=Object.fromEntries(active.map(([slot,p])=>[slot,p.uid]));
    const result=await runTransaction(ref(this.db,`lobbies/${code}/race`),(race:Race|null)=>race?.status==='lobby'?{status:'countdown',startAt:this.now()+5000,roster}:undefined,{applyLocally:false});
    if(!result.committed)throw new Error('A largada já foi iniciada.');
  }
  publish(state:PlayerState):void{
    if(!this.code||!this.connected||this.publishing||this.finishing||this.receiptSent||!this.gate.take(this.now()))return;
    const code=this.code;
    let clean:PlayerState;
    try{clean=sanitizeState(state,this.uid,this.now());}catch(error){this.report(error);return;}
    this.publishing=true;
    const began=Date.now();
    this.inflight=set(ref(this.db,`states/${code}/${this.uid}`),clean).then(()=>{
      this.latency=Date.now()-began;
      if(this.code===code)this.lastPublished=clean.timestamp;
    }).catch(error=>this.report(error)).finally(()=>{this.publishing=false;});
  }
  /**
   * Publishes the final state and the immutable arrival receipt. The rules accept the
   * receipt only when it matches the stored state, so periodic publishing pauses here.
   */
  async finish(state:PlayerState):Promise<void>{
    if(!this.code||this.receiptSent||this.finishing)return;
    const code=this.code;
    this.finishing=true;
    const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
    try{
      await this.inflight;
      for(let attempt=0;;attempt++){
        const wait=this.lastPublished+150-this.now();
        if(wait>0)await pause(wait);
        if(this.code!==code)return;
        const clean=sanitizeState(state,this.uid,this.now());
        try{
          await set(ref(this.db,`states/${code}/${this.uid}`),clean);
          this.lastPublished=clean.timestamp;
          // An existing receipt means an earlier attempt already committed.
          await runTransaction(ref(this.db,`receipts/${code}/${this.uid}`),old=>old?undefined:clean,{applyLocally:false});
          if(this.code===code)this.receiptSent=true;
          return;
        }catch(error){
          if(attempt>=2)throw error;
          await pause(500);
        }
      }
    }finally{this.finishing=false;}
  }
  async sendTrap(trap:Trap):Promise<void>{
    if(!this.code||!this.connected)throw new Error('Você está desconectado.');
    const now=this.now();
    if(now-this.lastTrapAt<500)throw new Error('Aguarde antes de usar outro item.');
    const clean=sanitizeTrap(trap,this.uid,now);
    this.lastTrapAt=now;
    await set(ref(this.db,`traps/${this.code}/${this.uid}`),clean);
  }
  async leave():Promise<void>{
    const code=this.code,slot=this.slot;
    this.resetRoom();
    if(code&&slot!==null){
      await this.pendingPresence;
      // Keep immutable receipts for ranking; remove only this client's ephemeral state.
      await Promise.all([remove(ref(this.db,`states/${code}/${this.uid}`)),remove(ref(this.db,`traps/${code}/${this.uid}`))]);
      await remove(ref(this.db,`lobbies/${code}/slots/${slot}`));
      await onDisconnect(ref(this.db,`lobbies/${code}/slots/${slot}`)).cancel();
    }
  }
  private resetRoom():void{
    for(const stop of this.listeners)stop();this.listeners=[];
    if(this.timer)clearInterval(this.timer);this.timer=null;
    this.code=null;this.slot=null;this.raw=null;this.room=null;this.frames.clear();this.seenTraps.clear();
    this.onRoom(null);this.onStates([]);
  }
}
