# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Students** of Prof. Michael Watson's supply-chain network design course work the textbook's labs: build a facility-location scenario, solve it with a real optimizer, compare scenarios, and ask WatBot, the course tutor. (From the PRD and the app's copy; the owner confirmed the course and the book's role.)
- **The owner/operator** runs the app and watches how it is used. Admin surfaces (the WatBot and feedback dashboard, 2026-11-26) serve the owner now and instructors later.
- **Instructors** are a planned audience for admin surfaces, scoped to their own classes (classes and rosters are not built yet).
- **Students never see admin surfaces** (owner, 2026-11-26).

## Product Purpose

Network Design Labs is the hands-on companion to Watson et al., *Supply Chain Network Design*. Students configure p-median, transportation and multi-echelon scenarios on the book's datasets, solve them with a real ILP solver, and compare results; success means a student reaches the book's published answers by building the model themselves.

## Positioning

It is the book's own labs: the book's datasets and published answers, solved by a real ILP solver (PuLP/CBC), with a tutor that answers only from cited course sources and never gives away results.

## Operating Context

- Students use it alongside the textbook and course notebooks, in a desktop browser, for graded lab work under their instructor's rules.
- WatBot answers from the book and notebooks with citations; its answers, ratings and reports are stored with the student's account.
- Site feedback (the "Send feedback" pop-up) is stored anonymously: no account, session or IP.

## Capabilities and Constraints

- Web app (React + Vite studio, Express API, Postgres), deployed on Render as `app.networkdesignbook.com`.
- Seven chapter models, miles-canonical. Chapter access can be locked per model.
- Users carry a role: `student`, `instructor` (reserved), or `admin` (unlocks `/admin`, the WatBot and site-feedback dashboard; granted per `docs/ops/admin-role.md`). No class or roster model exists yet.
- Legal text names the app "Network Design Labs". Terms and Privacy Notice consent is required at sign-up and log-in (version 2026-11-25).

## Brand Commitments

- The existing studio look (olive and serif, from the Design Upgrade) is the brand. New screens extend it; they do not replace it (owner, 2026-11-26).
- "By Prof. Michael Watson" attribution and the book cover appear in the app's identity.

## Evidence on Hand

- Textbook datasets and published answers (`solvers/*`, `attached_assets/`). Book passages and transcriptions are private: never in public places such as the repo, commits or shared pages.
- No testimonials, adoption numbers or benchmarks are on hand; do not invent them.

## Product Principles

1. Students build the answer; the product never hands it over.
2. Every tutor claim rests on a cited course source.
3. Student privacy comes first: show identity only where the Privacy Notice says so.
4. Real solver, real numbers: match the book's published results.

## Accessibility & Inclusion

- Accessibility is a firm requirement (owner, 2026-11-26): keyboard use, readable contrast, and colour-blind-safe charts with a table alternative.
