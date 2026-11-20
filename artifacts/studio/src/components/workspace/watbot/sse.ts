export function parseSseChunk(buffer: string) {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = parts.map((part) => {
    let event = "message"; let data = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    return { event, data: data ? JSON.parse(data) as unknown : null };
  });
  return { events, rest };
}
