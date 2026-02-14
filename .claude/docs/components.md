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
  - Inline editable linked entity row used by `MetadataSection`.

`frontend/src/pages/admin/LetterReviewPage.tsx` now owns state and handlers, then composes these sub-components via props.

## Admin Dashboard Components

Location: `frontend/src/pages/admin/AdminDashboard/`

- `DashboardFilterBar.tsx`
  - Dashboard filter/stats row: visibility pills, transcript/metadata status filters, collection input, date dropdown, search, and active filter controls.
- `RecentActivityTable.tsx`
  - Recent letters table: sortable columns, edit-mode cell interactions, status/sync indicators, and pagination controls.

`frontend/src/pages/admin/AdminDashboard.tsx` keeps data/state/business logic and composes these sections via props.
