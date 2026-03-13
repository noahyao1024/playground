import { createClient } from "@supabase/supabase-js";

// Public read-only values (anon key can only read, writes go through /api/data)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgowrcekmjjpbwldxkih.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indnb3dyY2VrbWpqcGJ3bGR4a2loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTkzNDMsImV4cCI6MjA4ODczNTM0M30.jg2x8H8ckBkzV1y4dOcPXHTwDbD2YCmbeasVZZVR_gY";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
