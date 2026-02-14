# UI Components

Location: `frontend/src/components/common/`

```tsx
import { Button, Modal, Badge, Icon } from '../../components/common';
```

## Icon

```tsx
<Icon name="upload" />
<Icon name="check" size={24} />
```

Names: `upload`, `edit`, `check`, `delete`, `back`, `plus`, `save`, `process`, `arrow-left`, `arrow-right`, `close`, `confirm`, `eye`, `eye-off`, `reset`, `clear`, `select-all`, `folder`, `file`, `logout`

## Button

```tsx
<Button onClick={fn}>Submit</Button>
<Button icon="upload" variant="primary">Upload</Button>
<Button variant="danger" size="sm">Delete</Button>
<IconButton icon="save" tooltip="Save" />
```

**Variants:** `primary`, `secondary` (default), `danger`, `ghost`
**Sizes:** `sm`, `md` (default), `lg`
**Props:** `icon`, `iconPosition`, `active`, `loading`, `disabled`

## Modal

```tsx
<Modal
  isOpen={show}
  onClose={() => setShow(false)}
  title="Edit Letter"
  actions={<Button variant="primary">Save</Button>}
>
  {content}
</Modal>
```

**Props:** `title`, `subtitle`, `size` (sm|md|lg), `closeOnOverlayClick`, `showCloseButton`

## ConfirmDialog

```tsx
<ConfirmDialog
  isOpen={show}
  title="Delete Letter"
  message="Are you sure?"
  confirmText="Delete"
  variant="danger"
  onConfirm={handleDelete}
  onCancel={() => setShow(false)}
/>
```

## Badges

```tsx
<WorkflowBadge state={letter.workflowState} />
<VisibilityBadge state={letter.visibility} />
<TypeBadge type="L" />
<StatusBadge status="auto" />
```

**Workflow states:** UPLOADED, TRANSCRIBING, TRANSCRIBED, METADATA_EXTRACTING, METADATA_DRAFTED, REVIEWED
**Visibility:** PUBLISHED, HIDDEN
**Types:** L, P, E, V, A, D, C, N, T

## Dropdown

```tsx
<Dropdown
  trigger={<Button>Process</Button>}
  isOpen={open}
  onClose={() => setOpen(false)}
>
  <DropdownHeader>Actions</DropdownHeader>
  <DropdownItem title="Transcribe" onClick={fn} />
  <DropdownDivider />
  <DropdownItem title="Delete" variant="danger" onClick={fn} />
</Dropdown>
```

**Props:** `align` (left|right|center)
**Item props:** `title`, `description`, `variant`, `disabled`

## Form

```tsx
<FormGroup label="Sender" id="sender" required error={errors.sender}>
  <input id="sender" />
</FormGroup>

<AutoResizeTextarea value={desc} onChange={setDesc} minHeight={80} />
```

## Admin Letter Review Components

Location: `frontend/src/pages/admin/LetterReview/`

- `TranscriptionSection.tsx`
  - Transcription editor UI, transcribe action, transcript verification status, and verified-edit tooltip.
- `ExtraContentSection.tsx`
  - Extra content editor UI for telegram/cover/ephemera transcription and verification.
- `MetadataSection.tsx`
  - Metadata form fields, AI sync/regenerate controls, linked entity editing, and notable quotes display.
- `AddEntityModal.tsx`
  - Reusable modal for adding linked people or places.
- `EditableEntityItem.tsx`
  - Inline editable linked entity row used by `MetadataSection`, including quick-open action to jump to the matching admin People/Places record.

`frontend/src/pages/admin/LetterReviewPage.tsx` now owns state and handlers, then composes these sub-components via props.

## Admin Dashboard Components

Location: `frontend/src/pages/admin/AdminDashboard/`

- `DashboardFilterBar.tsx`
  - Dashboard filter/stats row: visibility pills, transcript/metadata status filters, collection input, date dropdown, search, and active filter controls.
- `RecentActivityTable.tsx`
  - Recent letters table: sortable columns, edit-mode cell interactions, status/sync indicators, and pagination controls.
- `types.ts`
  - Shared dashboard type definitions (sorting, column IDs, persisted filter state) used by dashboard parent + child components.
- `constants.ts`
  - Shared dashboard constants (date options, column defaults, storage keys, server-sort fields).
- `utils.tsx`
  - Shared dashboard utility logic (`isServerSortField`, sync/status/date helpers, persisted-state load/save, status icon renderer) with dedicated unit coverage.

`frontend/src/pages/admin/AdminDashboard.tsx` keeps data/state/business logic and composes these sections via props.

## Admin Upload Components

Location: `frontend/src/pages/admin/UploadLetter/`

- `ImageThumbnail.tsx`
  - Reusable thumbnail tile with select/view/delete behavior for upload images.
- `UncategorizedCarousel.tsx`
  - Paginated uncategorized image browser with selection and light animation transitions.
- `CollectionCard.tsx`
  - Collection summary card used in organize mode and browsing mode.
- `CollectionModal.tsx`
  - Letter-level preview modal for a collection with image drill-in and letter delete action.
- `Lightbox.tsx`
  - Fullscreen image preview with keyboard navigation.
- `types.ts`
  - Shared upload page interfaces (`UploadedImage`, `LetterGroup`, `CollectionGroup`, `EditState`, `LightboxState`).

`frontend/src/pages/admin/UploadLetterPage.tsx` now composes these components and focuses on upload workflow/state.

## Admin Entity Management Components

Location: `frontend/src/pages/admin/EntityManagement/`

- `EntityListPanel.tsx`
  - Shared entity list/suggestions/search/selection panel used by both `PeoplePage` and `PlacesPage`.

`frontend/src/pages/admin/PeoplePage.tsx` and `frontend/src/pages/admin/PlacesPage.tsx` now reuse this component for the common entity-management list workflow and keep entity-specific detail panels/modals local.

## Admin Relationships Components

Location: `frontend/src/pages/admin/`

- `RelationshipsPage.tsx`
  - Relationships control center with table/graph modes, quality insights cards, confidence/type/search filters, inline edit modal, and direct navigation to People records.
- `relationships-utils.ts`
  - Shared filtering and analytics helpers (`filterRelationships`, `buildRelationshipInsights`) used by the relationships page and covered by unit tests.

## Shared Enum Options

Location: `frontend/src/constants/enums.ts`

- Centralized option lists for:
  - Emotional tones
  - Metadata relationship labels
  - Person relationship labels
  - Place type labels
  - Person/place role labels
  - Primary topic options

Pages now consume these shared options instead of duplicating local arrays (`PeoplePage`, `RelationshipsPage`, `PlacesPage`, `LetterReview/MetadataSection`, `LetterReview/AddEntityModal`).

## Public Discovery Components

Location: `frontend/src/pages/`

- `ExplorePage.tsx`
  - Public relationship atlas with collection/type/confidence filters, graph insights cards, top connectors panel, random-person discovery action, and profile deep-linking from graph nodes.
- `explore-utils.ts`
  - Graph filtering + analytics helpers used by `ExplorePage` (`applyGraphFilters`, `buildGraphInsights`) with dedicated unit tests.
- `CollectionsPage.tsx`
  - Collection browse page now includes search/sort/random discovery controls and aggregate collection stats.
- `CollectionDetailPage.tsx`
  - Collection detail adds quick historical context cards (date span + frequent correspondents) to improve narrative discovery.
