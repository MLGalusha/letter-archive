import { sql, type SQLWrapper } from 'drizzle-orm';
import { letters, letterPages } from '../db/index.js';
import type { ArchiveSearchQuery } from '../schemas/letter.js';
import { archiveSearchTerms, canFuzzyMatchArchiveTerm, ARCHIVE_TYPO_SIMILARITY } from './archive-search-matching.js';
import { publicFieldSql } from './public-read-model.js';
import { publicCatalogueChronologySql, publicCatalogueLetterTypeSql, publicCatalogueRepresentativeOrderSql } from './public-catalogue-unit.js';
import type { ArchiveSearchRow } from './archive-search-shared.js';

function buildArchivePublicMetadataSql(value: SQLWrapper) {
  return publicFieldSql(sql`l.metadata_published`, value);
}

function buildArchivePublicTranscriptSql(value: SQLWrapper) {
  return publicFieldSql(sql`l.transcript_published`, value);
}

function buildArchivePublicExtraContentSql(value: SQLWrapper) {
  return publicFieldSql(sql`(
    l.transcript_published
    AND l.extra_content_status = 'VERIFIED'
  )`, value);
}

function buildArchivePhotoOnlySql(value: SQLWrapper) {
  return publicFieldSql(sql`(
    l.type = 'P'
    AND l.photo_description_status = 'VERIFIED'
    AND NOT EXISTS (
      SELECT 1
      FROM letters public_peer
      WHERE public_peer.collection_id = l.collection_id
        AND public_peer.date_raw = l.date_raw
        AND public_peer.type_sequence = l.type_sequence
        AND public_peer.visibility = 'PUBLISHED'
        AND public_peer.type <> 'P'
    )
  )`, value);
}

// Bound SQL values still need LIKE wildcard escaping to mean literal user text.
function archiveLiteralPattern(value: string) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

export function buildArchiveSearchCtes(query: ArchiveSearchQuery, collectionIds: string[]) {
  const rowFilters = [
    sql`l.visibility = 'PUBLISHED'`,
    sql`EXISTS (
      SELECT 1
      FROM letters public_root
      WHERE public_root.collection_id = l.collection_id
        AND public_root.date_raw = l.date_raw
        AND public_root.type_sequence = l.type_sequence
        AND public_root.visibility = 'PUBLISHED'
        AND ${publicCatalogueLetterTypeSql(sql`public_root.type`)}
    )`,
  ];

  if (collectionIds.length > 0) {
    rowFilters.push(
      sql`l.collection_id = ANY(ARRAY[${sql.join(collectionIds.map((id) => sql`${id}`), sql`, `)}]::uuid[])`,
    );
  }

  const trimmedSearch = query.search?.trim();
  if (trimmedSearch) {
    rowFilters.push(buildArchiveTypedMatchSql(trimmedSearch, query.exact));
  }

  const baseScopedFilters = [sql`TRUE`];
  if (query.person) {
    const personNeedle = `%${query.person}%`;
    if (query.personRole === 'sender') {
      baseScopedFilters.push(sql`EXISTS (
        SELECT 1
        FROM UNNEST(COALESCE(gf.senders, ARRAY[]::text[])) AS person_name
        WHERE person_name ILIKE ${personNeedle}
      )`);
    } else if (query.personRole === 'recipient') {
      baseScopedFilters.push(sql`EXISTS (
        SELECT 1
        FROM UNNEST(COALESCE(gf.recipients, ARRAY[]::text[])) AS person_name
        WHERE person_name ILIKE ${personNeedle}
      )`);
    } else {
      baseScopedFilters.push(sql`EXISTS (
        SELECT 1
        FROM UNNEST(COALESCE(gf.senders, ARRAY[]::text[]) || COALESCE(gf.recipients, ARRAY[]::text[])) AS person_name
        WHERE person_name ILIKE ${personNeedle}
      )`);
    }
  }
  if (query.sender) {
    baseScopedFilters.push(sql`EXISTS (
      SELECT 1
      FROM UNNEST(COALESCE(gf.senders, ARRAY[]::text[])) AS sender_name
      WHERE STRPOS(LOWER(sender_name), LOWER(${query.sender})) > 0
    )`);
  }
  if (query.recipient) {
    baseScopedFilters.push(sql`EXISTS (
      SELECT 1
      FROM UNNEST(COALESCE(gf.recipients, ARRAY[]::text[])) AS recipient_name
      WHERE STRPOS(LOWER(recipient_name), LOWER(${query.recipient})) > 0
    )`);
  }
  if (query.place) {
    baseScopedFilters.push(sql`EXISTS (
      SELECT 1
      FROM UNNEST(COALESCE(gf.places, ARRAY[]::text[])) AS place_name
      WHERE STRPOS(LOWER(place_name), LOWER(${query.place})) > 0
    )`);
  }
  const topicFilters = [sql`TRUE`];
  const toneFilters = [sql`TRUE`];
  const relationshipFilters = [sql`TRUE`];
  if (query.topic) {
    const topics = query.topic.split(",").map((t: string) => t.trim()).filter(Boolean);
    if (topics.length === 1) {
      const topicNeedle = topics[0]!.toLowerCase();
      topicFilters.push(sql`EXISTS (
        SELECT 1
        FROM UNNEST(COALESCE(gf.topics, ARRAY[]::text[])) AS topic_name
        WHERE LOWER(BTRIM(topic_name)) = ${topicNeedle}
          OR STARTS_WITH(LOWER(BTRIM(topic_name)), ${topicNeedle + '/'})
      )`);
    } else if (topics.length > 1) {
      const conditions = topics.map((t: string) => {
        const needle = t.toLowerCase();
        return sql`(LOWER(BTRIM(topic_name)) = ${needle} OR STARTS_WITH(LOWER(BTRIM(topic_name)), ${needle + '/'}))`;
      });
      topicFilters.push(sql`EXISTS (
        SELECT 1
        FROM UNNEST(COALESCE(gf.topics, ARRAY[]::text[])) AS topic_name
        WHERE ${sql.join(conditions, sql` OR `)}
      )`);
    }
  }
  if (query.tone) {
    const tones = query.tone.split(",").map((t: string) => t.trim()).filter(Boolean);
    if (tones.length === 1) {
      toneFilters.push(sql`${tones[0]} = ANY(COALESCE(gf.tones, ARRAY[]::text[]))`);
    } else if (tones.length > 1) {
      const conditions = tones.map((t: string) => sql`${t} = ANY(COALESCE(gf.tones, ARRAY[]::text[]))`);
      toneFilters.push(sql`(${sql.join(conditions, sql` OR `)})`);
    }
  }
  if (query.relationship) {
    const rels = query.relationship.split(",").map((r: string) => r.trim()).filter(Boolean);
    if (rels.length === 1) {
      relationshipFilters.push(sql`${rels[0]} = ANY(COALESCE(gf.relationships, ARRAY[]::text[]))`);
    } else if (rels.length > 1) {
      const conditions = rels.map((r: string) => sql`${r} = ANY(COALESCE(gf.relationships, ARRAY[]::text[]))`);
      relationshipFilters.push(sql`(${sql.join(conditions, sql` OR `)})`);
    }
  }
  if (query.year) {
    const yearText = String(query.year);
    baseScopedFilters.push(sql`SUBSTRING(mg."dateRaw", 1, 4) = ${yearText}`);
  }
  if (query.yearFrom !== undefined) {
    baseScopedFilters.push(sql`SUBSTRING(mg."dateRaw", 1, 4) ~ '^[0-9]{4}$' AND SUBSTRING(mg."dateRaw", 1, 4)::int >= ${query.yearFrom}`);
  }
  if (query.yearTo !== undefined) {
    baseScopedFilters.push(sql`SUBSTRING(mg."dateRaw", 1, 4) ~ '^[0-9]{4}$' AND SUBSTRING(mg."dateRaw", 1, 4)::int <= ${query.yearTo}`);
  }
  if (query.hasTranscript !== undefined) {
    baseScopedFilters.push(sql`pr."hasTranscript" = ${query.hasTranscript}`);
  }
  if (query.verified !== undefined) {
    baseScopedFilters.push(sql`pr."transcriptVerified" = ${query.verified}`);
  }

  const formatFilter = query.format?.length
    ? sql`COALESCE(bsg.formats, ARRAY[]::text[]) && ARRAY[${sql.join(
      query.format.map((format) => sql`${format}`),
      sql`, `,
    )}]::text[]`
    : sql`TRUE`;

  const searchRank = trimmedSearch
    ? sql`(
        CASE WHEN ${buildArchiveSearchTextSql()} ILIKE ${archiveLiteralPattern(trimmedSearch)} THEN 30::real ELSE 0::real END
        + ${buildArchiveContiguousPhraseBoostSql(trimmedSearch)}
        + ${buildArchiveAllTermsMatchBoostSql(trimmedSearch)}
      )`
    : sql`0::real`;

  return sql`
    WITH filtered_rows AS (
      SELECT
        l.collection_id AS "collectionId",
        l.date_raw AS "dateRaw",
        l.type_sequence AS "typeSequence",
        ${searchRank} AS "searchRank"
      FROM letters l
      INNER JOIN collections c ON c.id = l.collection_id
      WHERE ${sql.join(rowFilters, sql` AND `)}
    ),
    matching_groups AS (
      SELECT
        "collectionId",
        "dateRaw",
        "typeSequence",
        MAX("searchRank") AS "searchRank"
      FROM filtered_rows
      GROUP BY "collectionId", "dateRaw", "typeSequence"
    ),
    group_filters AS (
      SELECT
        mg."collectionId",
        mg."dateRaw",
        mg."typeSequence",
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT ${buildArchiveMediaTypeSql()}), NULL) AS formats,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(${buildArchivePublicMetadataSql(sql`l.sender`)}), '')), NULL) AS senders,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(${buildArchivePublicMetadataSql(sql`l.recipient`)}), '')), NULL) AS recipients,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(${buildArchivePublicMetadataSql(sql`l.location_written`)}), '')), NULL) AS places,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(${buildArchivePublicMetadataSql(sql`l.hook`)}), '')), NULL) AS hooks,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(${buildArchivePublicMetadataSql(sql`l.summary`)}), '')), NULL) AS summaries,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(tag_name), '')), NULL) AS tags,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(topic_name), '')), NULL) AS topics,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(${buildArchivePublicMetadataSql(sql`l.emotional_tone::text`)}), '')), NULL) AS tones,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(${buildArchivePublicMetadataSql(sql`l.sender_recipient_relationship::text`)}), '')), NULL) AS relationships,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(${buildArchivePhotoOnlySql(sql`l.photo_description`)}), '')), NULL) AS "photoDescriptions",
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(${buildArchivePublicExtraContentSql(sql`l.extra_content_transcript`)}), '')), NULL) AS "extraContentTranscripts",
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(BTRIM(${buildArchivePublicTranscriptSql(sql`l.transcription_text`)}), '')), NULL) AS "transcriptionTexts"
      FROM matching_groups mg
      INNER JOIN letters l
        ON l.collection_id = mg."collectionId"
        AND l.date_raw = mg."dateRaw"
        AND l.type_sequence = mg."typeSequence"
        AND l.visibility = 'PUBLISHED'
      LEFT JOIN LATERAL UNNEST(COALESCE(
        ${buildArchivePublicMetadataSql(sql`l.primary_topics`)},
        ARRAY[]::text[]
      )) AS topic_name ON TRUE
      LEFT JOIN LATERAL UNNEST(COALESCE(
        ${buildArchivePublicMetadataSql(sql`l.tags`)},
        ARRAY[]::text[]
      )) AS tag_name ON TRUE
      GROUP BY mg."collectionId", mg."dateRaw", mg."typeSequence"
    ),
    primary_rows AS (
      SELECT DISTINCT ON (l.collection_id, l.date_raw, l.type_sequence)
        l.id,
        l.collection_id AS "collectionId",
        l.date_raw AS "dateRaw",
        l.type_sequence AS "typeSequence",
        l.type AS "primaryType",
        ${buildArchivePublicMetadataSql(sql`l.sender`)} AS sender,
        ${buildArchivePublicMetadataSql(sql`l.recipient`)} AS recipient,
        ${buildArchivePublicMetadataSql(sql`l.location_written`)} AS location,
        ${buildArchivePublicMetadataSql(sql`l.hook`)} AS hook,
        (l.metadata_published AND l.metadata_content_status = 'VERIFIED') AS "metadataVerified",
        (l.transcript_published AND l.transcript_status != 'EMPTY') AS "hasTranscript",
        (l.transcript_published AND (
          l.transcript_status = 'VERIFIED'
          OR (l.transcript_status = 'EMPTY' AND l.extra_content_status = 'VERIFIED')
        )) AS "transcriptVerified",
        c.collection_code AS "collectionCode",
        c.title AS "collectionTitle",
        l.created_at AS "createdAt"
      FROM letters l
      INNER JOIN collections c ON c.id = l.collection_id
      INNER JOIN matching_groups mg
        ON mg."collectionId" = l.collection_id
        AND mg."dateRaw" = l.date_raw
        AND mg."typeSequence" = l.type_sequence
      WHERE l.visibility = 'PUBLISHED'
        AND ${publicCatalogueLetterTypeSql(sql`l.type`)}
      ORDER BY
        l.collection_id,
        l.date_raw,
        l.type_sequence,
        ${publicCatalogueRepresentativeOrderSql(sql`l.type`)},
        l.id ASC
    ),
    facet_base_groups AS (
      SELECT
        mg."collectionId",
        mg."dateRaw",
        mg."typeSequence",
        mg."searchRank",
        (${sql.join(topicFilters, sql` AND `)}) AS "matchesTopic",
        (${sql.join(toneFilters, sql` AND `)}) AS "matchesTone",
        (${sql.join(relationshipFilters, sql` AND `)}) AS "matchesRelationship",
        gf.formats,
        gf.senders,
        gf.recipients,
        gf.places,
        gf.hooks,
        gf.summaries,
        gf.tags,
        gf.topics,
        gf.tones,
        gf.relationships,
        gf."photoDescriptions",
        gf."extraContentTranscripts",
        gf."transcriptionTexts",
        pr.id,
        pr."primaryType",
        pr.sender,
        pr.recipient,
        pr.location,
        pr.hook,
        pr."metadataVerified",
        pr."hasTranscript",
        pr."transcriptVerified",
        pr."collectionCode",
        pr."collectionTitle",
        pr."createdAt"
      FROM matching_groups mg
      INNER JOIN group_filters gf
        ON gf."collectionId" = mg."collectionId"
        AND gf."dateRaw" = mg."dateRaw"
        AND gf."typeSequence" = mg."typeSequence"
      INNER JOIN primary_rows pr
        ON pr."collectionId" = mg."collectionId"
        AND pr."dateRaw" = mg."dateRaw"
        AND pr."typeSequence" = mg."typeSequence"
      WHERE ${sql.join(baseScopedFilters, sql` AND `)}
    ),
    base_scoped_groups AS (
      SELECT * FROM facet_base_groups
      WHERE "matchesTopic" AND "matchesTone" AND "matchesRelationship"
    ),
    topic_facet_groups AS (
      SELECT * FROM facet_base_groups bsg
      WHERE "matchesTone" AND "matchesRelationship" AND ${formatFilter}
    ),
    tone_facet_groups AS (
      SELECT * FROM facet_base_groups bsg
      WHERE "matchesTopic" AND "matchesRelationship" AND ${formatFilter}
    ),
    relationship_facet_groups AS (
      SELECT * FROM facet_base_groups bsg
      WHERE "matchesTopic" AND "matchesTone" AND ${formatFilter}
    ),
    scoped_groups AS (
      SELECT *
      FROM base_scoped_groups bsg
      WHERE ${formatFilter}
    )
  `;
}

// One allowlist supplies SQL eligibility/ranking and public match explanations.
// Order is the per-result fallback policy, not a global metadata fallback.
export function getArchiveTypedSearchFields() {
  return [
    {
      label: 'Transcript',
      fuzzy: false,
      expressions: [
        buildArchivePublicTranscriptSql(sql`l.transcription_text`),
        buildArchivePublicExtraContentSql(sql`l.extra_content_transcript`),
      ],
      values: (row: ArchiveSearchRow, _date: string) => [
        ...(row.transcriptionTexts || []), ...(row.extraContentTranscripts || []),
      ],
    },
    {
      label: 'Date',
      fuzzy: false,
      expressions: [sql`l.date_raw`],
      // Explain only the raw date searched by SQL, not display-only month names.
      values: (row: ArchiveSearchRow, _date: string) => [row.dateRaw],
    },
    {
      label: 'Sender',
      fuzzy: true,
      expressions: [buildArchivePublicMetadataSql(sql`l.sender`)],
      values: (row: ArchiveSearchRow, _date: string) => row.senders || [],
    },
    {
      label: 'Recipient',
      fuzzy: true,
      expressions: [buildArchivePublicMetadataSql(sql`l.recipient`)],
      values: (row: ArchiveSearchRow, _date: string) => row.recipients || [],
    },
    {
      label: 'Location',
      fuzzy: true,
      expressions: [buildArchivePublicMetadataSql(sql`l.location_written`)],
      values: (row: ArchiveSearchRow, _date: string) => row.places || [],
    },
  ];
}

export function archiveSearchSourceSql(expression: SQLWrapper) {
  return sql`regexp_replace(COALESCE(${expression}, ''), '---[ \t\r\n\f\v]*Page[ \t\r\n\f\v]+[0-9]+[ \t\r\n\f\v]*---', ' ', 'gi')`;
}

function buildArchiveTypedMatchSql(search: string, exact = false) {
  const terms = exact ? [search.trim()] : archiveSearchTerms(search);
  const sources = getArchiveTypedSearchFields().flatMap((field) => field.expressions.map((expression) => {
    // Preview text removes generated page separators; they must not admit results either.
    const source = archiveSearchSourceSql(expression);
    const matches = terms.map((term) => {
      const literal = sql`lower(${source}) LIKE lower(${archiveLiteralPattern(term)})`;
      if (exact || !field.fuzzy || !canFuzzyMatchArchiveTerm(term)) return literal;
      return sql`(${literal} OR EXISTS (
        SELECT 1 FROM regexp_split_to_table(lower(${source}), '[^[:alnum:]]+') AS word
        WHERE similarity(word, lower(${term})) >= ${ARCHIVE_TYPO_SIMILARITY}
      ))`;
    });
    return sql`(${sql.join(matches, sql` AND `)})`;
  }));
  return sql`(${sql.join(sources, sql` OR `)})`;
}

function buildArchiveSearchTextSql() {
  return sql`TRIM(CONCAT_WS(' ', ${sql.join(
    getArchiveTypedSearchFields().flatMap((field) => field.expressions), sql`, `,
  )}))`;
}

function buildArchiveAllTermsMatchBoostSql(searchTerm: string) {
  const searchTerms = getArchiveSearchTerms(searchTerm);
  if (searchTerms.length < 2) return sql`0::real`;

  const searchTextSql = buildArchiveSearchTextSql();
  const conditions = searchTerms.map((term) => sql`lower(${searchTextSql}) LIKE lower(${archiveLiteralPattern(term)})`);

  return sql`CASE WHEN ${sql.join(conditions, sql` AND `)} THEN 3::real ELSE 0::real END`;
}

function buildArchiveContiguousPhraseBoostSql(searchTerm: string) {
  const phrases = getArchiveContiguousSearchPhrases(searchTerm);
  if (phrases.length === 0) return sql`0::real`;

  const searchTextSql = buildArchiveSearchTextSql();
  const boosts = phrases.map((phrase) => {
    const termCount = phrase.split(' ').length;
    const boost = termCount * 5;
    return sql`CASE WHEN lower(${searchTextSql}) LIKE lower(${archiveLiteralPattern(phrase)}) THEN ${boost}::real ELSE 0::real END`;
  });

  return sql`(${sql.join(boosts, sql` + `)})`;
}

function buildArchiveMediaTypeSql() {
  return sql`CASE
    WHEN l.type = 'L' THEN 'letter'
    WHEN l.type = 'P' THEN 'photo'
    WHEN l.type = 'E' THEN 'ephemera'
    WHEN l.type = 'V' THEN 'voice'
    WHEN l.type = 'A' THEN 'article'
    WHEN l.type = 'D' THEN 'diary'
    WHEN l.type = 'C' THEN 'cover'
    WHEN l.type = 'N' THEN 'card'
    WHEN l.type = 'T' THEN 'telegram'
    ELSE 'letter'
  END`;
}

export function buildArchiveSearchOrderBy(query: ArchiveSearchQuery) {
  const hasSearch = Boolean(query.search?.trim());
  const resolvedSort = query.sort === 'relevance' && !hasSearch ? 'createdAt' : query.sort;

  if (resolvedSort === 'letterDate') {
    return publicCatalogueChronologySql(
      sql`sg."dateRaw"`, sql`sg."collectionId"`, sql`sg."typeSequence"`, query.sortOrder === 'desc',
    );
  }

  // Keep tied results stable across pages without changing the selected sort.
  const groupTieBreak = sql`sg."collectionId" ASC, sg."dateRaw" ASC, sg."typeSequence" ASC`;

  if (resolvedSort === 'createdAt') {
    return query.sortOrder === 'asc'
      ? sql`sg."createdAt" ASC, REPLACE(sg."dateRaw", 'X', '0') ASC, ${groupTieBreak}`
      : sql`sg."createdAt" DESC, REPLACE(sg."dateRaw", 'X', '0') DESC, ${groupTieBreak}`;
  }

  if (resolvedSort === 'sender') {
    return query.sortOrder === 'asc'
      ? sql`LOWER(NULLIF(sg.sender, '')) ASC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') ASC, sg."createdAt" DESC, ${groupTieBreak}`
      : sql`LOWER(NULLIF(sg.sender, '')) DESC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') DESC, sg."createdAt" DESC, ${groupTieBreak}`;
  }

  if (resolvedSort === 'recipient') {
    return query.sortOrder === 'asc'
      ? sql`LOWER(NULLIF(sg.recipient, '')) ASC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') ASC, sg."createdAt" DESC, ${groupTieBreak}`
      : sql`LOWER(NULLIF(sg.recipient, '')) DESC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') DESC, sg."createdAt" DESC, ${groupTieBreak}`;
  }

  if (resolvedSort === 'collection') {
    return query.sortOrder === 'asc'
      ? sql`LOWER(NULLIF(sg."collectionCode", '')) ASC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') ASC, sg."createdAt" DESC, ${groupTieBreak}`
      : sql`LOWER(NULLIF(sg."collectionCode", '')) DESC NULLS LAST, REPLACE(sg."dateRaw", 'X', '0') DESC, sg."createdAt" DESC, ${groupTieBreak}`;
  }

  return sql`sg."searchRank" DESC, REPLACE(sg."dateRaw", 'X', '0') DESC, sg."createdAt" DESC, ${groupTieBreak}`;
}

function getArchiveSearchTerms(search: string) {
  return archiveSearchTerms(search);
}

// Each phrase returned here becomes its own `LIKE` clause in the archive
// ranking SQL, evaluated per row. Phrase count grows O(n^2) in the number of
// terms, so long queries can blow up the score expression — cap both the
// terms we consider and the total phrases we emit. Longer phrases score
// higher (termCount * 5), so when we cap we drop the shortest first.
const MAX_PHRASE_TERMS = 8;
const MAX_PHRASES = 20;

export function getArchiveContiguousSearchPhrases(search: string) {
  const allTerms = normalizeArchiveSearchText(search)
    .split(' ')
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  if (allTerms.length < 2) return [];

  const terms = allTerms.slice(0, MAX_PHRASE_TERMS);

  const phrases: string[] = [];
  for (let length = terms.length - 1; length >= 2; length -= 1) {
    for (let start = 0; start + length <= terms.length; start += 1) {
      phrases.push(terms.slice(start, start + length).join(' '));
      if (phrases.length >= MAX_PHRASES) break;
    }
    if (phrases.length >= MAX_PHRASES) break;
  }

  return Array.from(new Set(phrases));
}

function normalizeArchiveSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


export function buildArchiveSearchRowsQuery(query: ArchiveSearchQuery, ctes: SQLWrapper, orderBy: SQLWrapper, offset: number, fuzzyTerms: string[]) {
  return sql`
      ${ctes}
      , primary_page_counts AS (
        SELECT
          sg."collectionId",
          sg."dateRaw",
          sg."typeSequence",
          COUNT(${letterPages.id})::int AS "primaryPageCount"
        FROM scoped_groups sg
        INNER JOIN letters l
          ON l.collection_id = sg."collectionId"
          AND l.date_raw = sg."dateRaw"
          AND l.type_sequence = sg."typeSequence"
          AND l.type = sg."primaryType"
          AND l.visibility = 'PUBLISHED'
        INNER JOIN letter_pages ON letter_pages.letter_id = l.id
        GROUP BY sg."collectionId", sg."dateRaw", sg."typeSequence"
      )
      , display_pages AS (
        SELECT DISTINCT ON (sg."collectionId", sg."dateRaw", sg."typeSequence")
          sg."collectionId",
          sg."dateRaw",
          sg."typeSequence",
          letter_pages.id AS "pageId",
          letter_pages.checksum_sha256 AS "checksumSha256"
        FROM scoped_groups sg
        INNER JOIN letters l
          ON l.collection_id = sg."collectionId"
          AND l.date_raw = sg."dateRaw"
          AND l.type_sequence = sg."typeSequence"
          AND l.type = sg."primaryType"
          AND l.visibility = 'PUBLISHED'
        INNER JOIN letter_pages ON letter_pages.letter_id = l.id
        ORDER BY
          sg."collectionId",
          sg."dateRaw",
          sg."typeSequence",
          letter_pages.page_number ASC
      )
      , paged_groups AS (
        SELECT * FROM scoped_groups sg
        ORDER BY ${orderBy}
        LIMIT ${query.limit}
        OFFSET ${offset}
      )
      SELECT
        totals."totalCount",
        sg.id,
        sg."collectionId",
        sg."collectionCode",
        sg."collectionTitle",
        sg."dateRaw",
        sg."createdAt",
        sg."primaryType",
        COALESCE(ppc."primaryPageCount", 0) AS "primaryPageCount",
        sg.sender,
        sg.recipient,
        sg.location,
        sg.hook,
        sg."metadataVerified",
        dp."pageId",
        dp."checksumSha256",
        sg.formats,
        sg.senders,
        sg.recipients,
        sg.places,
        sg.hooks,
        sg.summaries,
        sg.tags,
        sg.topics,
        sg.tones,
        sg.relationships,
        sg."photoDescriptions",
        sg."extraContentTranscripts",
        sg."transcriptionTexts",
        lower(${query.search || ''}) AS "normalizedSearch",
        CASE WHEN sg.id IS NOT NULL AND ${Boolean(query.search)} THEN (
          SELECT jsonb_object_agg(value, lower(value))
          FROM unnest(COALESCE(sg."transcriptionTexts", ARRAY[]::text[])
            || COALESCE(sg."extraContentTranscripts", ARRAY[]::text[])
            || COALESCE(sg.senders, ARRAY[]::text[]) || COALESCE(sg.recipients, ARRAY[]::text[])
            || COALESCE(sg.places, ARRAY[]::text[]) || ARRAY[sg."dateRaw"]) AS value
        ) ELSE NULL END AS "searchCaseMap",
        CASE WHEN sg.id IS NOT NULL AND ${fuzzyTerms.length > 0} THEN (
          SELECT jsonb_object_agg(value, regexp_split_to_array(lower(${archiveSearchSourceSql(sql`value`)}), '[^[:alnum:]]+'))
          FROM unnest(COALESCE(sg.senders, ARRAY[]::text[]) || COALESCE(sg.recipients, ARRAY[]::text[])
            || COALESCE(sg.places, ARRAY[]::text[])
            || ARRAY[${sql.join(fuzzyTerms.map((term) => sql`${term}`), sql`, `)}]::text[]) AS value
        ) ELSE NULL END AS "searchWordMap"
      FROM (SELECT COUNT(*)::int AS "totalCount" FROM scoped_groups) totals
      LEFT JOIN paged_groups sg ON TRUE
      LEFT JOIN primary_page_counts ppc
        ON ppc."collectionId" = sg."collectionId"
        AND ppc."dateRaw" = sg."dateRaw"
        AND ppc."typeSequence" = sg."typeSequence"
      LEFT JOIN display_pages dp
        ON dp."collectionId" = sg."collectionId"
        AND dp."dateRaw" = sg."dateRaw"
        AND dp."typeSequence" = sg."typeSequence"
      ORDER BY ${orderBy}
  `;
}

export function buildArchiveSearchFacetsQuery(ctes: SQLWrapper) {
  return sql`
      ${ctes}
      SELECT 'formats' AS facet, value, label, count FROM (
        SELECT format AS value, NULL AS label, COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT bsg."collectionId", bsg."dateRaw", bsg."typeSequence", UNNEST(bsg.formats) AS format
          FROM base_scoped_groups bsg
        ) gf
        GROUP BY format ORDER BY count DESC, format ASC
      ) f
      UNION ALL
      SELECT 'collections' AS facet, value, label, count FROM (
        SELECT sg."collectionCode" AS value,
          COALESCE(NULLIF(sg."collectionTitle", ''), sg."collectionCode") AS label,
          COUNT(*)::int AS count
        FROM scoped_groups sg
        GROUP BY sg."collectionCode", sg."collectionTitle"
        ORDER BY count DESC, sg."collectionCode" ASC LIMIT 9
      ) c
      UNION ALL
      SELECT 'correspondents' AS facet, value, NULL AS label, count FROM (
        SELECT value, COUNT(*)::int AS count FROM (
          SELECT DISTINCT sg."collectionId", sg."dateRaw", sg."typeSequence", person_name AS value
          FROM scoped_groups sg
          CROSS JOIN LATERAL UNNEST(COALESCE(sg.senders, ARRAY[]::text[]) || COALESCE(sg.recipients, ARRAY[]::text[])) AS person_name
          WHERE person_name IS NOT NULL AND person_name <> ''
        ) gp GROUP BY value ORDER BY count DESC, value ASC LIMIT 9
      ) p
      UNION ALL
      SELECT 'senders' AS facet, candidate.value, NULL AS label, (
        SELECT COUNT(*)::int FROM scoped_groups matched
        WHERE EXISTS (SELECT 1 FROM UNNEST(matched.senders) person_name
          WHERE STRPOS(LOWER(person_name), LOWER(candidate.value)) > 0)
      ) AS count
      FROM (
        SELECT person_name AS value FROM scoped_groups
        CROSS JOIN LATERAL UNNEST(senders) person_name
        WHERE person_name IS NOT NULL AND person_name <> ''
        GROUP BY person_name ORDER BY COUNT(*) DESC, person_name ASC LIMIT 9
      ) candidate
      UNION ALL
      SELECT 'recipients' AS facet, candidate.value, NULL AS label, (
        SELECT COUNT(*)::int FROM scoped_groups matched
        WHERE EXISTS (SELECT 1 FROM UNNEST(matched.recipients) person_name
          WHERE STRPOS(LOWER(person_name), LOWER(candidate.value)) > 0)
      ) AS count
      FROM (
        SELECT person_name AS value FROM scoped_groups
        CROSS JOIN LATERAL UNNEST(recipients) person_name
        WHERE person_name IS NOT NULL AND person_name <> ''
        GROUP BY person_name ORDER BY COUNT(*) DESC, person_name ASC LIMIT 9
      ) candidate
      UNION ALL
      SELECT 'places' AS facet, candidate.value, NULL AS label, (
        SELECT COUNT(*)::int FROM scoped_groups matched
        WHERE EXISTS (SELECT 1 FROM UNNEST(matched.places) place_name
          WHERE STRPOS(LOWER(place_name), LOWER(candidate.value)) > 0)
      ) AS count
      FROM (
        SELECT place_name AS value FROM scoped_groups
        CROSS JOIN LATERAL UNNEST(places) place_name
        WHERE place_name IS NOT NULL AND place_name <> ''
        GROUP BY place_name ORDER BY COUNT(*) DESC, place_name ASC LIMIT 9
      ) candidate
      UNION ALL
      SELECT 'years' AS facet, value::text, NULL AS label, count FROM (
        SELECT SUBSTRING("dateRaw", 1, 4)::int AS value, COUNT(*)::int AS count
        FROM scoped_groups
        WHERE SUBSTRING("dateRaw", 1, 4) ~ '^[0-9]{4}$'
        GROUP BY SUBSTRING("dateRaw", 1, 4)
        ORDER BY SUBSTRING("dateRaw", 1, 4) DESC LIMIT 9
      ) y
      UNION ALL
      SELECT 'topics' AS facet, value, NULL AS label, count FROM (
        SELECT value, COUNT(*)::int AS count FROM (
          SELECT DISTINCT sg."collectionId", sg."dateRaw", sg."typeSequence", LOWER(BTRIM(SPLIT_PART(topic_name, '/', 1))) AS value
          FROM topic_facet_groups sg
          CROSS JOIN LATERAL UNNEST(COALESCE(sg.topics, ARRAY[]::text[])) AS topic_name
          WHERE topic_name IS NOT NULL AND topic_name <> ''
        ) gt GROUP BY value ORDER BY count DESC, value ASC LIMIT 51
      ) t
      UNION ALL
      SELECT 'tones' AS facet, value, NULL AS label, count FROM (
        SELECT value, COUNT(*)::int AS count FROM (
          SELECT DISTINCT sg."collectionId", sg."dateRaw", sg."typeSequence", tone_name AS value
          FROM tone_facet_groups sg
          CROSS JOIN LATERAL UNNEST(COALESCE(sg.tones, ARRAY[]::text[])) AS tone_name
          WHERE tone_name IS NOT NULL AND tone_name <> ''
        ) gtn GROUP BY value ORDER BY count DESC, value ASC
      ) tn
      UNION ALL
      SELECT 'relationships' AS facet, value, NULL AS label, count FROM (
        SELECT value, COUNT(*)::int AS count FROM (
          SELECT DISTINCT sg."collectionId", sg."dateRaw", sg."typeSequence", relationship_name AS value
          FROM relationship_facet_groups sg
          CROSS JOIN LATERAL UNNEST(COALESCE(sg.relationships, ARRAY[]::text[])) AS relationship_name
          WHERE relationship_name IS NOT NULL AND relationship_name <> ''
        ) gr GROUP BY value ORDER BY count DESC, value ASC
      ) r
  `;
}
