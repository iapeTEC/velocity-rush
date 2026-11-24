import type { RaceResult } from './types';

export interface RankingEntry {
  uid: string;
  name: string;
  bestLap: number;
  bestRace: number;
  races: number;
  victories: number;
  score: number;
  updatedAt: number;
  mode: 'time-trial' | 'multiplayer';
}

type Reply = { ok: boolean; error?: string; pending?: boolean; ticket?: string; entries?: RankingEntry[] };

export class Leaderboard {
  constructor(private readonly url: string) {}

  private endpoint(params: Record<string,string>): string {
    if (!this.url) throw new Error('Ranking global não configurado.');
    const url = new URL(this.url);
    if (url.protocol !== 'https:') throw new Error('O ranking exige HTTPS.');
    Object.entries(params).forEach(([key,value]) => url.searchParams.set(key,value));
    return url.toString();
  }

  private async read(params: Record<string,string>): Promise<Reply> {
    const response = await fetch(this.endpoint(params), { redirect:'follow', credentials:'omit', signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Ranking indisponível.');
    return response.json() as Promise<Reply>;
  }

  async list(): Promise<RankingEntry[]> {
    const reply = await this.read({action:'list'});
    if (!reply.ok || !Array.isArray(reply.entries)) throw new Error(reply.error || 'Resposta inválida do ranking.');
    return reply.entries;
  }

  private async post(action: string, values: Record<string, unknown>): Promise<Reply> {
    const requestId = crypto.randomUUID();
    let reply: Reply | undefined;
    try {
      const response = await fetch(this.endpoint({}), {
        method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'},
        body:JSON.stringify({action,requestId,...values}), credentials:'omit', redirect:'follow', signal:AbortSignal.timeout(30000)
      });
      if (response.ok && response.type !== 'opaque') reply = await response.json() as Reply;
    } catch { /* A redirect may be unreadable after the server committed. Verify its receipt. */ }
    if (!reply) {
      for (let i=0;i<5;i++) {
        await new Promise(resolve => setTimeout(resolve,800*(i+1)));
        try { reply=await this.read({action:'status',requestId}); } catch { continue; }
        if (!reply.pending) break;
      }
    }
    if (!reply?.ok) throw new Error(reply?.error || 'Envio não confirmado pelo servidor; o resultado não foi marcado como salvo.');
    return reply;
  }

  async begin(idToken: string, roomCode?: string): Promise<string> {
    const reply=await this.post('begin',{idToken,roomCode});
    if (!reply.ticket) throw new Error('Servidor não emitiu ticket de largada.');
    return reply.ticket;
  }

  async submit(idToken: string, ticket: string, result: RaceResult, proof?: unknown): Promise<unknown> {
    return this.post('submit',{idToken,ticket,result,proof});
  }
}
