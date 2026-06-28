import type { ModeId } from "./modes";
import type { RunState } from "./runEngine";
import { isCloud, supabase } from "./supabase";

export type SaveRow = {
  mode: ModeId;
  state: RunState;
  updatedAt: string;
};

function localKey(userId: string, mode: ModeId) {
  return `lifepatch.save.${userId}.${mode}`;
}

export async function saveRun(userId: string, mode: ModeId, state: RunState): Promise<void> {
  if (isCloud && supabase) {
    await supabase
      .from("saves")
      .upsert(
        { user_id: userId, mode, state, updated_at: new Date().toISOString() },
        { onConflict: "user_id,mode" },
      );
    return;
  }
  try {
    localStorage.setItem(
      localKey(userId, mode),
      JSON.stringify({ mode, state, updatedAt: new Date().toISOString() } satisfies SaveRow),
    );
  } catch {}
}

export async function loadRun(userId: string, mode: ModeId): Promise<RunState | null> {
  if (isCloud && supabase) {
    const { data } = await supabase
      .from("saves")
      .select("state")
      .eq("user_id", userId)
      .eq("mode", mode)
      .maybeSingle();
    return (data?.state as RunState) ?? null;
  }
  try {
    const raw = localStorage.getItem(localKey(userId, mode));
    if (!raw) return null;
    return (JSON.parse(raw) as SaveRow).state;
  } catch {
    return null;
  }
}

export async function listSaves(userId: string): Promise<{ mode: ModeId; updatedAt: string }[]> {
  if (isCloud && supabase) {
    const { data } = await supabase
      .from("saves")
      .select("mode, updated_at")
      .eq("user_id", userId);
    return (data ?? []).map((r) => ({ mode: r.mode as ModeId, updatedAt: r.updated_at as string }));
  }
  const out: { mode: ModeId; updatedAt: string }[] = [];
  for (const mode of ["story", "infinite"] as ModeId[]) {
    try {
      const raw = localStorage.getItem(localKey(userId, mode));
      if (raw) out.push({ mode, updatedAt: (JSON.parse(raw) as SaveRow).updatedAt });
    } catch {}
  }
  return out;
}

export async function deleteSave(userId: string, mode: ModeId): Promise<void> {
  if (isCloud && supabase) {
    await supabase.from("saves").delete().eq("user_id", userId).eq("mode", mode);
    return;
  }
  try {
    localStorage.removeItem(localKey(userId, mode));
  } catch {}
}
