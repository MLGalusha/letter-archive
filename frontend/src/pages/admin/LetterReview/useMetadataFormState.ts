import {
  useCallback,
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

function buildMetadataValues(
  metadata: LetterMetadata,
): MetadataFormValues {
  return {
    sender: metadata.sender || '',
    recipient: metadata.recipient || '',
    date: metadata.extractedDate || '',
    location: metadata.location || '',
    hook: metadata.taggedHook || metadata.hook || '',
    description: metadata.taggedDescription || metadata.description || '',
    notes: metadata.notes || '',
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

  const setMetadataFields = useCallback(
    (values: MetadataFormValues) => {
      setSender(values.sender);
      setRecipient(values.recipient);
      setDate(values.date);
      setLocation(values.location);
      setHook(values.hook);
      setDescription(values.description);
      setNotes(values.notes);
      setEmotionalTone(values.emotionalTone);
      setRelationship(values.relationship);
      setPrimaryTopics(values.primaryTopics);
    },
    [],
  );

  const applyLetterMetadata = useCallback(
    (updatedLetter: Pick<Letter, 'metadata'>) => {
      setMetadataFields(buildMetadataValues(updatedLetter.metadata));
    },
    [setMetadataFields],
  );

  const syncIdentityMetadata = useCallback(
    (updatedLetter: Pick<Letter, 'metadata'>) => {
      const nextValues = buildMetadataValues(updatedLetter.metadata);

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
