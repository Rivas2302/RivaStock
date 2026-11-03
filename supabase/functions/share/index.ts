import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { SUPABASE_PUBLISHABLE_KEY } from '../_shared/supabasePublicConfig.ts';
import { createShareHandler } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? 'https://nkfqhuqrgrpfufdymkcr.supabase.co';
serve(createShareHandler({ supabaseUrl, publishableKey: SUPABASE_PUBLISHABLE_KEY }));
