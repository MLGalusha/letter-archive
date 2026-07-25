import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  EmotionalTone,
  Letter,
  LetterMetadata,
  RelationshipType,
} from '../../../types/Letter';

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

function buildMetadataValues(
  metadata: LetterMetadata,
  notesFallback = metadata.notes || '',
): MetadataFormValues {
  return {
    sender: metadata.sender || '',
    recipient: metadata.recipient || '',
    date: metadata.extractedDate || '',
    location: metadata.location || '',
    hook: metadata.taggedHook || metadata.hook || '',
    description: metadata.taggedDescription || metadata.description || '',
    notes: notesFallback,
    emotionalTone: metadata.emotionalTone || '',
    relationship: metadata.senderRecipientRelationship || '',
    primaryTopics: metadata.primaryTopics || [],
  };
}

/**
 * Owns request-free metadata form state and persisted DTO hydration.
 */
export function useMetadataFormState() {
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
  const notesRef = useRef(notes);

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
    },
    [],
  );

  return {
    applyLetterMetadata,
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
    syncIdentityMetadata,
    topicsDropdownOpen,
  } as const;
}
