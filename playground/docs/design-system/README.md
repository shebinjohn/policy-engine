Safe Research presents on a black ground in Safe green, set in DM Sans, every slide held by the same thin frame with square markers on its corners. Use the **dark** theme for slides; the **light** theme is for documents and web pages that need to sit next to Safe{Wallet}.

## Content fundamentals

**Voice.** Safe writes like an engineer with a principle: short, declarative, confident, never salesy. The brand's own lines set the register:

> Self-Custody is a Right* Not a Feature.
>
> Resilience isn't a feature. It's how we architect every layer of Safe.

**Slide copy** follows the DSS deck:

- Titles are Title Case nouns, centred, a few words: "Guardrail", "Policy Engine", "Concluding Thoughts", "Safe Contracts Transaction Flow with Guards".
- Bullets are sentence-case fragments, one line each, no full stop, four rows at most: "Deny all DELEGATECALLs", "Time delayed approach on function call allowance".
- Explain a term with a colon, not a dash: "Deny by default: Random contract takeover", "Fiducia: Swiss Army Knife".
- Write identifiers exactly as the code does: `DELEGATECALL`, `SafeMigration`, `checkTransaction`, access selector = `to` + function selector + operation.
- Close with a comparison triad that maps tools to things people own: "Single Tool (Screw Driver)", "Swiss Army Knife", "Toolbox".
- No emoji. No em dashes: use a colon or a line break.
- Name the product family with braces and no space: Safe{Wallet}, Safe{Core}. In running text write "Safe Research"; the braced Safe{RESEARCH} form is artwork (the lockup), not text.
- Project names are Title Case as names (Guardrail, Fiducia, Policy Engine) and lowercase in links (`safe-research/policy-engine`).
- Cite every project slide with two full links in the footer: the GitHub repo first, then the safe.dev page.

## Visual foundations

### The slide

- The canvas is `slide-width` × `slide-height` (1920 × 1080). Every slide is a `SlideFrame`: `ground`, four `brand-deep` frame lines `slide-frame-inset` from the edges at `stroke-frame`, a `brand` square of `slide-marker` centred on each crossing, the wireframe diamond top-left and bottom-right, the Safe-blocks ornament top-right and bottom-left. No slide goes without the frame.
- Centre everything on the vertical axis: titles, the display title, the speaker block, Thank You. Lists are left-aligned inside a centred region.
- The title sits at `slide-title-top`. Content lives in the region from `slide-content-top` down to the same distance above the bottom edge, inset `slide-content-inset` left and right. A wide diagram may run out to the corner markers (`.sr-body.is-wide`).
- Source links sit bottom-right, `slide-footer-right` and `slide-footer-bottom` in, right-aligned, clear of the diamond.
- Run a talk in this order: TitleSlide, SpeakerSlide, diagram slides, one list slide per project, an IconList for conclusions, ClosingSlide.

### Colour

- Text is `ink` on `ground`. Titles, the speaker name and Thank You are `heading`. Secondary text is `ink-muted`. Links are `link`.
- Spend green on purpose: `brand` for the corner markers, the outcome node of a flow (Protocol Interaction or Transfer) and glyphs (`icon`). Never set body copy in green.
- Text on a green fill is `on-brand`; text on a neutral node is `on-node`. Never white on green.
- `brand` is a fill colour. On the light theme it is 1.3:1 against white, so it never carries text or a meaningful mark there; `heading`, `link` and `icon` switch to readable values for you.
- Allow and deny states are not in the DSS deck. When a slide needs them, use `success` and `danger` (with `success-bg`, `danger-bg` for callouts) and always add the word ("Allowed", "Denied") or a glyph: the two sit at the same lightness and fail for colour-blind viewers on hue alone. `warning` marks "needs configuration" or a time delay; `info` a neutral note.
- `lime` and `mint` are the deck theme's spare accents. Use one at most per slide, as a fill under `on-brand` text.
- The tokens carry Safe's official palette under semantic names: Safe Green (`brand`), Safe Light Green (`brand-light`), Safe Black (`surface` dark, `ink` light), Safe Metal and Safe Slate (`ink-muted`), Safe Stone and Safe Graphite (`line`), Safe Red (`danger`), Safe Orange (`warning`), Safe Blue (`info`, `safe-blue`), Safe Dark Green (`success`), Guardians Blue (`guardians-blue`). Reach for the semantic token, never a raw hex.
- The slide ground stays pure black to match the DSS deck; Safe Black is the brand's black and the right ground anywhere outside this deck.
- Safe has two gradients: Core (Safe Green to Safe Blue) and Guardians (Guardians Blue to Safe Dark Green). Neither belongs on these slides. Use Core only on large brand artwork, never behind text; leave Guardians to Safe Guardians material.
- No shadows and no transparency effects. The surfaces are flat.

### Type

- One family: DM Sans. SemiBold (600) is the weight for every slide style except node labels, which are Regular (400). Geist Mono is for code only.
- Safe's licensed brand face is Citerne (uppercase statements in Safe's own decks, see Reference); DM Sans is the brand's open alternative and the face of this system. Never mix the two on one slide.
- Slides: `slide-display` (title slide, Thank You), `slide-name`, `slide-title`, `slide-role`, `slide-body` (rows), `slide-caption` (diagram lanes), `slide-label` (links, handles), `slide-node` (inside nodes), `slide-code`.
- Nothing on a slide goes below `slide-label` (27px). The DSS deck set the social handles at 6pt; use `slide-label` instead.
- Documents and web use the Safe{Wallet} scale: `heading-1` to `heading-5`, `body`, `body-small`, `caption` (in `ink-muted`), `overline` (set uppercase), `code`.
- Code turns ligatures off, so `==` and `!=` read as two characters. On a security slide that difference is the point.

### Space, corners, lines

- Spacing runs on Safe's 8px scale, `space-1` (8px) to `space-12` (96px). Slide positions and sizes are the Slide tokens.
- Corners are square (`radius-none`): frame, markers, photo, plates of text. The one rounded shape is the flow node at `radius-node`. Code blocks take `radius-lg`; web controls take `radius-md` (Safe{Wallet}'s default).
- Lines come in three weights: frame `stroke-frame` in `brand-deep`, list rules `stroke-rule` in `rule`, diagram arrows `stroke-connector` in `connector`.

### Diagrams

- A flow reads left to right: the `user` glyph, an arrow, neutral `node`s for Safe's own steps, and one `brand` node for the outcome. Caption each lane with `slide-caption`: above the first lane, below the last.
- A guard or check sits between lanes as a neutral node joined by double-headed connectors (`.sr-check`). That is how the deck shows a Safe Guard intercepting both the normal and the module path.
- Keep node labels to three short lines; put "or" on its own line.

### Motion and imagery

- Only the two ornaments move: `diamond-wireframe.gif` and `safe-blocks.gif` loop at 25 fps. The deck has no transitions or builds. Add none for decoration; a build that reveals one diagram step at a time is the only exception.
- PDF and image exports freeze the ornaments on their first frame. Check exported slides for that.
- `safe-symbol-build.gif` is Safe's official animated symbol (the blocks assembling on Safe Green). It is not in the DSS deck; if a talk wants a brand moment, give it a full slide of its own.
- The only photograph is the speaker portrait: square-cornered, natural colour, `slide-photo-width` × `slide-photo-height`, cropped centre.
- The one piece of brand imagery is `symbol-glass-3d.png`, a glass render of the symbol. Use it full-bleed on a title or section slide only, with nothing set over it. No stock imagery or illustration.

### Accessibility

- Every text colour names its grounds in its note and holds 4.5:1 on them in both themes. Frame lines, rules and the ornament ink are decorative and sit below that on purpose.
- Interactive pages show keyboard focus as a solid `focus` ring, `stroke-focus` wide with a `stroke-focus` gap.

## Iconography

- Safe has its own icon set: pixel-stepped outline glyphs with rounded corners, one ink (the full sheet is `icon-set.png` in Reference: arrows, download, swap, user, group, padlocks, shield with check, gem, copy, chat, sliders, plus).
- The glyphs in the Icons group are the deck's copies of five of them: `user` (an actor), `padlock-1`, `padlock-2`, `padlock-3`, `gem`.
- The files are single-ink `#12FF80`. On slides, inline the SVG path and fill it with `icon` (`.sr-glyph`) so it follows the theme.
- The padlock count carries meaning: one keyhole for a single-purpose guard (Guardrail), two for a configurable one (Fiducia), three for a full policy toolbox (Policy Engine).
- `x.png` and `telegram.png` mark social handles on the closing slide and nowhere else.
- When a slide needs another glyph, take it from Safe's icon set as SVG (the media kit's Icons download) and add it to Icons. Never redraw one from the sheet, mix in another icon set, or use emoji.

## Logos

- `safe-research-lockup.svg` (Safe{RESEARCH}, `#12FF80` only) goes on the speaker slide at `slide-lockup-width`. It works on dark grounds only; on light, sit it on a `plate`.
- `safe-research-icon.svg` (the bracketed R) is for avatars and favicons.
- The Safe logo comes horizontal (`safe-logo-horizontal-white.png` on dark, `-black` on light) and vertical (`safe-logo-vertical-white.png`, `-black`). Prefer horizontal; use vertical only where width is short.
- The symbol alone (`safe-mark-white.svg` on dark, `safe-mark-black.svg` on light, `safe-logo-round.svg` on a green disc) is for places where Safe is clearly named elsewhere, as the media kit puts it.
- Clear space: keep empty space on every side of the symbol or logo at least as wide as the symbol's centre square (one module of its grid; see `logo-clearspace.png`). No other mark, text or frame line may enter it.
- In running text write "Safe" in DM Sans at the size of the text around it; never set a logo inside a sentence.
- Safe's trademark policy applies to every slide: resize marks only in proportion; never rearrange, redraw, or combine them with other symbols, words or logos; do not let your own name or brand be less prominent than the Safe marks on third-party material. Where a mark is referenced, the policy's notice is: "SAFE{CORE}® and SAFE{WALLET}®, and the Safe logos are trademarks or registered trademarks of Safe Ecosystem Foundation."

## Using the components

Load the generated `tokens.css`, the fonts and `components/bundle.css`. Build each slide as one `.sr-slide` element at 1920 × 1080 and scale the whole element to fit the screen. Apply type with the style classes (`slide-title`, `slide-body`, …) and colour with the components' classes; do not paste hex values.

```html
<div class="sr-slide">
  <img class="sr-ornament is-diamond is-tl" src="diamond-wireframe.gif" alt="">
  <img class="sr-ornament is-blocks is-tr" src="safe-blocks.gif" alt="">
  <img class="sr-ornament is-blocks is-bl" src="safe-blocks.gif" alt="">
  <img class="sr-ornament is-diamond is-br" src="diamond-wireframe.gif" alt="">
  <h2 class="sr-heading slide-title">Policy Engine</h2>
  <div class="sr-body">
    <ul class="sr-ruled-list slide-body">
      <li>One access selector = One policy</li>
      <li>Each policy having custom logic</li>
    </ul>
  </div>
  <p class="sr-links slide-label">
    <a href="https://github.com/safe-research/policy-engine">https://github.com/safe-research/policy-engine</a>
    <a href="https://safe.dev/policy-engine">https://safe.dev/policy-engine</a>
  </p>
</div>
```

**Intentional additions** beyond the DSS deck: `CodeBlock` and the `slide-code` style (a talk about guards will show Solidity), the status colours (allow and deny are this talk's subject), and the light theme with the document scale (Safe{Wallet}'s own values, for later non-slide work).
