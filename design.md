# BenchQ design system — v3

Updated September 23, 2026. This is the visual source of truth for BenchQ.
Live reference: `/design-system`. Runtime tokens: `src/app/globals.css`.

This version replaces the previous flat/navy-tinted system. The user's six
Microdose and Synapse references establish the new direction: compact, clean,
frosted application chrome, an opaque white rounded workspace, quiet borders,
raised gradient controls, and soft monospace metadata. Reference screenshots
inform the visual language; their logos, copy, and unrelated product features
are not copied. BenchQ's existing brand assets and staffing workflows remain.

## 1. Principles

- Information first. Dense does not mean crowded; use consistent alignment and grouping.
- Glass outside, paper inside. Blur the app frame, never tables or primary reading surfaces.
- Most of the screen is neutral. Color communicates actions, status, or identity.
- Depth is subtle: a thin border, a contact shadow, an inset highlight.
- Keep the existing Host Grotesk family and JetBrains Mono. Serve fonts locally.
- Light is default. Dark uses the brand navy (#071A37) as the workspace base,
  with an even deeper canvas (#030A16) behind the frame. All surface shades
  step upward from this navy: borders, insets, and glass tones are derived
  from the same hue family for a cohesive, deeply saturated night mode.
- There are no claim states (dropped 2026-11-05): no Verified / Unverified / Contradicted chips, no export block.

## 2. Layout and density

| Element | Desktop | Compact / mobile |
| --- | --- | --- |
| Outer canvas inset | 10px | 4px |
| Frosted frame inset | 8px | 4px |
| Sidebar expanded | 208px | 48px icon rail below 768px |
| Sidebar collapsed | 60px | Same mobile rail |
| Workspace radius | 16px | 16px |
| Frame radius | 22px | 16px |
| Topbar | 52px minimum | 52px minimum |
| Page inset | 24px | 18px vertical / 14px horizontal |
| Section gap | 24px | 20–24px |
| Card inset | 16px | 12–16px |
| Control heights | 28 / 32 / 36px | At least 40px for primary touch actions |
| Table row heights | 32 / 36 / 44px | Table scrolls horizontally |
| Table header | 32px | Same |

The frame contains the sidebar and a separate opaque workspace. The topbar is
inside that white workspace, separated by a hairline. Never put gray canvas
behind the main page content. Use full available width up to a 1480px content
maximum. The sidebar remains available as an icon rail on mobile. Desktop
collapse is stored locally. Icon-only links retain accessible names and titles.
Tables scroll inside their container, never force the whole page sideways.

## 3. Typography

Host Grotesk for UI and content. JetBrains Mono for tags, identifiers, metadata,
keyboard shortcuts, and technical values. Numeric data uses tabular figures.

| Class | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| text-display | 28 / 34 | 600 | Occasional large metric |
| text-h1 | 22 / 28 | 600 | Page heading |
| text-h2 | 17 / 24 | 600 | Section heading |
| text-h3 | 14 / 20 | 550 | Card heading |
| text-body | 13 / 20 | 400 | Main UI |
| text-body-strong | 13 / 20 | 550 | Emphasis |
| text-sm | 12 / 18 | inherited | Table cells, small controls |
| text-caption | 11 / 16 | inherited | Helper copy |
| text-label | 11 / 16 | 500 | Quiet section label |
| text-mono | 12 / 18 | inherited | Technical text |
| text-mono-sm | 10 / 16 | inherited | Tags, metadata |

Use sentence case; no uppercase table headers. Uppercase is acceptable for
short technical IDs and specimen labels. Tight heading tracking is reserved for
headings; body text is not compressed. Do not shrink primary UI below 12px.
All size and visual constants belong in global tokens, not screen-level CSS.

## 4. Color tokens

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Canvas | --color-bg | #E9EAED | #020810 |
| Canvas subtle | --color-bg-subtle | #F2F3F5 | #040E1C |
| Workspace | --color-surface | #FFFFFF | #061329 |
| Inset/header | --color-surface-2 | #F8F8FA | #0B1D3B |
| Strong inset | --color-surface-3 | #EDEEF1 | #112A4F |
| Hairline | --color-border | #E9EAEE | #112546 |
| Control boundary | --color-border-strong | #D5D7DE | #1C3868 |
| Primary text | --color-text | #202126 | #F0F4FC |
| Secondary text | --color-text-2 | #555861 | #9EB4CE |
| Muted text | --color-text-3 | #707480 | #6F88A8 |
| Action blue | --color-primary | #3458E5 | #4D82F7 |

Foreground/background pairs: success (green), warning (amber), danger (rose),
info (blue), violet, teal, and a neutral grey (`--color-neutral-*`). Use `Tag` with a named tone:
`neutral | blue | green | amber | red | violet | teal`. Dark counterparts are
defined in the same CSS file. Never apply a light tag background in dark mode.
Muted text is for secondary information, not disabled essential instructions.
Use text and icons with status; color is never the only signal.

Template placeholders use `MergeField`: amber monospace with curly-brace notation.

## 5. Gradients and glass

Gradients are first-class tokens. The old ban on gradient buttons is retired.

| Token | Treatment | Allowed use |
| --- | --- | --- |
| --gradient-primary | #4B69E6 → #3458E5 → #294BD2, vertical | Primary action |
| --gradient-primary-hover | Slightly deeper blue | Primary hover |
| --gradient-brand | Pale blue → brand blue → indigo | Brand accents |
| --gradient-glass | Translucent neutral/cool layers | Frame, sidebar base |
| --gradient-neutral | White → very light gray | Secondary control face |
| --gradient-mint | Pale mint | Success-related accent |
| --gradient-amber | Pale amber | Review-related accent |
| --gradient-violet | Pale violet | Category accent |

Glass combines the glass gradient, a translucent edge, and 24px backdrop blur.
It still looks coherent when blur is unavailable because the gradient provides
the surface. Never use gradients as text fills, across rows of data, or as
large decorative backgrounds inside the white workspace.

## 6. Shape, shadows, and controls

Radii: 4px tiny, 6px tags, 8px controls, 12px cards/tables, 16px workspace/dialog,
20–22px outer frame. Pills are reserved for switches and genuinely round items.

Shadows:

- xs: contact, cards and inputs.
- sm: selected navigation and raised surfaces.
- md: menus/popovers.
- lg: modal/dialog.
- control: fine inset highlight + 1px contact.
- primary: inset top highlight + darker bottom edge + restrained blue shadow.

Primary buttons use the vertical blue gradient, a darker one-pixel outline,
white text, top inset highlight, and a slight lower shadow. Pressing moves the
face down 1px and reduces depth. Never use thick bevels or glossy streaks.
Secondary buttons have a neutral face. Ghost buttons have no resting elevation.
Destructive controls use danger color, not blue. Disabled controls are visibly
muted and noninteractive. Icon-only controls require an accessible name.
Button defaults to type=button; forms explicitly request type=submit.

Inputs are 32px high with an opaque background, 8px radius, subtle contact shadow,
and a stronger boundary than cards. Always render a visible label; placeholders
are examples, not labels. Invalid fields have an error boundary and associated
explanation. Search icons have reserved padding and cannot overlap input text.

## 7. Component patterns

**Navigation:** 34px rows, 16px muted icons, 10px gap. Active item is white,
slightly raised, and uses normal dark text—not a large blue slab. Groups use
small muted sentence-case labels. Keep role-based visibility.

**Tabs:** compact 3px-padded neutral track; white raised active segment. Use
tablist/tab/tabpanel semantics, roving tab index, arrows, Home, and End.

**Tables:** white body, pale neutral header, fine horizontal dividers. Avoid
vertical gridlines. 12px cells; 13px important names; monospace tags/IDs.
Search, sorting, selection, visibility, and density must work. Filter and column
controls stay accessible at narrow widths. Labels name each checkbox.
Preserve keyboard J/K navigation, X selection, Enter opening when supported.
Nested controls must not trigger row shortcuts. Persistent preferences cannot
overwrite their saved state during hydration.

**Cards:** white with one-pixel border and contact shadow. 16px inset, 14px title.
Do not give every card a prominent floating shadow.

**Boards:** lightly tinted neutral wells, white cards, compact metadata. Use
soft semantic gradients only in the column header. Never imply drag-and-drop
works unless implemented; design-system board specimens are static examples.

**Dialogs:** native modal focus management, Escape and close action; overlay
uses dimmed backdrop and blur. 440px default, 24px padding, 16px radius. Form
labels and primary/secondary footer actions are consistent with inline forms.
Sheet implementations should reuse these surface rules, with a side-anchored
layout; do not add translucent reading surfaces.

**States:** shape-matched skeletons; concise empty state; error copy plus retry
where recovery exists. Feedback names the outcome and never silently disappears.
Avoid animation without a purpose.

**Charts/calendar:** retain the six semantic chart colors. Calendar event rows
should be white, finely outlined, with a small category marker and readable
label. These are future screen rules, not claims of implemented calendar routes.

## 8. Motion and accessibility

Motion explains space, confirms input, shows state, or softens a meaningful
change. Frequent actions stay nearly instant; decorative choreography is not
part of the product language. Use ease-out `[0.16, 1, 0.3, 1]` for entrances,
ease-in-out `[0.77, 0, 0.175, 1]` for movement, linear timing for progress, and
springs only for press feedback, gestures, and layout continuity.

Use 100–160ms for press feedback, 125–200ms for tooltips and popovers,
150–250ms for dropdowns, and 200–500ms for large panels. Most interface motion completes under 300ms.
Content reveals may use a restrained 8px lift and 4px blur. Small content swaps
travel no more than 4px, with the outgoing content leaving faster than the new
content enters. Shared surfaces move before their labels appear.

Honor prefers-reduced-motion as a designed state: retain opacity, color, and
instant state feedback while removing travel, scale, blur, parallax, and spring
overshoot. Do not use motion as the only state channel.
Focus uses a 2px ring with 3px offset and must remain visible above shadows.
Keep native semantic inputs, buttons, table headers, labels, and dialog behavior.
Readable text targets WCAG AA; verify actual rendered color pairs when changing
tokens. Disabled text and nonessential dividers are not substitutes for labels.

Main content has a skip link. Responsive views retain navigation. Dialogs
restore focus. Buttons/icons remain reachable by keyboard. No essential copy is
only revealed by hover. At coarse pointer sizes, give primary actions at least
40px height and keep neighboring targets separated.

## 9. Implementation and scope

Reuse the existing Next.js, Tailwind, Lucide, Motion, TanStack Table, and local
font stack. No illustration or raster imagery is needed for this UI-only system;
preserve the supplied BenchQ SVG logo. Use React components for actual controls,
not screenshots of controls. Raw colors belong in globals.css.

The live showcase has Overview, Foundations, Patterns, and Interactive lab.
It includes filtering/sorting/selecting sample table rows, column visibility,
density, modal form submission, local preview preferences, theme switching,
gradient swatches, type samples, tags, cards, states, and the existing mock AI lab.
Token export is a starter subset of the active theme, not a full theme package.
Sample data and preview preferences are not production records.

New product screens must reuse this system. Unbuilt product routes are still
unbuilt; this visual update does not implement recruitment workflows.
Architecture, data contracts, role permissions and mock boundaries remain governed by their existing documents.
