import { createClient, User as SupabaseUser } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://dfuvmqsuxawkllfveswz.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmdXZtcXN1eGF3a2xsZnZlc3d6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY4MjM5MDkwNywiZXhwIjoxOTk3OTY2OTA3fQ.fP-7Nd5U-gayyd81n0GKoKCOqTeIVkktf2CNpoMG914"
);

export type User = SupabaseUser;
