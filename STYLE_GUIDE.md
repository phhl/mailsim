# Internal UI Style Guide (Admin/Teacher/Schooladmin)

This guide captures the shared UX/UI standards used across the admin-style views.

## Page shell
- Use `partials/header` and `partials/layout_start` with `showSidebar: false`.
- Wrap content in `.section` and `.container.is-widescreen`.
- Use a top header row with `.level.admin-head` for title, subtitle, and count tags.

## Panels
- Use `.admin-panel` for each section with:
  - `.admin-panel__head` containing a `h2.title.is-5` and a tag (context label).
  - `.admin-panel__body` as the content wrapper.
- For dashboards, wrap panels in `.admin-grid` and use `.admin-panel--wide` for full-width sections.

## Forms
- Use `.admin-form` for vertical spacing between fields.
- Use `.admin-form__grid` or `.admin-form__row` for aligned, multi-column forms.
- Place primary actions in `.admin-form__actions` and use `.button.is-link` for primary.
- Use `.admin-filter` for top-of-page filters with `.field.is-grouped`.

## Tables and lists
- Tables: `table.is-fullwidth.is-striped.is-hoverable` inside `.table-wrap`.
- Actions column uses `.actions-col` and `.admin-table-actions` for stacked controls.
- Inline edits use the `.inline-edit` pattern with a trigger and editor state.
- For admin-style list edits, keep rows clean (no always-visible inputs); use inline-edit controls that reveal inputs on demand.

## Messaging and states
- Use `.notification.is-light` for success/error feedback.
- Use `message` or `notification` blocks for empty states.
- Keep destructive actions `.is-danger.is-light`.
- Destructive actions should open a Bulma modal for confirmation; require name confirmation when data exists.

## Pagination
- Use Bulma pagination (`.pagination`) centered below tables when needed.

## Spacing & responsiveness
- Rely on `.admin-panel__body` spacing and `.admin-form` gaps instead of custom margins.
- Grids collapse under 640px via existing CSS; avoid hard-coded widths.
