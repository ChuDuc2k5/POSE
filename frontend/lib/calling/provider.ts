import { simulator } from './providers/simulator';
import { telephonyConfigured } from '../../../backend/src/common/telephony';
export type CallEvent={event_id:string;provider_call_id:string;type:'ringing'|'answered'|'completed'|'busy'|'no_answer'|'failed'|'canceled';occurred_at:string;duration_seconds?:number;error_code?:string;cost?:{amount:number;currency:string;fx_rate?:number;fx_source?:string};transcript_turns?:unknown[];recording?:{object_key?:string;bytes?:string;checksum:string;mime:string};utterance?:{speaker:'Customer';text:string;at:string;speaking?:boolean}};
export type Dispatch={to:string;from:string;callbackUrl:string;maxSeconds:number;record:boolean;idempotencyKey:string;metadata:Record<string,unknown>};
export class ProviderRejected extends Error { constructor(public code:string){super(code);} }
export class ProviderAmbiguous extends Error {}
export interface CallingProvider {
 dispatch(input:Dispatch):Promise<{providerCallId:string}>;
 hangup(id:string):Promise<{accepted:boolean}>;
 fetchStatus(id:string):Promise<CallEvent|null>;
 verifyWebhook(raw:string,headers:Headers,now:number):CallEvent;
 estimateCostVnd(seconds:number):number|null;
}
export function callingProvider():CallingProvider {
 if(!telephonyConfigured() || process.env.TELEPHONY_PROVIDER!=='simulator')throw Error('TELEPHONY_NOT_CONFIGURED');
 return simulator;
}
