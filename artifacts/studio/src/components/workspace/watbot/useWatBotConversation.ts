import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateWatBotConversation, getGetWatBotStatusQueryKey, type WatBotBlock } from "@workspace/api-client-react";
import { parseSseChunk } from "./sse";

export type ChatItem = { kind: "student" | "tutor" | "notice"; id?: number; key?: string; blocks: WatBotBlock[] };
export type Pending = { searching: string | null; queued?: number };
const API = `${(import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "")}/api`;
const NOTICE_TEXT = {
  claim_removed: "One claim was removed — I couldn't support it with a course source.",
  gap_logged: "gap logged for the teaching team",
} as const;
// D22 — same text as the server's notice row (engine.ts STOPPED_NOTICE), shown at once on Stop.
const STOPPED_TEXT = "Answer stopped";

export function useWatBotConversation(modelId: string) {
  const qc = useQueryClient();
  const createConv = useCreateWatBotConversation();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped by startNew/load: events from a request started under an older generation are dropped.
  const gen = useRef(0);
  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(async (question: string, context: { tab: string | null; scenarioId: number | null } | null) => {
    setStatus(null);
    setPending({ searching: null });
    const ac = new AbortController(); abortRef.current = ac;
    const g = gen.current;
    const stale = () => g !== gen.current;
    let terminal = false;
    const key = crypto.randomUUID();
    const upsertTutor = (patch: (t: ChatItem) => ChatItem) => setItems((xs) => {
      const i = xs.findIndex((x) => x.key === key);
      if (i < 0) return [...xs, patch({ kind: "tutor", key, blocks: [] })];
      const next = xs.slice(); next[i] = patch(xs[i]!); return next;
    });
    try {
      const id = conversationId ?? (await createConv.mutateAsync({ data: { modelId } })).id;
      if (stale()) return;
      setConversationId(id);
      setItems((xs) => [...xs, { kind: "student", blocks: [{ text: question, citations: [] }] }]);
      const res = await fetch(`${API}/watbot/conversations/${id}/messages`, {
        method: "POST", credentials: "include", signal: ac.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, context }),
      });
      if (stale()) return;
      if (!res.ok || !res.body) {
        let body: { error?: string } = {};
        try { body = await res.json() as { error?: string }; } catch { /* non-JSON error body: fall back to watbot_failed */ }
        setStatus(body.error ?? "watbot_failed");
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done || stale()) break;
        const parsed = parseSseChunk(buf + value);
        buf = parsed.rest;
        for (const { event, data } of parsed.events) {
          const d = data as Record<string, unknown>;
          if (event === "queued") setPending((p) => ({ ...(p ?? { searching: null }), queued: d.position as number }));
          else if (event === "searching") setPending((p) => ({ ...(p ?? {}), searching: d.query as string, queued: undefined }));
          else if (event === "block") { setPending((p) => p && { searching: null }); upsertTutor((t) => ({ ...t, blocks: [...t.blocks, d as unknown as WatBotBlock] })); }
          else if (event === "notice") setItems((xs) => [...xs, { kind: "notice", blocks: [{ text: NOTICE_TEXT[d.kind as keyof typeof NOTICE_TEXT], citations: [] }] }]);
          else if (event === "done") { terminal = true; setItems((xs) => xs.map((x) => (x.key === key ? { ...x, id: d.messageId as number } : x))); }
          else if (event === "error") { terminal = true; setStatus(d.code as string); }
        }
      }
      // A stream that closes with neither `done` nor `error` was cut off — never let it look successful.
      if (!terminal && !stale()) setStatus("watbot_failed");
    } catch (e) {
      if (stale()) return;
      // Stop: the server saves the forwarded blocks and an "Answer stopped" notice (D22); mirror it locally.
      if ((e as Error).name === "AbortError") setItems((xs) => [...xs, { kind: "notice", blocks: [{ text: STOPPED_TEXT, citations: [] }] }]);
      else setStatus("watbot_failed");
    } finally {
      if (!stale()) { setPending(null); abortRef.current = null; }
      void qc.invalidateQueries({ queryKey: getGetWatBotStatusQueryKey() });
    }
  }, [conversationId, createConv, modelId, qc]);

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = (id: number | null, messages: ChatItem[]) => {
    gen.current++; abortRef.current?.abort(); abortRef.current = null;
    setPending(null); setConversationId(id); setItems(messages); setStatus(null);
  };
  const startNew = useCallback(() => reset(null, []), []);
  const load = useCallback((id: number, messages: ChatItem[]) => reset(id, messages), []);
  return { items, pending, busy: pending !== null, status, ask, stop, startNew, load, conversationId };
}
