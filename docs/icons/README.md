# Database icons

Single-path monochrome brand glyphs from
[simple-icons](https://github.com/simple-icons/simple-icons) (`icons/<name>.svg`), which is
licensed CC0-1.0. Each mark remains the trademark of its respective project and is used here only
to identify the databases XenSQL supports.

They are referenced as plain `<img>` tags from `../index.html`. An SVG loaded through `<img>` is
isolated from the page's CSS, so it cannot inherit `currentColor` or a custom property - which is
why each file carries its own `fill`:

    fill="#3b82f6"    <!-- keep in step with --accent in ../styles.css -->

Upstream ships these files with only a `viewBox` and no `fill`, so two attributes are added to the
root `<svg>` of each: `width="24" height="24"` (an SVG with no intrinsic size renders
inconsistently as a CSS image) and the `fill` above.

To update one: download the same file name from simple-icons, then re-add `width`, `height` and
`fill` to its root element.
