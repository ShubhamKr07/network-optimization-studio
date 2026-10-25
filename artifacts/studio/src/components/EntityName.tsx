// DU-2.7 — the one entity-identity shape: `Type · Name · ID`. Name (city, state)
// is display-only and not unique; the stable ID is mandatory and mono.
export function EntityName({ type, name, id }: { type?: string; name: string; id: string }) {
  return (
    <>
      {type ? `${type} · ` : ""}
      {name}
      {" · "}
      <span className="font-mono">{id}</span>
    </>
  );
}
