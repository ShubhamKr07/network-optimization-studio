repo: ShubhamKr07/network-optimization-studio
branch: main
path: artifacts/studio/src

## Last sync
date: 2026-09-01T07:38:50Z

### Updated in this project
- Read Studio frontend (tokens, shadcn ui variants, workspace components, chapters/band data) to ground the design system
- Component inventory and UI-kit structure derived from artifacts/studio/src
- Login screen recreated from pages/auth/Login.tsx, restyled to the book cover

## Screen map
| Project screen | Repo files |
|---|---|
| ui_kits/studio/index.html (Landing/Labs) | artifacts/studio/src/pages/Landing.tsx, lib/chapters.ts, components/AppShell.tsx |
| ui_kits/studio/index.html (Workspace) | artifacts/studio/src/pages/Workspace.tsx, components/workspace/{SidebarTree,TabBar,StaleOutputBanner}.tsx, components/ObjectiveBar.tsx, components/ConstraintChips.tsx, components/workspace/map/MapLegend.tsx |
| ui_kits/studio/login.html | artifacts/studio/src/pages/auth/Login.tsx |
| components/* | artifacts/studio/src/components/ui/{button,badge,card,input,select,checkbox,table,tabs,dialog}.tsx |
