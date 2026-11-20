export function parseSseChunk(buffer: string) {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = parts.map((part) => {
    let event = "message"; const data: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trimStart();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    const joined = data.join("\n");
    return { event, data: joined ? JSON.parse(joined) as unknown : null };
  });
  return { events, rest };
}
