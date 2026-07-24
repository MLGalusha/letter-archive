import type {
  EmotionalTone,
  PersonRelationshipType,
  PersonRole,
  PlaceRole,
  PlaceType,
  RelationshipType,
} from "../types/Letter";

export interface EnumOption<T extends string> {
  value: T;
  label: string;
}

export const EMOTIONAL_TONE_OPTIONS: ReadonlyArray<EnumOption<EmotionalTone>> = [
  { value: "joyful", label: "Joyful" },
  { value: "affectionate", label: "Affectionate" },
  { value: "hopeful", label: "Hopeful" },
  { value: "grateful", label: "Grateful" },
  { value: "matter-of-fact", label: "Matter of Fact" },
  { value: "nostalgic", label: "Nostalgic" },
  { value: "anxious", label: "Anxious" },
  { value: "sad", label: "Sad" },
  { value: "angry", label: "Angry" },
];

export const METADATA_RELATIONSHIP_OPTIONS: ReadonlyArray<EnumOption<RelationshipType>> = [
  { value: "spouse", label: "Spouse" },
  { value: "romantic-partner", label: "Romantic Partner" },
  { value: "parent-child", label: "Parent / Child" },
  { value: "sibling", label: "Sibling" },
  { value: "extended-family", label: "Extended Family" },
  { value: "friend", label: "Friend" },
  { value: "acquaintance", label: "Acquaintance" },
  { value: "professional", label: "Professional" },
  { value: "institutional", label: "Institutional" },
  { value: "unknown", label: "Unknown" },
];

export const PERSON_RELATIONSHIP_OPTIONS: ReadonlyArray<EnumOption<PersonRelationshipType>> = [
  { value: "spouse", label: "Spouse" },
  { value: "fiancé/fiancée", label: "Fiancé/Fiancée" },
  { value: "romantic-partner", label: "Romantic Partner" },
  { value: "parent-child", label: "Parent/Child" },
  { value: "sibling", label: "Sibling" },
  { value: "grandparent-grandchild", label: "Grandparent/Grandchild" },
  { value: "aunt-uncle-niece-nephew", label: "Aunt/Uncle/Niece/Nephew" },
  { value: "cousin", label: "Cousin" },
  { value: "in-law", label: "In-law" },
  { value: "friend", label: "Friend" },
  { value: "acquaintance", label: "Acquaintance" },
  { value: "business-associate", label: "Business Associate" },
  { value: "employer-employee", label: "Employer/Employee" },
  { value: "unknown", label: "Unknown" },
];

export const PLACE_TYPE_OPTIONS: ReadonlyArray<EnumOption<PlaceType>> = [
  { value: "city", label: "City" },
  { value: "region", label: "Region/State" },
  { value: "country", label: "Country" },
  { value: "street", label: "Street/Address" },
  { value: "landmark", label: "Landmark" },
  { value: "other", label: "Other" },
];

export const PERSON_ROLE_OPTIONS: ReadonlyArray<EnumOption<PersonRole>> = [
  { value: "sender", label: "Sender" },
  { value: "recipient", label: "Recipient" },
  { value: "mentioned", label: "Mentioned" },
];

export const PLACE_ROLE_OPTIONS: ReadonlyArray<EnumOption<PlaceRole>> = [
  { value: "written_from", label: "Written From" },
  { value: "destination", label: "Destination" },
  { value: "mentioned", label: "Mentioned" },
];

export const PRIMARY_TOPIC_OPTIONS: ReadonlyArray<string> = [
  "family/marriage",
  "family/children",
  "family/death-grief",
  "family/separation-reunion",
  "family/courtship-romance",
  "health/illness-injury",
  "health/pregnancy-birth",
  "work/employment",
  "finances/hardship-prosperity",
  "travel/journey",
  "travel/immigration",
  "home/property-housing",
  "war/military",
  "religion/faith",
  "politics/governance",
  "education/school",
  "legal/property-estate",
  "daily-life/farming-weather",
  "daily-life/household-social",
  "community/local-events",
];
