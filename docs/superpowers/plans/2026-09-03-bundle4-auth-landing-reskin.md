# Bundle 4 — Auth split-screen + Landing hero + live Landing stats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Login/Register (split-screen) and Landing (hero + live per-chapter footers & header stats) to the book-cover mockups, backed by one new auth-scoped aggregate endpoint.

**Architecture:** Presentation-only for T1/T2 and T4's rendering; the only backend change is T3's read-only `GET /landing-summary` (two grouped, both-side-tenant-scoped queries) + its orval-generated client. No schema/DB/solver change. A shared `AuthShell` de-duplicates the two auth pages; a pure `formatRelativeTime` helper + `useGetLandingSummary` drive Landing.

**Tech Stack:** React + Vite + Tailwind v4 + shadcn/Radix + wouter + TanStack Query (frontend); Express 5 + Drizzle + orval/OpenAPI (backend); vitest + RTL (tests).

**Spec:** `docs/superpowers/specs/2026-09-03-bundle4-auth-landing-reskin-design.md` (review-resolved). Read its resolutions log — T3/T4 encode resolutions #1–#4.

## Plan review — resolutions (2026-09-04)

Seven plan-review findings; all fixed inline:

1. **[P1] T3 route typecheck.** `max(finishedAt)` is `Date | null`; the TS `Date`
   ctor rejects a `Date`. Fixed: serialize with `?.toISOString() ?? null`
   directly (T3 Step 1).
2. **[P1] Query-count off by one.** `loginAs()` consumes one `db.select`
   before the endpoint's two. Fixed: `mockDb.select.mockClear()` immediately
   after `loginAs()` returns, then queue the two endpoint results and assert
   exactly two calls (T3 Step 6).
3. **[P1] Ownership markers indistinguishable.** Both `userId` columns mocked
   as `"user_id"`, so `arrayContaining` passed with one predicate missing.
   Fixed: table-qualified markers (`"scenarios.user_id"` /
   `"solve_jobs.user_id"`), an exact `toEqual` on the `and(...)` array, and
   assertions on both `select()` projections (T3 Steps 5–6). **Coverage claim
   revised:** the suite mocks SQL, so a literal cross-linked-row *exclusion* is
   not executable at this layer; the both-side-ownership proof is the
   distinct-marker query-shape assertion (both predicates individually present
   in the route's `where`). The security *requirement* (both predicates in the
   route) is unchanged — only the test mechanism is stated honestly.
4. **[P1] Worktree-locked asset copy.** Removed the hardcoded
   `.claude/worktrees/...` path and the ineffective `cd`. Every task runs from
   its own assigned worktree root using repo-relative paths (T1 Step 1 +
   Execution note).
5. **[P2] Error fallback with cached data.** `summary != null` treated stale
   retained data as ready after a background-refetch error. Fixed:
   `ready = !isPending && !isError && summary != null`; a test covers
   error-with-cached-data → baseline (T4 Steps 3–4).
6. **[P2] Dead `vite-env.d.ts` step.** `tsconfig.json` already lists
   `"vite/client"` in `types`; the step is removed (T1).
7. **[P2] Missing pytest in final gate.** Added a post-T4 whole-bundle gate
   including the solver pytest suite (Final gate section).

## Global Constraints

- Presentation-only except T3 (new read endpoint) and T4's one added query. No other API/DB/solver/behavior change.
- Tokens ONLY from `artifacts/studio/src/index.css`; `designTokens.contract.test.ts` must stay green; light theme only. Map missing mockup tokens: `--surface-page`→`--background`, `--surface-card`→`--card`, `--border-default`→`--line`, `--font-display/mono/sans`→`--app-font-display/mono/sans`, tracking hardcoded (`0.14em`/`0.1em`/`0.08em`).
- Preserve every `data-testid`, `aria-*`, `role`, and all form/mutation logic — especially the `queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), …)`-before-`navigate` pattern and its comment in Login/Register, and the `passwordTooShort` guard. Never delete a behavioral test.
- Ownership (T3): `requireAuth` + `req.userId` on every query; solve query filters BOTH `solveJobsTable.userId` AND `scenariosTable.userId` (resolution #2). The query-shape test is mandatory (resolution #1).
- `totals.solvedScenarios` = `COUNT(DISTINCT scenario_id)` of succeeded jobs; UI label "solved" (resolution #4). Never rename it back to "solves".
- Never hand-edit generated code (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`); regenerate with orval and commit spec + output together.
- One commit per task; messages exactly `[bundle4-T<n>] <summary>`.
- Do NOT touch `Studio.tsx`, `.studio-lab`, `--arc-*`.
- Agent-team execution in the shared worktree: commit ONLY each task's explicit files with a pathspec — `git commit -m "..." -- <files>` (`-m` before `--`), and re-check `git status` right before commit (shared-index race guard).

---

## Task T1 — Auth split-screen (`[bundle4-T1]`)

**Files:**
- Create: `artifacts/studio/src/components/auth/AuthShell.tsx`
- Create: `artifacts/studio/src/assets/book-cover.jpg` (copied binary)
- Modify: `artifacts/studio/src/pages/auth/Login.tsx`
- Modify: `artifacts/studio/src/pages/auth/Register.tsx`
- Test: `artifacts/studio/src/__tests__/Login.test.tsx`, `artifacts/studio/src/__tests__/Register.test.tsx`

**Interfaces:**
- Produces: `AuthShell({ tagline: string, children: ReactNode })` — renders the dark cover panel (book-cover image + mono diamond caption), the right panel's fixed kicker (`BY PROF. MICHAEL WATSON`) + green serif heading (`Optimization Studio`) + `tagline`, then `children` (the page's form + OR divider + cross-link), then the fixed dev-credit block + labs footer strip. `data-testid`s: `auth-shell`, `auth-cover`, `auth-credit`, `auth-labs-strip`.

All commands below are repo-relative — run them from **your assigned worktree
root** (the checkout this task was dispatched into). Do NOT `cd` into any other
worktree.

- [ ] **Step 1: Copy the book-cover asset**

```bash
mkdir -p artifacts/studio/src/assets
cp docs/design-system/assets/book-cover.jpg artifacts/studio/src/assets/book-cover.jpg
ls -l artifacts/studio/src/assets/book-cover.jpg   # expect ~264KB
```

(No asset type-declaration step: `artifacts/studio/tsconfig.json` already lists
`"vite/client"` in `types`, so `import coverUrl from "@/assets/book-cover.jpg"`
is typed. Do not add a `vite-env.d.ts`.)

- [ ] **Step 2: Write `AuthShell.tsx`**

Create `artifacts/studio/src/components/auth/AuthShell.tsx`:

```tsx
import { ReactNode } from "react";
import coverUrl from "@/assets/book-cover.jpg";

const LABS = ["Ch 3 · p-median", "Ch 5 · transport LP", "Ch 5 · capacitated", "Ch 10 · two-echelon"];
const MONO = "var(--app-font-mono)";

function Diamond() {
  return (
    <span
      aria-hidden
      className="inline-block align-middle mx-2"
      style={{ width: 5, height: 5, background: "var(--green-400)", transform: "rotate(45deg)" }}
    />
  );
}

function AuthCredit() {
  return (
    <div className="mt-4 pt-3 text-center border-t" style={{ borderColor: "var(--line)" }} data-testid="auth-credit">
      <div className="uppercase" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>Developed by Shubham</div>
      <div className="mt-2" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>Facing issues?</div>
      <div className="mt-1 flex items-center justify-center gap-1.5" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
        <span>Reach me out at</span>
        <a href="https://www.linkedin.com/in/shubhamkumarcse/" target="_blank" rel="noopener" title="LinkedIn" className="inline-flex" style={{ color: "var(--green-600)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="LinkedIn"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>
        </a>
        <a href="mailto:shubham.shubham4995@gmail.com" title="Email" className="inline-flex" style={{ color: "var(--green-600)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Email"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M3 6.5l9 6.5 9-6.5" /></svg>
        </a>
      </div>
    </div>
  );
}

export function AuthShell({ tagline, children }: { tagline: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background" data-testid="auth-shell">
      <div
        data-testid="auth-cover"
        className="flex flex-col items-center justify-center gap-5 px-9 py-6 md:py-10 md:basis-[44%] md:flex-shrink-0 border-b-2 md:border-b-0 md:border-r-2"
        style={{ background: "var(--surface-band)", borderColor: "var(--green-400)" }}
      >
        <img
          src={coverUrl}
          alt="Supply Chain Network Design book cover"
          className="block w-[46%] max-w-[160px] md:w-[72%] md:max-w-[290px]"
          style={{ boxShadow: "0 22px 48px rgba(0,0,0,.55)" }}
        />
        <div className="text-center uppercase" style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: "0.14em", color: "var(--ink-300)" }}>
          <Diamond />The textbook behind the labs<Diamond />
        </div>
      </div>
      <div className="flex-1 flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-[360px]">
            <div className="uppercase" style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.14em", color: "var(--text-muted)" }}>By Prof. Michael Watson</div>
            <div className="mt-2 mb-1.5" style={{ fontFamily: "var(--app-font-display)", fontWeight: 700, fontSize: "32px", lineHeight: 1.1, color: "var(--green-600)" }}>Optimization Studio</div>
            <div className="mb-5" style={{ fontSize: "13px", lineHeight: 1.5, color: "var(--text-muted)" }}>{tagline}</div>
            {children}
            <AuthCredit />
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 px-6 py-3 border-t" style={{ background: "var(--card)", borderColor: "var(--line)" }} data-testid="auth-labs-strip">
          {LABS.map((l) => (
            <span key={l} style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `Login.tsx`**

Replace the whole file. Mutation logic and the `setQueryData`-before-`navigate` comment are unchanged; only the returned JSX changes (AuthShell + form as children, no Card, no AppFooter/band).

```tsx
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLoginUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth/AuthShell";

export function Login() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const loginUser = useLoginUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loginUser.mutate(
      { data: { email, password } },
      {
        onSuccess: (data) => {
          // Write the cache synchronously instead of invalidating + waiting
          // on a refetch: navigating to "/" immediately races Gate()'s
          // auth-gated render against that refetch, and on a slow enough
          // round trip (e.g. real cross-origin network latency), Gate()
          // still sees no user, renders UnauthedRouter for the new "/" URL,
          // and its catch-all bounces the URL back to "/login" — which
          // isn't a route in AuthedRouter, so once the user data does
          // arrive the app 404s instead of showing Landing.
          queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), data);
          navigate("/", { replace: true });
        },
      },
    );
  }

  return (
    <AuthShell tagline="Log in to continue your labs. Build a scenario on the map, solve it with a real optimizer, compare the results.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {loginUser.isError && (
          <Alert variant="destructive" data-testid="alert-login-error">
            <AlertDescription>Invalid email or password.</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required autoComplete="email" placeholder="you@university.edu" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" />
        </div>
        <Button type="submit" disabled={loginUser.isPending} data-testid="button-login" className="mt-1">
          {loginUser.isPending ? "Logging in…" : "Log in"}
        </Button>
      </form>
      <div className="flex items-center gap-2.5 my-4">
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
        <span className="uppercase" style={{ fontFamily: "var(--app-font-mono)", fontSize: "9px", letterSpacing: "0.1em", color: "var(--text-faint)" }}>or</span>
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
      </div>
      <div className="text-center" style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
        No account? <Link href="/register" className="underline" style={{ color: "var(--link)" }}>Register with your course email</Link>
      </div>
    </AuthShell>
  );
}
```

- [ ] **Step 4: Rewrite `Register.tsx`**

Same shape; keep `passwordTooShort` guard and 409/generic error branching.

```tsx
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useRegisterUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth/AuthShell";

export function Register() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const registerUser = useRegisterUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const passwordTooShort = password.length > 0 && password.length < 8;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordTooShort) return;
    registerUser.mutate(
      { data: { email, password } },
      {
        onSuccess: (data) => {
          // See Login.tsx's onSuccess for why this writes the cache
          // synchronously instead of invalidating + waiting on a refetch
          // (avoids a real race against Gate()'s auth-gated render).
          queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), data);
          navigate("/", { replace: true });
        },
      },
    );
  }

  const errorMessage = registerUser.isError
    ? (registerUser.error as { status?: number })?.status === 409
      ? "An account with this email already exists."
      : "Could not create the account. Check your details and try again."
    : null;

  return (
    <AuthShell tagline="Register to start solving labs. Build a scenario on the map, solve it with a real optimizer, compare the results.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {errorMessage && (
          <Alert variant="destructive" data-testid="alert-register-error">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required autoComplete="email" placeholder="you@university.edu" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" />
          {passwordTooShort && (
            <p className="text-xs text-destructive" data-testid="text-password-hint">Password must be at least 8 characters.</p>
          )}
        </div>
        <Button type="submit" disabled={registerUser.isPending} data-testid="button-register" className="mt-1">
          {registerUser.isPending ? "Creating account…" : "Register"}
        </Button>
      </form>
      <div className="flex items-center gap-2.5 my-4">
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
        <span className="uppercase" style={{ fontFamily: "var(--app-font-mono)", fontSize: "9px", letterSpacing: "0.1em", color: "var(--text-faint)" }}>or</span>
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
      </div>
      <div className="text-center" style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
        Already have an account? <Link href="/login" className="underline" style={{ color: "var(--link)" }}>Log in</Link>
      </div>
    </AuthShell>
  );
}
```

- [ ] **Step 5: Update `Login.test.tsx`**

Keep the behavioral tests (submit, cache-write+navigate, error alert, disabled-while-pending). Replace the footer/band/narrow-viewport tests (the band and global AppFooter are gone) and the register-link text:

- Delete the `it("mounts the app footer", …)` test; add:
```tsx
it("does not mount the global app footer (inline credit replaces it)", () => {
  render(<Login />);
  expect(screen.queryByTestId("app-footer")).not.toBeInTheDocument();
  expect(screen.getByTestId("auth-credit")).toHaveTextContent("Developed by Shubham");
});
```
- Replace the `it("renders the book-cover band …")` test with:
```tsx
it("renders the cover panel, heading, and kicker", () => {
  render(<Login />);
  expect(screen.getByTestId("auth-cover")).toBeInTheDocument();
  expect(screen.getByAltText(/book cover/i)).toBeInTheDocument();
  expect(screen.getByText("Optimization Studio")).toBeInTheDocument();
  expect(screen.getByText("By Prof. Michael Watson")).toBeInTheDocument();
});

it("exposes the developer contact links (mockup values)", () => {
  render(<Login />);
  expect(screen.getByTitle("LinkedIn").closest("a")).toHaveAttribute("href", "https://www.linkedin.com/in/shubhamkumarcse/");
  expect(screen.getByTitle("Email").closest("a")).toHaveAttribute("href", "mailto:shubham.shubham4995@gmail.com");
});
```
- Replace the narrow-viewport footer test with a split-layout structural check:
```tsx
it("uses a stacked-on-narrow / side-by-side-on-wide split layout", () => {
  render(<Login />);
  const shell = screen.getByTestId("auth-shell");
  expect(shell.className).toContain("flex-col");
  expect(shell.className).toContain("md:flex-row");
  // cover collapses to a top band on narrow, becomes the left rail on wide
  expect(screen.getByTestId("auth-cover").className).toContain("md:basis-[44%]");
});
```
- Update the register-link test:
```tsx
it("links to the register page", () => {
  render(<Login />);
  expect(screen.getByText(/Register with your course email/)).toBeInTheDocument();
});
```

- [ ] **Step 6: Update `Register.test.tsx`**

Mirror Step 6 for Register: keep submit, cache-write+navigate, password-hint-blocks-submit, 409, generic-error, and login-link tests. Delete the `mounts the app footer` test (add the "does not mount … auth-credit" variant), replace the band test with the cover/heading/kicker + contact-links tests, and replace the narrow-viewport test with the split-layout check. The `it("links to the login page")` test (`getByText("Log in")`) stays valid.

- [ ] **Step 7: Typecheck + run studio tests**

```bash
pnpm run typecheck && pnpm --filter studio test
```
Expected: PASS. Fix only cosmetic/structural assertions; never a behavioral one.

- [ ] **Step 8: Commit**

```bash
git add artifacts/studio/src/components/auth/AuthShell.tsx artifacts/studio/src/assets/book-cover.jpg artifacts/studio/src/pages/auth/Login.tsx artifacts/studio/src/pages/auth/Register.tsx artifacts/studio/src/__tests__/Login.test.tsx artifacts/studio/src/__tests__/Register.test.tsx
git commit -m "[bundle4-T1] auth split-screen" -- artifacts/studio/src/components/auth/AuthShell.tsx artifacts/studio/src/assets/book-cover.jpg artifacts/studio/src/pages/auth/Login.tsx artifacts/studio/src/pages/auth/Register.tsx artifacts/studio/src/__tests__/Login.test.tsx artifacts/studio/src/__tests__/Register.test.tsx
```

---

## Task T2 — Landing hero shell (`[bundle4-T2]`)

**Files:**
- Modify: `artifacts/studio/src/components/AppShell.tsx`
- Modify: `artifacts/studio/src/App.tsx`
- Modify: `artifacts/studio/src/pages/Landing.tsx`
- Test: `artifacts/studio/src/__tests__/AppShell.test.tsx`, `artifacts/studio/src/__tests__/Landing.test.tsx`

**Interfaces:**
- Consumes: `AppShell` currently `{ userEmail, children, heroTitle? }`.
- Produces: `AppShell` gains `hero?: boolean`. When `hero`, the band renders the expanded hero (860px container, 32px title, tagline). `heroTitle` still supplies the title text in both modes. Landing chapter cards gain a footer (`data-testid="landing-card-footer-<modelId>"`) — T2 baseline is `start →` for every card, filled in by T4.

- [ ] **Step 1: Add the `hero` variant to `AppShell.tsx`**

Add `hero?: boolean` to the props interface and branch the header. Keep the existing compact header exactly as-is for the non-hero path (logout logic/`data-testid`s unchanged).

```tsx
interface AppShellProps {
  userEmail: string;
  children: ReactNode;
  heroTitle?: string;
  hero?: boolean;
}
```
Replace the current `<header>…</header>` with:
```tsx
{hero ? (
  <header className="scnd-band flex-shrink-0">
    <div className="max-w-[860px] mx-auto px-6 py-[30px] flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="scnd-kicker">Optimization Studio by Prof. Michael Watson</div>
        <div className="scnd-display font-bold" style={{ fontSize: "32px", lineHeight: 1.1, color: "var(--green-400)" }}>{heroTitle}</div>
        <div className="mt-2" style={{ fontSize: "13px", color: "var(--ink-300)" }} data-testid="hero-tagline">
          Build a scenario on the map, solve it with a real optimizer, compare the results.
        </div>
      </div>
      <div className="flex items-center gap-2.5 flex-shrink-0">
        <span className="text-sm" style={{ color: "var(--ink-300)" }} data-testid="text-user-email">{userEmail}</span>
        <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout" style={{ color: "var(--ink-300)" }}>Log out</Button>
      </div>
    </div>
  </header>
) : (
  <header className="scnd-band flex-shrink-0 flex items-center gap-3 px-4 py-3">
    <div className="flex-1 min-w-0">
      <div className="scnd-kicker">Optimization Studio by Prof. Michael Watson</div>
      {heroTitle
        ? <div className="scnd-display text-lg font-semibold" style={{ color: "var(--green-400)" }}>{heroTitle}</div>
        : <div className="scnd-display text-sm font-semibold" style={{ color: "var(--surface-band-fg)" }}>SCND Optimization Studio</div>}
    </div>
    <span className="text-sm" style={{ color: "var(--ink-300)" }} data-testid="text-user-email">{userEmail}</span>
    <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout" style={{ color: "var(--ink-300)" }}>Log out</Button>
  </header>
)}
```

- [ ] **Step 2: Pass `hero` on `/` in `App.tsx`**

Extend `authedOnly` to forward a `hero` flag and pass it only for the `/` route:
```tsx
function authedOnly(children: ReactNode, heroTitle?: string, hero?: boolean) {
  return user ? <AppShell userEmail={user.email} heroTitle={heroTitle} hero={hero}>{children}</AppShell> : <Redirect to="/login" />;
}
```
```tsx
<Route path="/">{authedOnly(<Landing />, "Network Design Labs", true)}</Route>
```

- [ ] **Step 3: Landing baseline card footer + subtitle**

In `Landing.tsx`, add a helper for the chapter number and give each card a footer. Keep the container widen + subtitle + `Chapter N ·` prefix.

- Widen the body container: `className="max-w-3xl mx-auto p-8"` → `className="max-w-[860px] mx-auto p-8"`.
- Add above the component (module scope):
```tsx
function chapterNumber(chapterLabel: string): string {
  const n = chapterLabel.match(/\d+/)?.[0] ?? "";
  return n.padStart(2, "0");
}
```
- Inside each chapter `Card`, replace `<CardContent />` with a footer row:
```tsx
<CardContent>
  <div className="flex items-center justify-between" data-testid={`landing-card-footer-${c.modelId}`}>
    <span className="scnd-display font-bold" style={{ fontSize: "15px", color: "var(--green-400)" }}>{chapterNumber(c.chapter)}</span>
    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "10.5px", color: "var(--text-faint)" }}>start →</span>
  </div>
</CardContent>
```
- In the Recent-solves section, add the subtitle under the `<h2>`:
```tsx
<h2 className="scnd-display text-sm font-semibold text-foreground mb-1">Recent solves</h2>
<p className="text-xs text-muted-foreground mb-3">Recent solve attempts — click to open one.</p>
```
- Add a mono `Chapter N ·` prefix inside each history row, before the scenario name:
```tsx
<div className="flex items-center gap-2 min-w-0">
  <span className="font-mono text-[10.5px] text-muted-foreground">
    {chapterForModelId(h.modelId)?.chapter ?? ""} ·
  </span>
  <span className="truncate font-medium text-foreground">{h.scenarioName}</span>
  {/* existing Badge unchanged */}
</div>
```
Import `chapterForModelId` from `@/lib/chapters` (add to the existing import).

- [ ] **Step 4: AppShell hero tests**

Keep the existing AppShell tests (logout, email/children, `.scnd-band`, heroTitle-renders, wordmark-fallback, layout). Add:
```tsx
describe("AppShell hero variant", () => {
  it("renders the tagline and heroTitle in the expanded band when hero is set", () => {
    render(
      <AppShell userEmail="a@b.edu" heroTitle="Network Design Labs" hero>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getByText("Network Design Labs")).toBeInTheDocument();
    expect(screen.getByTestId("hero-tagline")).toHaveTextContent(/build a scenario/i);
    expect(screen.getByTestId("text-user-email")).toHaveTextContent("a@b.edu");
  });

  it("omits the tagline in the compact (non-hero) band", () => {
    render(
      <AppShell userEmail="a@b.edu" heroTitle="Network Design Labs">
        <div>content</div>
      </AppShell>,
    );
    expect(screen.queryByTestId("hero-tagline")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Landing baseline tests**

The existing Landing tests keep passing (chapter list, links, recent solves). Add:
```tsx
it("shows a chapter number and a start affordance on each card (baseline)", () => {
  mockUseGetSolveHistory.mockReturnValue({ data: [] });
  renderLanding();
  const footer = screen.getByTestId("landing-card-footer-p-median-us");
  expect(footer).toHaveTextContent("03");
  expect(footer).toHaveTextContent("start");
});

it("prefixes recent-solve rows with the chapter label", () => {
  mockUseGetSolveHistory.mockReturnValue({
    data: [{ id: 10, scenarioId: 1, scenarioName: "Baseline", modelId: "p-median-us", status: "succeeded", objective: 1, weightedAvgDistanceMi: 1, runTimeSec: 1, queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z" }],
  });
  renderLanding();
  expect(screen.getByText(/Chapter 3 ·/)).toBeInTheDocument();
});
```

- [ ] **Step 6: Typecheck + studio tests**

```bash
pnpm run typecheck && pnpm --filter studio test
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -m "[bundle4-T2] landing hero" -- artifacts/studio/src/components/AppShell.tsx artifacts/studio/src/App.tsx artifacts/studio/src/pages/Landing.tsx artifacts/studio/src/__tests__/AppShell.test.tsx artifacts/studio/src/__tests__/Landing.test.tsx
```

---

## Task T3 — `GET /landing-summary` endpoint + client regen (`[bundle4-T3]`)

**Files:**
- Create: `artifacts/api-server/src/routes/landingSummary.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Regenerate: `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**` (via orval — never hand-edit)
- Test: `artifacts/api-server/src/__tests__/routes.test.ts`

**Interfaces:**
- Produces: `GET /landing-summary` → `{ perChapter: { modelId, scenarioCount, lastSucceededSolveAt }[], totals: { scenarios, solvedScenarios } }`; generated hook `useGetLandingSummary` (consumed by T4).

- [ ] **Step 1: Write the route**

Create `artifacts/api-server/src/routes/landingSummary.ts`:

```ts
import { Router } from "express";
import { and, eq, max, count, countDistinct } from "drizzle-orm";
import { db, scenariosTable, solveJobsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.use(requireAuth);

// Bundle 4 — per-chapter + total scenario/solve counts for the Landing page.
// Two grouped queries, no per-chapter loop. Both tenant columns are filtered
// on the solve query (solve_jobs.user_id AND scenarios.user_id are independent
// columns; filtering only the former would let a malformed A-owned job that
// points at a B-owned scenario leak B's data into A's summary).
router.get("/landing-summary", async (req, res) => {
  const userId = req.userId!;

  const scenarioRows = await db
    .select({ modelId: scenariosTable.modelId, scenarioCount: count() })
    .from(scenariosTable)
    .where(eq(scenariosTable.userId, userId))
    .groupBy(scenariosTable.modelId);

  const solveRows = await db
    .select({
      modelId: scenariosTable.modelId,
      lastSucceededSolveAt: max(solveJobsTable.finishedAt),
      solvedScenarios: countDistinct(solveJobsTable.scenarioId),
    })
    .from(solveJobsTable)
    .innerJoin(scenariosTable, eq(solveJobsTable.scenarioId, scenariosTable.id))
    .where(and(
      eq(solveJobsTable.userId, userId),
      eq(scenariosTable.userId, userId),
      eq(solveJobsTable.status, "succeeded"),
    ))
    .groupBy(scenariosTable.modelId);

  const solveByModel = new Map(solveRows.map((r) => [r.modelId, r]));

  const perChapter = scenarioRows.map((r) => {
    const s = solveByModel.get(r.modelId);
    return {
      modelId: r.modelId,
      scenarioCount: Number(r.scenarioCount),
      // max() over a timestamp column is typed `Date | null`; serialize it
      // directly — the TS `Date` constructor's types reject another `Date`.
      lastSucceededSolveAt: s?.lastSucceededSolveAt?.toISOString() ?? null,
    };
  });

  const totals = {
    scenarios: scenarioRows.reduce((a, r) => a + Number(r.scenarioCount), 0),
    solvedScenarios: solveRows.reduce((a, r) => a + Number(r.solvedScenarios ?? 0), 0),
  };

  res.json({ perChapter, totals });
});

export default router;
```

- [ ] **Step 2: Register the router**

In `artifacts/api-server/src/routes/index.ts`, import and mount it alongside `solveHistoryRouter`:
```ts
import landingSummaryRouter from "./landingSummary.js";
// …
router.use(landingSummaryRouter);
```

- [ ] **Step 3: Add the OpenAPI path + schemas**

In `lib/api-spec/openapi.yaml`, add the path right after the `/solve-history` block:
```yaml
  /landing-summary:
    get:
      operationId: getLandingSummary
      tags: [scenarios]
      summary: Per-chapter + total scenario/solve counts for the caller (Bundle 4)
      responses:
        "200":
          description: The caller's landing summary
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/LandingSummary"
        "401":
          description: Not authenticated
```
And add these schemas next to `SolveHistoryEntry` in `components/schemas`:
```yaml
    LandingSummary:
      type: object
      properties:
        perChapter:
          type: array
          items:
            $ref: "#/components/schemas/LandingSummaryChapter"
        totals:
          type: object
          properties:
            scenarios:
              type: integer
            solvedScenarios:
              type: integer
          required: [scenarios, solvedScenarios]
      required: [perChapter, totals]

    LandingSummaryChapter:
      type: object
      properties:
        modelId:
          type: string
        scenarioCount:
          type: integer
        lastSucceededSolveAt:
          type: ["string", "null"]
          format: date-time
      required: [modelId, scenarioCount, lastSucceededSolveAt]
```

- [ ] **Step 4: Regenerate the client**

```bash
pnpm --filter @workspace/api-spec run codegen
```
Expected: orval writes `lib/api-zod` + `lib/api-client-react` and the `typecheck:libs` tail passes; `useGetLandingSummary` now exists. Do NOT hand-edit any generated file.

- [ ] **Step 5: Extend the shared test mocks (resolution #1 support)**

In `artifacts/api-server/src/__tests__/routes.test.ts`:
- Add `groupBy` to `makeChain`'s method list:
```ts
  ["select","from","where","orderBy","insert","values",
   "returning","update","set","delete","innerJoin","limit","groupBy"].forEach(m => {
```
- Add the aggregate helpers to the `drizzle-orm` mock (return inspectable markers):
```ts
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ col: _col, val })),
  and: vi.fn((...conds: unknown[]) => ({ and: conds })),
  desc: vi.fn((_col: unknown) => ({ desc: _col })),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ inArray: _col, vals })),
  max: vi.fn((_col: unknown) => ({ max: _col })),
  count: vi.fn(() => ({ count: true })),
  countDistinct: vi.fn((_col: unknown) => ({ countDistinct: _col })),
}));
```
- **Table-qualify the mocked column markers** so the two independent `userId`
  columns are distinguishable (resolution #3). Both were `"user_id"`, which let
  an `arrayContaining` pass with one predicate missing. No existing test asserts
  these marker strings (verified by grep — only the mock definition references
  them), so changing them is safe. Extend the `@workspace/db` mock objects:
```ts
  scenariosTable: { id: "scenarios.id", name: "name", userId: "scenarios.user_id", modelId: "scenarios.model_id", createdAt: "created_at", updatedAt: "updated_at" },
  solveJobsTable: { id: "solve_jobs.id", scenarioId: "solve_jobs.scenario_id", userId: "solve_jobs.user_id", status: "solve_jobs.status", finishedAt: "solve_jobs.finished_at" },
```

- [ ] **Step 6: Write the endpoint tests**

Add to `routes.test.ts`. Uses the existing `loginAs` helper. `loginAs()`
consumes one `db.select` for its user lookup; call `mockDb.select.mockClear()`
right after it returns so the endpoint's two selects are `calls[0]`/`calls[1]`
and the count assertion sees exactly 2 (resolution #2). Markers are
table-qualified (Step 5) so the two ownership predicates are distinguishable
(resolution #3).

```ts
import { scenariosTable, solveJobsTable } from "@workspace/db"; // (already imported in this file)

describe("GET /landing-summary", () => {
  beforeEach(() => { resetLoginRateLimiterForTests(); });

  it("401s when unauthenticated", async () => {
    const res = await request(app).get("/api/landing-summary");
    expect(res.status).toBe(401);
  });

  it("returns zeros for a user with no scenarios or solves", async () => {
    const cookie = await loginAs("user-A");
    mockDb.select.mockClear(); // drop loginAs's own select from the call history
    mockDb.select.mockReturnValueOnce(makeChain([])).mockReturnValueOnce(makeChain([]));

    const res = await request(app).get("/api/landing-summary").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ perChapter: [], totals: { scenarios: 0, solvedScenarios: 0 } });
    expect(mockDb.select).toHaveBeenCalledTimes(2);
  });

  it("builds exactly two grouped queries, both tenant-scoped, with the right projections (resolutions #1/#2/#3)", async () => {
    const cookie = await loginAs("user-A");
    mockDb.select.mockClear();
    const scen = makeChain([{ modelId: "p-median-us", scenarioCount: 3 }]);
    const solve = makeChain([{ modelId: "p-median-us", lastSucceededSolveAt: new Date("2026-09-03T12:00:00Z"), solvedScenarios: 1 }]);
    mockDb.select.mockReturnValueOnce(scen).mockReturnValueOnce(solve);

    await request(app).get("/api/landing-summary").set("Cookie", cookie);

    // exactly two selects (loginAs's was cleared)
    expect(mockDb.select).toHaveBeenCalledTimes(2);

    // --- projections (proves both aggregations are issued) ---
    // count() → { count: true }; max(col) → { max: col }; countDistinct(col) → { countDistinct: col }
    const scenProj = mockDb.select.mock.calls[0][0];
    expect(scenProj.scenarioCount).toEqual({ count: true });
    const solveProj = mockDb.select.mock.calls[1][0];
    expect(solveProj.lastSucceededSolveAt).toEqual({ max: solveJobsTable.finishedAt });
    expect(solveProj.solvedScenarios).toEqual({ countDistinct: solveJobsTable.scenarioId });

    // --- scenarios query: user-scoped, grouped by model ---
    expect(scen.where).toHaveBeenCalledWith({ col: scenariosTable.userId, val: "user-A" });
    expect(scen.groupBy).toHaveBeenCalledWith(scenariosTable.modelId);

    // --- solve query: BOTH independent user_id predicates + succeeded status ---
    // Exact toEqual (not arrayContaining): with table-qualified markers the two
    // ownership predicates are distinct, so this fails if either is dropped.
    // Filtering solve_jobs.user_id ALONE is insufficient — scenarios.user_id is
    // an independent column with no DB constraint tying it to the job's owner.
    const whereArg = (solve.where as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(whereArg.and).toEqual([
      { col: solveJobsTable.userId, val: "user-A" },   // "solve_jobs.user_id"
      { col: scenariosTable.userId, val: "user-A" },   // "scenarios.user_id"
      { col: solveJobsTable.status, val: "succeeded" },
    ]);
    expect(solve.groupBy).toHaveBeenCalledWith(scenariosTable.modelId);
  });

  it("maps grouped rows to perChapter + honest totals; distinct-scenario solves (resolution #4)", async () => {
    const cookie = await loginAs("user-A");
    mockDb.select.mockClear();
    const scen = makeChain([
      { modelId: "p-median-us", scenarioCount: 3 },
      { modelId: "transport-coal", scenarioCount: 2 },
    ]);
    // p-median-us: one scenario solved many times → solvedScenarios stays 1
    const solve = makeChain([
      { modelId: "p-median-us", lastSucceededSolveAt: new Date("2026-09-03T12:00:00Z"), solvedScenarios: 1 },
    ]);
    mockDb.select.mockReturnValueOnce(scen).mockReturnValueOnce(solve);

    const res = await request(app).get("/api/landing-summary").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.perChapter).toEqual([
      { modelId: "p-median-us", scenarioCount: 3, lastSucceededSolveAt: "2026-09-03T12:00:00.000Z" },
      { modelId: "transport-coal", scenarioCount: 2, lastSucceededSolveAt: null },
    ]);
    expect(res.body.totals).toEqual({ scenarios: 5, solvedScenarios: 1 });
  });
});
```

**Note on cross-link coverage (resolution #3, honest scope):** this suite mocks
Drizzle, so no SQL executes and a literal "A-owned job → B-owned scenario" row
cannot be *filtered* here. The both-side-ownership proof is the exact
`whereArg.and` assertion above: it fails if the route omits either the
`scenarios.user_id` or `solve_jobs.user_id` predicate. A runtime row-exclusion
test would require a real-Postgres harness, which this suite does not have.

- [ ] **Step 7: Typecheck + api-server tests**

```bash
pnpm run typecheck && pnpm --filter api-server test
```
Expected: PASS. (If `resultEnvelope.test.ts`'s Brazil case times out, it is the documented environmental flake — re-run it in isolation `npx vitest run src/__tests__/resultEnvelope.test.ts` to confirm; it is unrelated to this task.)

- [ ] **Step 8: Commit (spec + regen + route together — hard rule #4)**

```bash
git commit -m "[bundle4-T3] landing-summary endpoint + client regen" -- \
  artifacts/api-server/src/routes/landingSummary.ts \
  artifacts/api-server/src/routes/index.ts \
  lib/api-spec/openapi.yaml \
  artifacts/api-server/src/__tests__/routes.test.ts \
  lib/api-zod/src/generated lib/api-client-react/src/generated
```
(Include exactly the generated paths orval changed — verify with `git status` first.)

---

## Task T4 — Landing consumes the summary (`[bundle4-T4]`)

**Files:**
- Create: `artifacts/studio/src/lib/relativeTime.ts`
- Create: `artifacts/studio/src/lib/__tests__/relativeTime.test.ts`
- Modify: `artifacts/studio/src/pages/Landing.tsx`
- Test: `artifacts/studio/src/__tests__/Landing.test.tsx`

**Interfaces:**
- Consumes: `useGetLandingSummary` (T3), `perChapter`/`totals` shape.
- Produces: `formatRelativeTime(iso: string, now?: number): string`.

- [ ] **Step 1: Write `relativeTime.ts`**

```ts
// Coarse relative-time label (m/h/d granularity) for Landing's recent-solve
// footers. Pure + injectable `now` so it's deterministic under test.
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const min = Math.floor(Math.max(0, now - then) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
```

- [ ] **Step 2: Unit-test it**

Create `artifacts/studio/src/lib/__tests__/relativeTime.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "@/lib/relativeTime";

const base = Date.parse("2026-09-03T12:00:00Z");

describe("formatRelativeTime", () => {
  it("returns 'just now' under a minute", () => {
    expect(formatRelativeTime("2026-09-03T11:59:30Z", base)).toBe("just now");
  });
  it("minutes / hours / days", () => {
    expect(formatRelativeTime("2026-09-03T11:58:00Z", base)).toBe("2m ago");
    expect(formatRelativeTime("2026-09-03T09:00:00Z", base)).toBe("3h ago");
    expect(formatRelativeTime("2026-08-29T12:00:00Z", base)).toBe("5d ago");
  });
  it("clamps a future timestamp to 'just now'", () => {
    expect(formatRelativeTime("2026-09-03T12:05:00Z", base)).toBe("just now");
  });
});
```

- [ ] **Step 3: Consume the summary in `Landing.tsx`**

Add imports:
```tsx
import { useGetSolveHistory, useGetLandingSummary } from "@workspace/api-client-react";
import { formatRelativeTime } from "@/lib/relativeTime";
```
At the top of the component:
```tsx
const { data: summary, isPending, isError } = useGetLandingSummary();
// TanStack retains the last successful `data` through a background-refetch
// error, so `summary != null` alone would treat a stale-then-errored summary
// as ready. Gate on the flags too — pending OR errored falls back to the T2
// baseline (number + start →, no stats line), never a half-filled footer.
const ready = !isPending && !isError && summary != null;
const byModel = new Map((summary?.perChapter ?? []).map((r) => [r.modelId, r]));

// The single most-recently-solved chapter (across ALL rows, incl. hidden) —
// that card shows "active"; every other shows "start →".
let activeModelId: string | undefined;
let activeAt = -Infinity;
for (const r of summary?.perChapter ?? []) {
  if (!r.lastSucceededSolveAt) continue;
  const t = new Date(r.lastSucceededSolveAt).getTime();
  if (t > activeAt) { activeAt = t; activeModelId = r.modelId; }
}

const visibleLabs = CHAPTERS.filter((c) => !c.hiddenFromLanding).length;
```
Replace the header block (`<h1>Labs</h1>` + `<p>`) with a row that carries the stats line when ready:
```tsx
<div className="flex items-baseline justify-between mb-6">
  <div>
    <h1 className="scnd-display text-2xl font-semibold mb-1">Labs</h1>
    <p className="text-muted-foreground">Pick a chapter to start or continue a scenario.</p>
  </div>
  {ready && summary && (
    <span data-testid="landing-stats-line" className="font-mono text-[10.5px] text-muted-foreground whitespace-nowrap">
      {visibleLabs} labs · {summary.totals.scenarios} scenarios · {summary.totals.solvedScenarios} solved
    </span>
  )}
</div>
```
Replace the T2 card footer with the live version:
```tsx
<CardContent>
  {(() => {
    const entry = byModel.get(c.modelId);
    const status = !ready
      ? null
      : !entry || entry.scenarioCount === 0
        ? "no scenarios yet"
        : entry.lastSucceededSolveAt
          ? `${entry.scenarioCount} scenarios · solved ${formatRelativeTime(entry.lastSucceededSolveAt)}`
          : `${entry.scenarioCount} scenarios`;
    const isActive = ready && c.modelId === activeModelId;
    return (
      <div className="flex items-center justify-between gap-2" data-testid={`landing-card-footer-${c.modelId}`}>
        <span className="flex items-center gap-2 min-w-0">
          <span className="scnd-display font-bold flex-shrink-0" style={{ fontSize: "15px", color: "var(--green-400)" }}>{chapterNumber(c.chapter)}</span>
          {status && <span className="truncate" style={{ fontFamily: "var(--app-font-mono)", fontSize: "10.5px", color: "var(--text-muted)" }}>{status}</span>}
        </span>
        {isActive
          ? <Badge variant="outline" className="text-[10px] text-[color:var(--success)] border-[color:var(--success-border)] bg-[color:var(--success-bg)]">active</Badge>
          : <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "10.5px", color: "var(--text-faint)" }}>start →</span>}
      </div>
    );
  })()}
</CardContent>
```
(`Badge` is already imported in Landing.tsx. `ready` false — i.e. loading or error — renders exactly the T2 state: number + `start →`, no status text, no stats line.)

- [ ] **Step 4: Update `Landing.test.tsx`**

Add `useGetLandingSummary` to the mock and cover the new branches:
```tsx
const { mockUseGetSolveHistory, mockUseGetLandingSummary } = vi.hoisted(() => ({
  mockUseGetSolveHistory: vi.fn(() => ({ data: [] as unknown[] })),
  mockUseGetLandingSummary: vi.fn(() => ({ data: undefined as unknown, isPending: false, isError: false })),
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetSolveHistory: mockUseGetSolveHistory,
  useGetLandingSummary: mockUseGetLandingSummary,
}));
```
Reset `mockUseGetLandingSummary` to the default (`{ data: undefined, isPending: false, isError: false }`) in a `beforeEach` (or per-test) so the pre-existing Landing tests see the baseline and are unaffected.
```tsx
describe("Landing — live summary (T4)", () => {
  it("falls back to the baseline (number + start →, no stats line) while summary is unavailable", () => {
    mockUseGetLandingSummary.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderLanding();
    expect(screen.queryByTestId("landing-stats-line")).not.toBeInTheDocument();
    const footer = screen.getByTestId("landing-card-footer-p-median-us");
    expect(footer).toHaveTextContent("03");
    expect(footer).toHaveTextContent("start");
  });

  it("falls back to the baseline when a background refetch errors even though cached data is retained", () => {
    // isError with stale data present must still render the T2 baseline —
    // never a half-filled footer built from a summary the server rejected.
    mockUseGetLandingSummary.mockReturnValue({
      data: { perChapter: [{ modelId: "p-median-us", scenarioCount: 3, lastSucceededSolveAt: "2020-01-01T00:00:00Z" }], totals: { scenarios: 3, solvedScenarios: 1 } },
      isPending: false,
      isError: true,
    });
    renderLanding();
    expect(screen.queryByTestId("landing-stats-line")).not.toBeInTheDocument();
    const footer = screen.getByTestId("landing-card-footer-p-median-us");
    expect(footer).toHaveTextContent("start");
    expect(footer).not.toHaveTextContent("active");
    expect(footer).not.toHaveTextContent("scenarios");
  });

  it("renders per-card status, the active badge, and the honest stats line", () => {
    mockUseGetLandingSummary.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        perChapter: [
          { modelId: "p-median-us", scenarioCount: 3, lastSucceededSolveAt: "2020-01-01T00:00:00Z" },
          { modelId: "transport-coal", scenarioCount: 2, lastSucceededSolveAt: null },
        ],
        totals: { scenarios: 5, solvedScenarios: 1 },
      },
    });
    renderLanding();

    // stats line — distinct-solve count labelled "solved" (resolution #4)
    expect(screen.getByTestId("landing-stats-line")).toHaveTextContent("3 labs · 5 scenarios · 1 solved");

    // p-median-us: solved + active
    const us = screen.getByTestId("landing-card-footer-p-median-us");
    expect(us).toHaveTextContent(/3 scenarios · solved .* ago/);
    expect(us).toHaveTextContent("active");

    // transport-coal: scenarios, not yet solved, start →
    const coal = screen.getByTestId("landing-card-footer-transport-coal");
    expect(coal).toHaveTextContent("2 scenarios");
    expect(coal).toHaveTextContent("start");
    expect(coal).not.toHaveTextContent("active");

    // brazil: absent from perChapter → "no scenarios yet"
    expect(screen.getByTestId("landing-card-footer-p-median-brazil")).toHaveTextContent("no scenarios yet");
  });
});
```
Ensure the pre-existing tests still set `mockUseGetLandingSummary` to `{ data: undefined }` (baseline) so their assertions are unaffected — add it to the top-level `beforeEach` if the file has one, else set per test.

- [ ] **Step 5: Typecheck + api-server + studio tests**

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "[bundle4-T4] landing consumes landing-summary" -- \
  artifacts/studio/src/lib/relativeTime.ts \
  artifacts/studio/src/lib/__tests__/relativeTime.test.ts \
  artifacts/studio/src/pages/Landing.tsx \
  artifacts/studio/src/__tests__/Landing.test.tsx
```

---

## Final gate (after T4 lands)

Run the repository's complete verification gate on the integrated bundle
(`CLAUDE.md`/`AGENTS.md`), including the solver pytest suite — Bundle 4 touches
no Python, so pytest is a no-regression confirmation, but the gate is not
complete without it:

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
Expected: all green. If `resultEnvelope.test.ts`'s p-median-brazil case times
out under the parallel run, confirm it is the documented environmental flake via
`npx vitest run src/__tests__/resultEnvelope.test.ts` (isolated → passes);
Bundle 4 changes no api-server solver path. `e2e_accuracy.py` is not required
(no solver/dataset change).

## Execution order

T1 ∥ T2 ∥ T3 are file-disjoint (auth pages / AppShell+App+Landing-baseline / backend) and run in parallel. **T4 is last** — it needs T3's generated hook and edits the same `Landing.tsx` T2 touched. In the shared worktree, serialize the two Landing.tsx writers (T2 then T4) and commit each task with an explicit pathspec. Each task runs from its own assigned worktree root; all commands are repo-relative (resolution #4).

## Self-review notes (author)

- Spec coverage: T1↔spec T1, T2↔spec T2, T3↔spec T3 (+resolutions #1/#2), T4↔spec T4 (+resolutions #3/#4). Resolution #3 (subtitle copy) lands in T2 Step 3.
- Type consistency: route returns `solvedScenarios` everywhere; hook name `useGetLandingSummary`; `chapterNumber`/`formatRelativeTime` signatures match their call sites; `byModel`/`activeModelId` derived once.
- No placeholders; every code step shows full code. `book-cover.jpg` copied (not referenced from docs). `groupBy`/aggregate mocks added so the query-shape test can run without a real DB.
