import { useListWatBotConversations } from "@workspace/api-client-react";

export function WatBotHistory({ modelId, onPick, onNew }: { modelId: string; onPick: (id: number) => void; onNew: () => void }) {
  const { data, isLoading } = useListWatBotConversations({ modelId });
  return (
    <nav aria-label="Past conversations" className="flex flex-col gap-1" data-testid="watbot-history">
      <button type="button" onClick={onNew} className="min-h-11 rounded-md border px-3 text-left text-sm font-semibold">New conversation</button>
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {data?.length === 0 && <p className="text-xs text-muted-foreground">No past conversations for this chapter.</p>}
      {data?.map((c) => (
        <button key={c.id} type="button" onClick={() => onPick(c.id)} className="min-h-11 rounded-md px-3 text-left text-sm hover:bg-muted">
          <span className="block truncate">{c.title}</span>
          <span className="block text-[11px] text-muted-foreground">{new Date(c.updatedAt).toLocaleString()}</span>
        </button>
      ))}
    </nav>
  );
}
