# Studio UI kit

Interactive recreation of the SCND Optimization Studio frontend (\`artifacts/studio/src\`), reskinned with the book-cover design system.

- **Landing** — dark band hero + Labs chapter cards + recent solves (from \`pages/Landing.tsx\`, \`lib/chapters.ts\`).
- **Workspace** — sidebar tree (Scenarios / Inputs / Outputs), document tab bar, constraint chips, objective bar, input tables, abstract network map, solve dialog, stale-output gating (from \`pages/Workspace.tsx\` and \`components/workspace/*\`).

Click the Chapter 3 card to enter the workspace; open inputs from the sidebar; Run Optimizer to unlock outputs; edit a parameter to see stale gating. The map is an abstract network field — the real app renders Leaflet tiles.
