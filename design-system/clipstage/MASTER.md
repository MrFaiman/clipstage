# Clipstage / Studio refresh

Experimental branch: `design/frontend-refresh`.

## Direction

A production desk, not a marketing landing page: footage takes priority, and the status pipeline connects the overview directly to filtering. Dark charcoal framing, a pale neutral canvas, and restrained lavender accents. No invented activity, growth statistics, or recording state. Counts explicitly represent loaded clips.

## Skill provenance

Used https://github.com/nextlevelbuilder/ui-ux-pro-max-skill at `09170eec67eefd46a7ae85de61b40c194020f997` (downloaded outside the repository).

- `video creator dashboard dark studio`: creative typography, high-contrast studio surfaces. Storytelling layout rejected as unsuitable for a dashboard.
- `SaaS dashboard productivity`: verified Flat Design result; clean boundaries, simple fast transitions, no complex onboarding.
- `dashboard accessible contrast` / ux: 4.5:1 text contrast, descriptive control names.
- `responsive dashboard accessibility` / nextjs: responsive imagery and existing App Router preserved.

The palette is a deliberate synthesis, not an exact generated palette. Existing system fonts remain local to avoid network-dependent typography or adding font payloads.

## Tokens

- Canvas: #f7f6fa
- Surface: #ffffff
- Foreground: #20212b
- Secondary text: #62616f
- Studio surface: #20202b
- Studio secondary text: #c1bdcf
- Action: #6440b4 with white text
- Accent surface: #e1d6ff with #382165 text
- Focus: #7450c5
- Border: #e3e1eb

## Interaction and layout

- Main controls have at least 44px targets; focus indication remains visible.
- Pipeline buttons select existing filters and expose `aria-pressed`.
- Status labels remain text-based, never color alone.
- Use real clip counts only; the loaded-clip scope is visible.
- Media cards retain original access, upload, assignment and review behavior.
- Desktop: fixed navigation, four-stage pipeline, responsive three/two-column media grid.
- Mobile: existing navigation drawer, two-column pipeline, wrapped filters, single-column media grid.
- Hover changes boundaries/colors without moving cards. Reduced motion disables transitions.

## Implementation

`apps/web/src/app/studio.css` is an isolated experimental visual layer following `globals.css`. `StudioOverview` replaces decorative recording artwork with actionable workspace information. Team, account settings, OBS, login and upload share the same color and control tokens. The video editor keeps its established workflow.
