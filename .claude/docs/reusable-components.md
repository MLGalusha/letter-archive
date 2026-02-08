# Reusable UI Components

## Overview

The common component library provides consistent, reusable UI components across the application. These components replace inline implementations and ensure visual consistency.

## Location

All components are in `frontend/src/components/common/`:
- `Icon.tsx` - SVG icon system
- `Button.tsx` - Button and IconButton
- `Modal.tsx` - Modal dialog container
- `ConfirmDialog.tsx` - Confirmation dialog
- `Badge.tsx` - Status badges (Workflow, Visibility, Type, Status)
- `Dropdown.tsx` - Dropdown menu system
- `FormGroup.tsx` - Form field wrapper
- `AutoResizeTextarea.tsx` - Auto-growing textarea
- `index.ts` - Barrel export

Import from the barrel:
```tsx
import { Button, IconButton, ConfirmDialog, WorkflowBadge } from '../../components/common';
```

---

## Icon

Centralized SVG icons with consistent styling.

### Available Icons

| Name | Description |
|------|-------------|
| `upload` | Upload arrow |
| `edit` | Pencil/edit |
| `check` | Checkmark |
| `delete` | Trash can |
| `back` | Left arrow |
| `plus` | Plus sign |
| `save` | Floppy disk |
| `process` | Processing spinner |
| `arrow-left` | Chevron left |
| `arrow-right` | Chevron right |
| `close` | X close |
| `confirm` | Circled checkmark |
| `eye` | Visible eye |
| `eye-off` | Hidden eye |
| `reset` | Circular arrow |
| `clear` | X in circle |
| `select-all` | Checkbox checked |
| `folder` | Folder |
| `file` | Document |

### Usage

```tsx
import { Icon } from '../../components/common';

<Icon name="upload" />
<Icon name="check" size={24} />
<Icon name="delete" className="danger-icon" />
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `name` | `IconName` | required | Icon identifier |
| `size` | `number` | `18` | Width and height in pixels |
| `className` | `string` | `''` | Additional CSS class |

### Adding New Icons

1. Add icon name to `IconName` type
2. Add SVG paths to `iconPaths` object
3. Update this documentation

---

## Button

Standard button with variants, sizes, and icon support.

### Usage

```tsx
import { Button, IconButton } from '../../components/common';

// Text button
<Button onClick={handleClick}>Submit</Button>

// With icon
<Button icon="upload" onClick={handleUpload}>Upload</Button>

// Variants
<Button variant="primary">Primary</Button>
<Button variant="danger">Delete</Button>
<Button variant="ghost">Cancel</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>

// Active state (for toggles)
<Button icon="edit" active={isEditing}>{isEditing ? 'Done' : 'Edit'}</Button>

// Icon-only button
<IconButton icon="save" tooltip="Save changes" onClick={handleSave} />
<IconButton icon="delete" variant="danger" tooltip="Delete" />
```

### Button Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'primary' \| 'secondary' \| 'danger' \| 'ghost'` | `'secondary'` | Visual style |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Button size |
| `icon` | `IconName` | - | Icon to display |
| `iconPosition` | `'left' \| 'right'` | `'left'` | Icon placement |
| `active` | `boolean` | `false` | Toggled/active state |
| `loading` | `boolean` | `false` | Loading state |
| `disabled` | `boolean` | `false` | Disabled state |
| `children` | `ReactNode` | - | Button text |

### IconButton Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | `IconName` | required | Icon to display |
| `variant` | `'primary' \| 'secondary' \| 'danger' \| 'ghost'` | `'secondary'` | Visual style |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Button size |
| `active` | `boolean` | `false` | Active state |
| `tooltip` | `string` | - | Title/tooltip text |

---

## Modal

Dialog container with header, body, and actions.

### Usage

```tsx
import { Modal, Button } from '../../components/common';

<Modal
  isOpen={showModal}
  onClose={() => setShowModal(false)}
  title="Edit Letter"
  subtitle="Make changes to the letter details"
  actions={
    <>
      <Button onClick={() => setShowModal(false)}>Cancel</Button>
      <Button variant="primary" onClick={handleSave}>Save</Button>
    </>
  }
>
  <form>
    {/* Modal content */}
  </form>
</Modal>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | required | Show/hide modal |
| `onClose` | `() => void` | required | Close callback |
| `title` | `string` | required | Header title |
| `subtitle` | `string` | - | Optional subtitle |
| `children` | `ReactNode` | required | Modal body content |
| `actions` | `ReactNode` | - | Footer buttons |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Modal width |
| `closeOnOverlayClick` | `boolean` | `true` | Click outside to close |
| `showCloseButton` | `boolean` | `true` | Show X button |

---

## ConfirmDialog

Specialized modal for confirmation prompts.

### Usage

```tsx
import { ConfirmDialog } from '../../components/common';

<ConfirmDialog
  isOpen={showConfirm}
  title="Delete Letter"
  message="Are you sure you want to delete this letter? This action cannot be undone."
  confirmText="Delete"
  variant="danger"
  loading={isDeleting}
  onConfirm={handleDelete}
  onCancel={() => setShowConfirm(false)}
/>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | required | Show/hide dialog |
| `title` | `string` | required | Dialog title |
| `message` | `string \| ReactNode` | required | Confirmation message |
| `confirmText` | `string` | `'Confirm'` | Confirm button text |
| `cancelText` | `string` | `'Cancel'` | Cancel button text |
| `variant` | `'default' \| 'danger'` | `'default'` | Confirm button style |
| `loading` | `boolean` | `false` | Loading state |
| `onConfirm` | `() => void` | required | Confirm callback |
| `onCancel` | `() => void` | required | Cancel callback |

---

## Badge

Status indicators for workflow, visibility, and document types.

### Workflow Badge

Shows letter processing state.

```tsx
import { WorkflowBadge } from '../../components/common';

<WorkflowBadge state={letter.workflowState} />
```

| State | Label | Color |
|-------|-------|-------|
| `UPLOADED` | Uploaded | Blue (info) |
| `TRANSCRIBING` | Transcribing | Orange (warning) |
| `TRANSCRIBED` | Transcribed | Green (success) |
| `METADATA_EXTRACTING` | Extracting | Orange (warning) |
| `METADATA_DRAFTED` | Metadata Ready | Green (success) |
| `REVIEWED` | Reviewed | Green (success) |

### Visibility Badge

Shows letter visibility state.

```tsx
import { VisibilityBadge } from '../../components/common';

{letter.visibility !== 'DRAFT' && <VisibilityBadge state={letter.visibility} />}
```

| State | Label | Color |
|-------|-------|-------|
| `DRAFT` | Draft | Gray (muted) |
| `PUBLISHED` | Published | Green (success) |
| `HIDDEN` | Hidden | Orange (warning) |

### Type Badge

Shows document type from filename.

```tsx
import { TypeBadge } from '../../components/common';

<TypeBadge type="L" />  // "Letter"
<TypeBadge type="P" />  // "Photo"
```

| Type Code | Label | Color |
|-----------|-------|-------|
| `L` | Letter | Default |
| `P` | Photo | Blue (info) |
| `E` | Extra | Gray (muted) |
| `V` | Voice | Orange (warning) |
| `A` | Article | Default |
| `D` | Diary | Default |
| `C` | Cover | Gray (muted) |
| `N` | Card | Blue (info) |
| `T` | Telegram | Orange (warning) |

### Status Badge

Generic status indicator.

```tsx
import { StatusBadge } from '../../components/common';

<StatusBadge status="auto" label="Auto-transcribed" />
```

| Status | Default Label | Color |
|--------|---------------|-------|
| `auto` | Auto | Blue (info) |
| `manual` | Manual | Default |
| `pending` | Pending | Gray (muted) |
| `complete` | Complete | Green (success) |
| `error` | Error | Red (danger) |

---

## Dropdown

Menu dropdown with header, items, and dividers.

### Usage

```tsx
import { Dropdown, DropdownHeader, DropdownItem, DropdownDivider, Button } from '../../components/common';

<Dropdown
  trigger={<Button icon="process" active={isOpen}>Process</Button>}
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
>
  <DropdownHeader>Actions</DropdownHeader>
  <DropdownItem
    title="Transcribe"
    description="Process UPLOADED letters"
    onClick={handleTranscribe}
  />
  <DropdownItem
    title="Extract Metadata"
    description="Process TRANSCRIBED letters"
    onClick={handleExtract}
  />
  <DropdownDivider />
  <DropdownItem
    title="Delete"
    description="Permanently delete selected"
    onClick={handleDelete}
    variant="danger"
  />
</Dropdown>
```

### Dropdown Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `trigger` | `ReactNode` | required | Element that toggles dropdown |
| `isOpen` | `boolean` | required | Open state |
| `onClose` | `() => void` | required | Close callback |
| `children` | `ReactNode` | required | Menu content |
| `align` | `'left' \| 'right' \| 'center'` | `'left'` | Menu alignment |

### DropdownItem Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | required | Item label |
| `description` | `string` | - | Secondary text |
| `onClick` | `() => void` | required | Click handler |
| `disabled` | `boolean` | `false` | Disabled state |
| `variant` | `'default' \| 'danger' \| 'active'` | `'default'` | Visual style |

---

## Form Components

### FormGroup

Wraps form fields with label, error, and helper text.

```tsx
import { FormGroup } from '../../components/common';

<FormGroup label="Sender" id="sender" required error={errors.sender}>
  <input id="sender" value={sender} onChange={e => setSender(e.target.value)} />
</FormGroup>
```

### AutoResizeTextarea

Textarea that grows with content.

```tsx
import { AutoResizeTextarea } from '../../components/common';

<AutoResizeTextarea
  value={description}
  onChange={setDescription}
  placeholder="Enter description..."
  minHeight={80}
  maxLength={500}
/>
```

---

## Related Docs

- [frontend-architecture.md](frontend-architecture.md) - How components are used in pages
