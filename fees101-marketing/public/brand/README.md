# Brand assets

This site currently uses hand-coded SVG *approximations* of the logo (book + checkmark,
navy `#0D1B36` / mint `#5AD8A6`) so the site can ship before final exports exist.
Replace them with the real exported files from the brand sheet and the components
below will pick them up automatically — no code changes needed beyond the file names.

Drop the real exports into this folder using these exact names:

| File you provide                    | Used for                                      | Brand-sheet variant |
|--------------------------------------|------------------------------------------------|----------------------|
| `logo-horizontal.svg`                 | Header (desktop), Open Graph text fallback     | 1. Horizontal (full logo) |
| `logo-stacked.svg`                    | Footer brand block, mobile header if needed    | 3. Stacked (icon above) |
| `icon.svg`                            | Favicon source, small UI touches (buttons, badges) | 4. Icon only |
| `icon-512.png`                        | PWA / social preview icon (512x512)            | 4. Icon only, exported to PNG |
| `favicon.ico`                         | Browser tab favicon                            | 4. Icon only, exported to ICO |
| `og-image.png`                        | Link-preview image (1200x630), e.g. horizontal logo centered on navy | 1. Horizontal, composed on brand navy |

Per the brand sheet's own usage notes:
- Use the **full horizontal logo** for headers and marketing materials → header.
- Use the **stacked version** for square/tight spaces → footer, social avatars.
- Use the **icon only** for favicons and small buttons → browser tab, badges.
- Maintain clear space around the logo equal to the height of the "F".
- Don't recolor, stretch, or rotate the logo.
- Brand colors: Navy `#0D1B36`, Mint `#5AD8A6`. Typography: Poppins (Bold for
  headings/logo, Regular for body).

Until real files land, `src/components/Logo.tsx` renders inline SVG recreations
using the colors above — swap is a drop-in once these files exist.
