import {it,expect,vi,afterEach} from 'vitest';
vi.mock('./facebookPublications',()=>({facebookRpc:vi.fn()}));
import {facebookRpc} from './facebookPublications';import {connectFacebookComputer} from './facebookConnection';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});
function runtime(state:any){
 vi.stubEnv('VITE_SUPABASE_URL','https://test.supabase.co');vi.stubEnv('VITE_SUPABASE_ANON_KEY','sb_publishable_fixture');const sent:any[]=[];
 vi.stubGlobal('window',{chrome:{runtime:{sendMessage:(_id:any,message:any,callback:any)=>{sent.push(message);callback(message.type==='rivastock-installed'?{installed:true,protocol:2,connectionStatus:true}:message.type==='rivastock-connection-status'?state:message.type==='rivastock-connect'?{pending:true}:{opened:true});}}}});return sent;
}
it('opens recovery for the existing connection without generating another device',async()=>{
 const sent=runtime({hasConnection:true,matches:true,paused:true});expect(await connectFacebookComputer(['pc'])).toContain('ya está vinculada');expect(facebookRpc).not.toHaveBeenCalled();expect(sent.some(m=>m.type==='rivastock-open-connection')).toBe(true);
});
it('does not create new pairing codes for orphaned work or an unfinished pairing',async()=>{
 runtime({hasActiveJob:true});expect(await connectFacebookComputer()).toContain('intento anterior');expect(facebookRpc).not.toHaveBeenCalled();runtime({pairingPending:true});expect(await connectFacebookComputer()).toContain('vinculación pendiente');expect(facebookRpc).not.toHaveBeenCalled();
});
it('creates a code only after read-only preflight confirms there is no existing link',async()=>{
 const sent=runtime({hasConnection:false,hasActiveJob:false});vi.mocked(facebookRpc).mockResolvedValue({code:'a'.repeat(64)});await connectFacebookComputer();expect(facebookRpc).toHaveBeenCalledTimes(1);expect(sent.map(m=>m.type)).toEqual(['rivastock-installed','rivastock-connection-status','rivastock-connect']);
});
