import { describe, it, expect } from "vitest";
import { parseSseChunk } from "@/components/workspace/watbot/sse";

describe("parseSseChunk", () => {
  it("parses complete events and keeps a partial tail", () => {
    const { events, rest } = parseSseChunk('event: queued\ndata: {"position":2}\n\nevent: block\ndata: {"text":"Hi","citations":[]}\n\nevent: do');
    expect(events).toEqual([{ event: "queued", data: { position: 2 } }, { event: "block", data: { text: "Hi", citations: [] } }]);
    expect(rest).toBe("event: do");
  });

  it("joins multi-line data with newlines and accepts data: without a space", () => {
    const { events } = parseSseChunk('event:block\ndata:{"a":\ndata:1}\n\n');
    expect(events).toEqual([{ event: "block", data: { a: 1 } }]);
  });
});
