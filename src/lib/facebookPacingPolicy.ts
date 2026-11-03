export interface FacebookPacingRiskPolicy {
  min_gap_seconds:number;
  jitter_pct:number;
  daily_marketplace_cap:number;
  daily_group_cap:number;
  max_groups_per_listing:number;
  repeat_group_days:number;
  quiet_hours_start:string;
  quiet_hours_end:string;
  timezone_name:string;
  pause_on_warning_hours:number;
}

export function isFacebookPacingRisk(policy:FacebookPacingRiskPolicy,current?:FacebookPacingRiskPolicy):boolean{
  const minutes=(value:string)=>{const [hours,mins]=value.split(':').map(Number);return hours*60+mins;};
  const start=minutes(policy.quiet_hours_start),end=minutes(policy.quiet_hours_end);
  const currentStart=current?minutes(current.quiet_hours_start):23*60;
  const currentEnd=current?minutes(current.quiet_hours_end):8*60;
  const quietMinutes=start===end?0:(end-start+1440)%1440;
  const currentQuietMinutes=currentStart===currentEnd?0:(currentEnd-currentStart+1440)%1440;
  return policy.min_gap_seconds<720||policy.jitter_pct>30||policy.daily_marketplace_cap>5||policy.daily_group_cap>15
    ||policy.max_groups_per_listing>10||policy.repeat_group_days<14||policy.pause_on_warning_hours<48
    ||quietMinutes<540||(current!==undefined&&(quietMinutes<currentQuietMinutes||policy.timezone_name!==current.timezone_name))
    ||(current===undefined&&policy.timezone_name!=='America/Argentina/Buenos_Aires');
}
