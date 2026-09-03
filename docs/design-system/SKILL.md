---
name: scnd-optimization-studio-design
description: Use this skill to generate well-branded interfaces and assets for SCND Optimization Studio, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the readme.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Quick orientation:
- `styles.css` imports all tokens (colors, typography, spacing, data-viz). Identity: paper white + warm near-black + the book cover's leaf green; Source Serif 4 display, IBM Plex Sans UI, IBM Plex Mono for all numbers; 3/4/6px radii; hairline borders; dark "band" strips as the signature brand motif.
- `components/core/` and `components/studio/` hold the React primitives (each with a `.d.ts` contract and `.prompt.md` usage note).
- `ui_kits/studio/` is a working recreation of the app (Landing + Workspace) to copy layouts from.
- Tone: academic, plain, no emoji; numbers always mono with units.
