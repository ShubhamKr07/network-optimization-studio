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

  function hangingStream(extra = "") {
    const signals: AbortSignal[] = [];
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((_u: string, init: RequestInit) => {
      signals.push(init.signal!);
      return Promise.resolve(new Response(new ReadableStream({
        start(c) {
          if (extra) c.enqueue(new TextEncoder().encode(extra));
          init.signal!.addEventListener("abort", () => c.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
        },
      }), { status: 200 }));
    });
    return signals;
  }

  it("aborts the in-flight fetch on unmount", async () => {
    const signals = hangingStream();
    const { result, unmount } = renderHook(() => useWatBotConversation("p-median-us"));
    act(() => { void result.current.ask("Why?", null); });
    await waitFor(() => expect(signals).toHaveLength(1));
    unmount();
    expect(signals[0]!.aborted).toBe(true);
  });

  it("startNew aborts the stream and the late answer does not leak into the new conversation", async () => {
    const signals = hangingStream('event: block\ndata: {"text":"old","citations":[]}\n\n');
    const { result } = renderHook(() => useWatBotConversation("p-median-us"));
    let p!: Promise<void>;
    act(() => { p = result.current.ask("Why?", null); });
    await waitFor(() => expect(result.current.items.some((i) => i.kind === "tutor")).toBe(true));
    act(() => { result.current.startNew(); });
    await act(async () => { await p; });
    expect(signals[0]!.aborted).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.busy).toBe(false);
    expect(result.current.status).toBeNull();
  });

  it("clears the queued pill and searching state on the first block", async () => {
    const signals = hangingStream('event: queued\ndata: {"position":2}\n\nevent: searching\ndata: {"query":"Ch 3"}\n\nevent: queued\ndata: {"position":2}\n\nevent: block\ndata: {"text":"Hi","citations":[]}\n\n');
    const { result } = renderHook(() => useWatBotConversation("p-median-us"));
    act(() => { void result.current.ask("Why?", null); });
    await waitFor(() => expect(result.current.items.some((i) => i.kind === "tutor")).toBe(true));
    expect(result.current.pending).toEqual({ searching: null });
    act(() => { result.current.stop(); });
    await waitFor(() => expect(signals[0]!.aborted).toBe(true));
  });

  it("a stream that ends after a block with no done/error is a failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse('event: block\ndata: {"text":"Half","citations":[]}\n\n'));
    const { result } = renderHook(() => useWatBotConversation("p-median-us"));
    await act(async () => { await result.current.ask("Why?", null); });
    expect(result.current.status).toBe("watbot_failed");
  });
});
