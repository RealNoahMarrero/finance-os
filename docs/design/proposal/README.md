# Finances 2.0 — design proposal (for approval)

Open `index.html` in a browser (all frames; add `?theme=dark` for dark) or see `png/` (light and dark for every frame).
All data is synthetic. Emoji glyphs are placeholders for a proper line-icon set. Re-render with `node docs/design/proposal/render.mjs`.

## Direction
**Modern fintech × premium editorial.** Warm paper neutrals, a deep *ink-teal* accent (replaces the current green), a restrained *brass* highlight for emphasis, terracotta for negatives, muted forest for positives. In dark mode the paper becomes a deep blue-black with a lifted teal accent — not charcoal-and-red.
**Type:** Newsreader (serif) for page titles, section titles and the large figures; Inter for interface text, with tabular figures on every amount. Both are open-licence and self-hosted (no CDN).

## Frames (`png/`)
| Screen | Desktop | Mobile |
|---|---|---|
| Design system | `system-*` | — |
| Home | `home-d-*` | `home-m-*` |
| Bills (list, guided payment, calendar) | `bills-d-*`, `bills-cal-d-*` | `bills-m-*` |
| Budget (list + detail pane) | `budget-d-*` | `budget-m-*` |
| Activity (list/detail, scheduled group) | `activity-d-*` | `activity-m-*` |

## What changes versus today, and why it is easier
- **Home**: about 11 stacked sections become 4 purposes: *Where you stand* (net position + account strip), *Needs attention* (actionable rows, one tap each), *Coming up*, and *Budget* (one Ready-to-Assign number and one **Move money** button), plus recent activity. Each amount appears once.
- **Bills**: one row per bill. A bill two months behind is **one row with "2 missed"**, expandable to its occurrences, with the honest note that its category holds enough for one payment. **Pay** opens a guided single-confirm review (amount, account, date, and the exact budget effect). "Already paid? Link an existing transaction" is the explicit no-duplicate exception. **List / Calendar** is a visible switch; **Income** and **Paused & archived** are first-level tabs.
- **Budget**: a plain grouped list — name, one status phrase, one amount. Targets, spending, schedule, pause/archive/debt and linked bill live in the detail pane (desktop) or sheet (mobile). Exactly one Move money button; Ready to Assign is just a source/destination in it.
- **Activity**: list/detail on desktop; a dashed **Scheduled · not yet posted** group is visibly different from posted rows; Income/Spending/Net stay on top; filters are compact.
- **Mobile**: bottom bar of five (Home · Activity · **+** · Bills · Budget) and a labelled **More** button in the top bar containing Accounts, Insights and Settings.

## Decisions needed (one answer is enough)
1. **Palette & type** — ink-teal + brass + Newsreader/Inter: approve, or ask for another direction.
2. **Mobile navigation** — *A (shown)*: Home · Activity · + · Bills · Budget, with Accounts/Insights/Settings under More. *B*: Home · Accounts · + · Bills · Budget, with Activity/Insights/Settings under More.
3. **Home headline** — lead with *Net position* (shown; negative in the sample because cards and a loan are included) or with *Cash & savings*.
4. **Detail pattern** — right-hand detail pane on desktop instead of modals; bottom sheets on mobile.
5. **Icons** — replace the emoji placeholders with one line-icon set plus optional user emoji.

Anything not answered will follow what is shown.
