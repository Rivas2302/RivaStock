import {describe,expect,it} from 'vitest';
import {isFacebookPacingRisk} from './facebookPacingPolicy';

const conservative={min_gap_seconds:720,jitter_pct:30,daily_marketplace_cap:5,daily_group_cap:15,max_groups_per_listing:10,repeat_group_days:14,quiet_hours_start:'23:00',quiet_hours_end:'08:00',timezone_name:'America/Argentina/Buenos_Aires',pause_on_warning_hours:48};

describe('Facebook pacing policy',()=>{
  it('accepts the conservative default profile without a risk warning',()=>{
    expect(isFacebookPacingRisk(conservative)).toBe(false);
  });

  it.each([
    {min_gap_seconds:600},
    {jitter_pct:31},
    {daily_marketplace_cap:6},
    {daily_group_cap:16},
    {max_groups_per_listing:11},
    {repeat_group_days:13},
    {quiet_hours_start:'00:00',quiet_hours_end:'08:00'},
    {pause_on_warning_hours:47},
    {timezone_name:'America/Santiago'},
  ])('requires an explicit risk warning for more aggressive settings %#',changes=>{
    expect(isFacebookPacingRisk({...conservative,...changes})).toBe(true);
  });

  it('compares quieter hours and timezone changes with the saved policy',()=>{
    expect(isFacebookPacingRisk({...conservative,quiet_hours_start:'23:00',quiet_hours_end:'06:00'},conservative)).toBe(true);
    expect(isFacebookPacingRisk({...conservative,timezone_name:'America/Santiago'},conservative)).toBe(true);
    expect(isFacebookPacingRisk({...conservative,quiet_hours_start:'22:00',quiet_hours_end:'08:00'},conservative)).toBe(false);
  });
});
