import { createClient } from "@supabase/supabase-js";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabaseConfigMessage = "로컬 실행에 필요한 VITE_SUPABASE_URL 또는 VITE_SUPABASE_ANON_KEY가 없습니다.";
export const supabase = createClient(
  supabaseUrl || "https://example.supabase.co",
  supabaseAnonKey || "missing-local-anon-key"
);
