# Workspace design system

The yellow-and-ink workspace uses white working surfaces, a warm neutral canvas, dark text and restrained yellow accents. Yellow identifies primary actions, active navigation and reviewed selections. Green, amber and red retain their operational meanings. This is a staff inventory interface: record comparison, readable tables and clear confirmation boundaries take priority over decoration.

## Source files and ownership

[`app/globals.css`](../app/globals.css) is the import entry point. It imports the existing framework and vendor styles, then these six application modules in order:

| Module | Responsibility |
| --- | --- |
| [`styles/theme.css`](../styles/theme.css) | Semantic colors, fonts, radii, shadows and motion durations; maps the tokens into the utility theme. |
| [`styles/base.css`](../styles/base.css) | Document typography, text selection, shared keyboard focus, reduced motion and forced-color fallback. |
| [`styles/shell.css`](../styles/shell.css) | Sidebar, branding, breadcrumb, workspace framing, account header, skip link and sign-in page. |
| [`styles/components.css`](../styles/components.css) | Shared buttons, inputs, tables, tabs, feedback, forms, dialogs, popovers and temporal controls. |
| [`styles/inventory.css`](../styles/inventory.css) | Inventory summaries, record browsing, filters, applied criteria, selection, pagination and detail panels. |
| [`styles/workflows.css`](../styles/workflows.css) | Scan, intake and removal stations; persistent exit controls; model suggestions, teaching groups, message cards, task-cycle dialogs and account views. |

Responsive rules stay in the module that owns the component. Avoid adding another global override section. Shared primitives remain in `components/ui/`; their existing keyboard, focus, portal and disabled-state behavior is retained. Domain-specific components consume their established classes and `data-slot` attributes.

The six application imports use the `@styles` alias defined in `vite.config.ts`. It resolves from the configuration file to the project's absolute `styles/` directory, so development and production CSS processing do not depend on an importer's working directory. Keep this alias when moving or renaming the stylesheet modules; do not copy the styles into a second location.

## Color semantics

| Purpose | Token | Current value |
| --- | --- | --- |
| Primary text and focus outline | `--foreground`, `--ring` | `#20201f` |
| Supporting text and field hints | `--muted-foreground` | `#52524d` |
| Page canvas | `--canvas` | `#f6f6f3` |
| Cards, forms and overlays | `--surface` | `#ffffff` |
| Table headers and quiet group surfaces | `--surface-subtle` | `#f5f5f1` |
| Primary action | `--brand-yellow` | `#ffdc00` |
| Primary action hover | `--brand-yellow-hover` | `#efd000` |
| Selected records and active navigation | `--selection-surface` | `#fff9d8` |
| Selected hover | `--selection-hover` | `#fff3b4` |
| Normal separators / stronger control borders | `--border` / `--border-strong` | `#e4e4de` / `#c6c6bd` |
| Sidebar text | `--sidebar-foreground` | `#35352f` |
| Success text / surface | `--success-foreground` / `--success-surface` | `#286345` / `#edf7f0` |
| Warning text / surface | `--warning-foreground` / `--warning-surface` | `#736021` / `#fffbed` |
| Error text / surface | `--danger-foreground` / `--danger-surface` | `#a52f38` / `#fff2f2` |

The utility aliases such as `--primary`, `--card` and `--accent` refer to these semantic values. Because `--primary` is yellow, it is suitable for a filled action with dark foreground text. Plain links use dark text with an underline; yellow text on a white surface is not a supported pairing. Status text, icons and labels continue to communicate meaning alongside color. The unread red dot remains separate from task-completion state.

The font stack prefers an installed Inter or Segoe UI and falls back to platform sans-serif fonts. It does not download a remote font. Body text starts at 16px; operational controls, tables and metadata use the sizes below. Control, panel and popover radii are 8px, 14px and 12px respectively. Borders establish grouping; shadows are deliberately shallow except on floating dialogs.

## Interaction dimensions and data density

| Element | Current styling |
| --- | --- |
| Standard button | Minimum height 40px; 14px text. |
| Small / extra-small button | Minimum heights 34px / 28px; 13px text. |
| Standard / small / extra-small icon button | 38px / 32px / 26px square. |
| Standard input and select | Minimum height 40px; form-field inputs use 16px text. |
| Sign-in inputs and submit action | Minimum height 44px. |
| Persistent station exit | Minimum height 46px; 14px bold text; full width on narrow screens. |
| Sidebar navigation | 42px high with 14px text; personal rows grow to at least 58px and use 13px secondary text without additional opacity. |
| Table header | 46px high; 12px text with modest letter spacing. |
| Table body | 14px text, line-height 1.5; 16px vertical and 18px horizontal cell padding. |
| Table at 640px and below | 14px vertical and 12px horizontal cell padding. |
| Form labels / supporting hints | 14px / 13px text; hints use line-height 1.65. |
| Status badges / compact section labels | At least 12px text. |
| Page description | 15px text; line-height 1.65. |
| Message subject / body / metadata | 16px / 14px / 13px text; actions remain visible next to or below each card. |

Tables retain a single horizontal scroll container rather than squeezing every column into the viewport. Record labels can wrap while identifiers, status badges and reviewed workflow evidence retain their existing specific rules. Secondary lines remain visually subordinate, and numbers in summary cards use tabular figures. Selected rows use a pale yellow surface; row hover changes only the surface, without moving the row. Checkboxes and independent record/action controls remain available.

The workspace uses 32px horizontal padding on wide screens, 22px at the intermediate breakpoint and 14px on narrow screens. Filter fields and workflow columns collapse at their existing breakpoints. Dialogs keep a bounded viewport height and scroll internally. Styling does not change filtered scopes, chosen records, transaction payloads or guarded navigation.

Larger text retains the existing table padding and local horizontal scrolling. Lifecycle tabs wrap on narrow screens; summary labels can wrap without shrinking their text below 12px. Sidebar row height can grow for the personal status line. Message cards form a single-column list, with actions moving below their content at 800px. Task-cycle dialogs keep a bounded viewport height, a separately scrolling body and an always-visible footer outside that scroll area. None of these rules clips the whole page to conceal horizontal overflow.

The stylesheet audit finds no explicit application font size below 12px. This does not measure text embedded in third-party controls or guarantee readability at every zoom level. After changing type size, check a narrow viewport with long labels, large counts, wrapped tabs and open dialogs; greater text width may increase the table's local scroll range.

## Focus and motion

Keyboard focus uses a dark 2px outline with a 3px offset for ordinary interactive elements. Text inputs and select triggers use a dark border plus a yellow halo. The skip link is visually hidden until focused and targets the workspace content. Persistent station exit buttons keep a distinct focus treatment. A forced-colors rule supplies a system-color focus fallback.

Color, border and shadow changes use the 160ms fast duration. Overlay surfaces use a 220ms duration. The page heading and sign-in card have a short 4px entrance movement; table rows do not translate. Under `prefers-reduced-motion: reduce`, animation and transition durations become effectively immediate and smooth scrolling is disabled. These styles complement the components' keyboard and accessibility behavior; they do not replace it.

## Static text-contrast verification

On 3 October 2026, the actual theme values were checked with the WCAG sRGB relative-luminance calculation. Each sRGB channel is linearized using the 0.04045 breakpoint; luminance is `0.2126 R + 0.7152 G + 0.0722 B`. Contrast is `(lighter + 0.05) / (darker + 0.05)`. Opacity is composited against the stated background before luminance is calculated.

The acceptance threshold is **4.5:1 for normal text**, evaluated before rounding. Disabled controls are excluded from this text check. The threshold and inactive-control exception follow [W3C's explanation of WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

| Text / background | Foreground | Background | Ratio | Normal-text result |
| --- | --- | --- | --- | --- |
| Primary / white | `#20201f` | `#ffffff` | 16.31:1 | Pass |
| Primary / canvas | `#20201f` | `#f6f6f3` | 15.06:1 | Pass |
| Secondary / white | `#52524d` | `#ffffff` | 7.86:1 | Pass |
| Secondary / canvas | `#52524d` | `#f6f6f3` | 7.26:1 | Pass |
| Secondary / subtle surface | `#52524d` | `#f5f5f1` | 7.19:1 | Pass |
| Primary yellow button | `#20201f` | `#ffdc00` | 12.03:1 | Pass |
| Yellow button hover | `#20201f` | `#efd000` | 10.63:1 | Pass |
| Selected primary text | `#20201f` | `#fff9d8` | 15.37:1 | Pass |
| Selected secondary text | `#52524d` | `#fff9d8` | 7.41:1 | Pass |
| Sidebar text | `#35352f` | `#ffffff` | 12.34:1 | Pass |
| Sidebar status text | `#52524d` | `#ffffff` | 7.86:1 | Pass |
| Active sidebar status text | `#52524d` | `#fff9d8` | 7.41:1 | Pass |
| Success message | `#286345` | `#edf7f0` | 6.47:1 | Pass |
| Warning message | `#736021` | `#fffbed` | 5.92:1 | Pass |
| Error message | `#a52f38` | `#fff2f2` | 6.28:1 | Pass |
| Destructive button | `#ffffff` | `#a52f38` | 6.85:1 | Pass |
| Dark station exit | `#ffffff` | `#20201f` | 16.31:1 | Pass |
| Dark station exit hover | `#ffffff` | `#383835` | 11.76:1 | Pass |

Supporting text was darkened from `#686861` to `#52524d` to improve extended reading, raising its white-surface contrast from 5.61:1 to 7.86:1. Sidebar secondary status lines use this explicit color at full opacity, with a scoped style overriding the inherited `opacity-70` utility. Hierarchy comes from type size and weight rather than additional fading. The station exit hover selector also explicitly matches the generic button hover specificity, preventing a yellow background from replacing its dark surface while retaining white text. The final 18 combinations above include those corrections. The calculation and full-precision results are retained locally in ignored `work/architecture-theme/check-contrast.mjs` and `contrast-results.json`.

Browser review also found that the operating system's dark preference activated legacy `dark:` utility classes inside this light workspace. A destructive button consequently used a 60% background opacity, reducing white-text contrast to 2.98:1 on white. The shared stylesheet now makes dark utilities conditional on an explicit `.dark` ancestor; the application does not enable that class. The restored button was observed as opaque `rgb(165, 47, 56)` with white 14px text. Its contrast is 6.85:1; the existing 90% hover color over white calculates to 5.64:1. This prevents automatic partial dark styling without introducing a second theme.

This is a static check of the listed text/background combinations, not a claim of complete WCAG conformance. It does not establish every rendered interaction state, non-text contrast, target size, screen-reader behavior, browser zoom behavior or visual acceptance. Those require separate browser and accessibility review.

## Changing the theme

1. Change the semantic value in `styles/theme.css`; do not introduce feature-specific hex colors. Keep foreground/background pairs together and recalculate their contrast, including hover, selection and any retained opacity.
2. Change shared control styling in `styles/components.css`, framing in `styles/shell.css`, or feature layout in its owning inventory/workflow module. Keep responsive rules with that module and preserve existing state selectors.
3. Use the existing primitives and semantic tokens. Do not derive destructive, success or warning meaning from the primary brand color. Preserve keyboard focus, disabled behavior, explicit confirmations and uncertain-request recovery.
4. Inspect wide and narrow layouts, keyboard focus, reduced motion, an open filter, a selected row, a dialog, a date picker and a persistent station. Verify that table scrolling, long evidence and visible exit controls still work.
5. Run the project's normal validation and build commands against the final source. Record actual results and limitations in the validation record; a token calculation alone does not establish browser acceptance.
