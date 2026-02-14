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
  { value: "hopeful", label: "Hopeful" },
  { value: "neutral", label: "Neutral" },
  { value: "anxious", label: "Anxious" },
  { value: "sad", label: "Sad" },
  { value: "angry", label: "Angry" },
  { value: "desperate", label: "Desperate" },
];

export const METADATA_RELATIONSHIP_OPTIONS: ReadonlyArray<EnumOption<RelationshipType>> = [
  { value: "spouse", label: "Spouse" },
  { value: "fiancé/fiancée", label: "Fiancé/Fiancée" },
  { value: "romantic-partner", label: "Romantic Partner" },
  { value: "parent", label: "Parent" },
  { value: "child", label: "Child" },
  { value: "sibling", label: "Sibling" },
  { value: "grandparent", label: "Grandparent" },
  { value: "grandchild", label: "Grandchild" },
  { value: "aunt/uncle", label: "Aunt/Uncle" },
  { value: "nephew/niece", label: "Nephew/Niece" },
  { value: "cousin", label: "Cousin" },
  { value: "in-law", label: "In-Law" },
  { value: "friend", label: "Friend" },
  { value: "acquaintance", label: "Acquaintance" },
  { value: "business-associate", label: "Business Associate" },
  { value: "employer", label: "Employer" },
  { value: "employee", label: "Employee" },
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
  "family/separation",
  "family/reunion",
  "health/illness",
  "health/recovery",
  "health/pregnancy-birth",
  "work/employment",
  "work/job-loss",
  "finances/hardship",
  "finances/prosperity",
  "travel/journey",
  "travel/immigration",
  "home/moving",
  "home/property",
  "correspondence/news-sharing",
  "correspondence/advice",
  "correspondence/gratitude",
  "correspondence/apology",
  "war/service",
  "war/homefront",
  "religion/faith",
  "community/local-events",
  "daily-life/weather",
  "daily-life/farming",
  "daily-life/household",
  "daily-life/social",
];
