import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from 'react';
import { unverifyMetadata, verifyMetadata } from '../../../api/admin';
import { useTooltip } from '../../../hooks/useTooltip';
import type {
  EmotionalTone,
  Letter,
  LetterMetadata,
  RelationshipType,
} from '../../../types/Letter';

type ToastType = 'success' | 'error' | 'info';
type ShowToast = (message: string, type: ToastType) => void;
interface MetadataFormValues {
  sender: string;
  recipient: string;
  date: string;
  location: string;
  hook: string;
  description: string;
  notes: string;
  emotionalTone: EmotionalTone | '';
  relationship: RelationshipType | '';
  primaryTopics: string[];
}

interface ApplyLetterMetadataOptions {
  includeNotes?: boolean;
}

interface UseMetadataEditingOptions {
  letterId?: string;
  letter: Letter | null;
  setLetter: Dispatch<SetStateAction<Letter | null>>;
  setSaving: Dispatch<SetStateAction<boolean>>;
  showToast: ShowToast;
}

function buildMetadataValues(
  metadata: LetterMetadata,
  notesFallback = metadata.notes || '',
): MetadataFormValues {
  return {
    sender: metadata.sender || '',
    recipient: metadata.recipient || '',
    date: metadata.date || '',
    location: metadata.location || '',
    hook: metadata.taggedHook || metadata.hook || '',
    description: metadata.taggedDescription || metadata.description || '',
    notes: notesFallback,
    emotionalTone: metadata.emotionalTone || '',
    relationship: metadata.senderRecipientRelationship || '',
    primaryTopics: metadata.primaryTopics || [],
  };
}

function areTopicsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((topic, index) => topic === right[index]);
}

export function useMetadataEditing({
  letterId,
  letter,
  setLetter,
  setSaving,
  showToast,
}: UseMetadataEditingOptions) {
  const [sender, setSender] = useState('');
  const [recipient, setRecipient] = useState('');
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [hook, setHook] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [emotionalTone, setEmotionalTone] = useState<EmotionalTone | ''>('');
  const [relationship, setRelationship] = useState<RelationshipType | ''>('');
  const [primaryTopics, setPrimaryTopics] = useState<string[]>([]);
  const [topicsDropdownOpen, setTopicsDropdownOpen] = useState(false);
  const [baselineValues, setBaselineValues] =
    useState<MetadataFormValues | null>(null);
  const [hasMetadataChanges, setHasMetadataChanges] = useState(false);
  const notesRef = useRef(notes);

  const {
    show: showMetadataTooltip,
    position: metadataTooltipPosition,
    ref: metadataTooltipRef,
    showAt: showMetadataTooltipAt,
    close: closeMetadataTooltip,
  } = useTooltip();

  const setMetadataFields = useCallback(
    (values: MetadataFormValues, options: ApplyLetterMetadataOptions = {}) => {
      setSender(values.sender);
      setRecipient(values.recipient);
      setDate(values.date);
      setLocation(values.location);
      setHook(values.hook);
      setDescription(values.description);

      if (options.includeNotes ?? true) {
        setNotes(values.notes);
      }

      setEmotionalTone(values.emotionalTone);
      setRelationship(values.relationship);
      setPrimaryTopics(values.primaryTopics);
    },
    [],
  );

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const applyLetterMetadata = useCallback(
    (
      updatedLetter: Pick<Letter, 'metadata'>,
      options: ApplyLetterMetadataOptions = {},
    ) => {
      const nextValues = buildMetadataValues(
        updatedLetter.metadata,
        options.includeNotes ?? true ? undefined : notesRef.current,
      );
      setMetadataFields(nextValues, options);
      setBaselineValues(nextValues);
    },
    [setMetadataFields],
  );

  const syncIdentityMetadata = useCallback(
    (updatedLetter: Pick<Letter, 'metadata'>) => {
      const nextValues = buildMetadataValues(
        updatedLetter.metadata,
        notesRef.current,
      );

      setSender(nextValues.sender);
      setRecipient(nextValues.recipient);
      setHook(nextValues.hook);
      setDescription(nextValues.description);

      setBaselineValues((currentBaseline) => {
        if (!currentBaseline) {
          return currentBaseline;
        }

        return {
          ...currentBaseline,
          sender: nextValues.sender,
          recipient: nextValues.recipient,
          hook: nextValues.hook,
          description: nextValues.description,
        };
      });
    },
    [],
  );

  useEffect(() => {
    if (!baselineValues) {
      setHasMetadataChanges(false);
      return;
    }

    setHasMetadataChanges(
      sender !== baselineValues.sender ||
        recipient !== baselineValues.recipient ||
        date !== baselineValues.date ||
        location !== baselineValues.location ||
        hook !== baselineValues.hook ||
        description !== baselineValues.description ||
        notes !== baselineValues.notes ||
        emotionalTone !== baselineValues.emotionalTone ||
        relationship !== baselineValues.relationship ||
        !areTopicsEqual(primaryTopics, baselineValues.primaryTopics),
    );
  }, [
    baselineValues,
    date,
    description,
    emotionalTone,
    hook,
    location,
    notes,
    primaryTopics,
    recipient,
    relationship,
    sender,
  ]);

  const handleVerifyMetadata = useCallback(async () => {
    if (!letterId) {
      return;
    }

    setSaving(true);

    try {
      const updated = await verifyMetadata(letterId);
      setLetter(updated);
      showToast('Metadata verified', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to verify metadata',
        'error',
      );
    } finally {
      setSaving(false);
    }
  }, [letterId, setLetter, setSaving, showToast]);

  const handleMetadataFieldClick = useCallback(
    (event: MouseEvent) => {
      if (letter?.metadataContentStatus !== 'VERIFIED') {
        return;
      }

      showMetadataTooltipAt(event.clientX, event.clientY);
    },
    [letter?.metadataContentStatus, showMetadataTooltipAt],
  );

  const handleMetadataFieldDoubleClick = useCallback(async () => {
    if (letter?.metadataContentStatus !== 'VERIFIED' || !letterId) {
      return;
    }

    closeMetadataTooltip();
    setSaving(true);

    try {
      const updated = await unverifyMetadata(letterId);
      setLetter(updated);
      showToast('Verification removed', 'info');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to unverify metadata',
        'error',
      );
    } finally {
      setSaving(false);
    }
  }, [
    closeMetadataTooltip,
    letter?.metadataContentStatus,
    letterId,
    setLetter,
    setSaving,
    showToast,
  ]);

  return {
    applyLetterMetadata,
    date,
    description,
    emotionalTone,
    handleMetadataFieldClick,
    handleMetadataFieldDoubleClick,
    handleVerifyMetadata,
    hasMetadataChanges,
    hook,
    location,
    metadataTooltipPosition,
    metadataTooltipRef,
    notes,
    primaryTopics,
    recipient,
    relationship,
    sender,
    setDate,
    setDescription,
    setEmotionalTone,
    setHook,
    setLocation,
    setNotes,
    setPrimaryTopics,
    setRecipient,
    setRelationship,
    setSender,
    setTopicsDropdownOpen,
    showMetadataTooltip,
    syncIdentityMetadata,
    topicsDropdownOpen,
  };
}
