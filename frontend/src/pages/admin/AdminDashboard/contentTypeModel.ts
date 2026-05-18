import type { ContentShapeFilter, DashboardFilterStats, ServerSortField } from "./types";

type ContentTypeDefinition = {
  value: ContentShapeFilter;
  label: string;
  sortLabel: string;
  sortDescription: string;
  countKey: keyof DashboardFilterStats;
  className: string;
  sortField: ServerSortField;
};

export const DASHBOARD_CONTENT_TYPES: ContentTypeDefinition[] = [
  {
    value: "extras",
    label: "Extra items",
    sortLabel: "Extra items",
    sortDescription: "All non-letter item count",
    countKey: "hasExtras",
    className: "filter-content-shape",
    sortField: "extras",
  },
  {
    value: "photos",
    label: "Photos",
    sortLabel: "Photo items",
    sortDescription: "Photo item count",
    countKey: "hasPhotos",
    className: "filter-content-shape",
    sortField: "photos",
  },
  {
    value: "cover",
    label: "Covers",
    sortLabel: "Covers",
    sortDescription: "Cover item count",
    countKey: "hasCover",
    className: "filter-content-shape",
    sortField: "cover",
  },
  {
    value: "telegram",
    label: "Telegrams",
    sortLabel: "Telegrams",
    sortDescription: "Telegram item count",
    countKey: "hasTelegram",
    className: "filter-content-shape",
    sortField: "telegram",
  },
  {
    value: "card",
    label: "Cards",
    sortLabel: "Cards",
    sortDescription: "Card item count",
    countKey: "hasCard",
    className: "filter-content-shape",
    sortField: "card",
  },
  {
    value: "ephemera",
    label: "Ephemera",
    sortLabel: "Ephemera",
    sortDescription: "Ephemera item count",
    countKey: "hasEphemera",
    className: "filter-content-shape",
    sortField: "ephemera",
  },
  {
    value: "article",
    label: "Articles",
    sortLabel: "Articles",
    sortDescription: "Article item count",
    countKey: "hasArticle",
    className: "filter-content-shape",
    sortField: "article",
  },
  {
    value: "diary",
    label: "Diary",
    sortLabel: "Diary",
    sortDescription: "Diary item count",
    countKey: "hasDiary",
    className: "filter-content-shape",
    sortField: "diary",
  },
  {
    value: "voice",
    label: "Voice",
    sortLabel: "Voice",
    sortDescription: "Voice recording count",
    countKey: "hasVoice",
    className: "filter-content-shape",
    sortField: "voice",
  },
];

export const CONTENT_SHAPE_FILTERS = DASHBOARD_CONTENT_TYPES;

export const CONTENT_TYPE_SORT_OPTIONS = DASHBOARD_CONTENT_TYPES
  .map((type) => ({
    value: type.sortField,
    label: type.sortLabel,
    description: type.sortDescription,
  }));
