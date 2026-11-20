import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const createConv = vi.fn().mockResolvedValue({ id: 5, modelId: "p-median-us", title: "New conversation", updatedAt: "" });
vi.mock("@workspace/api-client-react", () => ({
  useCreateWatBotConversation: () => ({ mutateAsync: createConv }),
  getGetWatBotStatusQueryKey: () => ["status"],
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
import { useWatBotConversation } from "@/components/workspace/watbot/useWatBotConversation";

function sseResponse(text: string) {
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("useWatBotConversation", () => {
  beforeEach(() => { global.fetch = vi.fn(); });

  it("creates a conversation on first ask, streams blocks, ends idle", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse(
      'event: block\ndata: {"text":"Hello?","citations":[]}\n\nevent: done\ndata: {"messageId":42}\n\n'));
    const { result } = renderHook(() => useWatBotConversation("p-median-us"));
    await act(async () => { await result.current.ask("Why?", { tab: "output-map", scenarioId: 3 }); });
    expect(createConv).toHaveBeenCalledWith({ data: { modelId: "p-median-us" } });
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toMatch(/\/api\/watbot\/conversations\/5\/messages$/);
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toEqual({ question: "Why?", context: { tab: "output-map", scenarioId: 3 } });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.items.map((i) => i.kind)).toEqual(["student", "tutor"]);
    expect(result.current.items[1]!.id).toBe(42);
  });

  it("maps a JSON 429 student limit to a limit status without streaming", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({ error: "watbot_student_limit", resetAt: null }), { status: 429 }));
    const { result } = renderHook(() => useWatBotConversation("p-median-us"));
    await act(async () => { await result.current.ask("q", null); });
    expect(result.current.status).toBe("watbot_student_limit");
  });

  it("maps a 409 watbot_busy and an SSE error event to statuses", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(JSON.stringify({ error: "watbot_busy" }), { status: 409 }));
    const { result } = renderHook(() => useWatBotConversation("p-median-us"));
    await act(async () => { await result.current.ask("q", null); });
    expect(result.current.status).toBe("watbot_busy");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sseResponse('event: error\ndata: {"code":"watbot_refused"}\n\n'));
    await act(async () => { await result.current.ask("q2", null); });
    expect(result.current.status).toBe("watbot_refused");
  });

  it("Stop keeps the streamed part and adds the 'Answer stopped' notice (D22)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((_url: string, init: RequestInit) => Promise.resolve(new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('event: block\ndata: {"text":"First part?","citations":[]}\n\n'));
        init.signal!.addEventListener("abort", () => c.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } })));
    const { result } = renderHook(() => useWatBotConversation("p-median-us"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.ask("Why?", null); });
    await waitFor(() => expect(result.current.items.some((i) => i.kind === "tutor")).toBe(true));
    act(() => { result.current.stop(); });
    await act(async () => { await pending; });
    expect(result.current.items.map((i) => i.kind)).toEqual(["student", "tutor", "notice"]);
    expect(result.current.items[2]!.blocks[0]!.text).toBe("Answer stopped");
    expect(result.current.status).toBeNull();
  });
});
