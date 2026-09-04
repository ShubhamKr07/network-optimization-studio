Collapsible AI-assistant chat panel for the model workspace: a 300px right rail (`borderLeft`, card background, full height). Header has a green status dot, "Assistant" title, and the scenario name in mono 9.5px + an × close. Empty state shows an intro line and three suggested-prompt buttons; conversation renders user bubbles right-aligned (green-700, white) and AI bubbles left-aligned (surface-sunken, bordered), 12px radii with a 3px corner toward the sender. Footer is a text input + Send button (Enter submits, auto-scrolls to newest). Canned replies sit behind `getReply(text, ctx)` — swap that one function for a real LLM call later.

```jsx
<AssistantPanel scenario="Baseline" solved stale={false} p={4} onClose={close} />
```
