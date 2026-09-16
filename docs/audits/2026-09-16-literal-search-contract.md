# Ordinary archive search contract (#88)

Ordinary search treats typed characters as data. Spaces separate terms; every distinct term must match within one permitted source text, in any order. Case is ignored, but accents and punctuation are retained. `%`, `_`, backslashes, apostrophes, quotation marks, and minus signs are literal characters. `OR` is an ordinary term. No advanced query language is advertised or parsed.

One- and two-character terms match literal substrings, including inside words (`he` can match `the`). Longer terms also match literal substrings. In sender, recipient, and location only, an alphabetic term of at least four characters can additionally match a whole word with trigram similarity at least 0.6. Punctuation-bearing terms and numeric terms never use typo matching. Transcript and date matching stay literal. This preserves the scope of the preceding field-policy change while replacing its inconsistent SQL/preview fuzzy algorithms with the same rule.

The per-result source order remains transcript, date, sender, recipient, location. All terms must be explainable by one source: a word in a transcript plus another only in a sender does not qualify. Repeated terms do not require repeated occurrences. Phrase order/adjacency improves relevance but is not required in ordinary mode. #47 will add the optional stricter contiguous-phrase mode; it is not implemented here.

Examples exercised through the actual route and a disposable PostgreSQL database:

| Input | Result behavior |
| --- | --- |
| `%`, `_`, `\` | Only a transcript containing that character matches; the character is highlighted. |
| `O'Neil`, `Anne-Marie` | Punctuation is retained in matching and highlighting. |
| `ζ`, `ζή` | One/two Unicode characters match and highlight their literal substring. |
| `red lantern` | Both `red lantern` and `lantern glowing red` match; split across separate fields does not. |
| `lantern red red` | Same eligible set as `red lantern`. |
| `Mollly` | Sender `Molly` can match and is highlighted; transcript-only `Molly` does not qualify. |
| `fox OR goose` | Requires all three literal terms; it does not mean either animal. |
| `fox -goose` | Requires the literal `-goose` term; it is not exclusion syntax. |
| `"lantern"` | Requires actual quotation marks in the source. |
| `quartz%` | Does not match a plain `quartz` source. |

Generated `--- Page 77 ---` separators are removed consistently before admission and preview generation. They do not make a search for `77` return a letter without a visible explanation. Preview highlights represent matching literal terms or eligible approximate name/place words. An excerpt may show only part of a long matching source; the match count covers merged matching spans in that selected source.

This deliberately changes accidental previous behavior: SQL wildcards, web-search operators, cross-field word combinations, and mismatched fuzzy admission/explanations are no longer preserved. It does not change structured filter semantics, publication gates, pagination, or sorting controls. No new search service, extension, migration, or index is introduced; the existing pg_trgm extension is reused.

## Verification

Run the existing backend test suite and typecheck, then opt into real SQL regression coverage:

```sh
cd backend
npm run typecheck
npm test
ARCHIVE_SEARCH_POSTGRES_TEST=1 npm test -- archive-search.postgres.test.ts
```

The SQL test owns and deletes a loopback-only disposable Docker PostgreSQL database, independent of the developer's DATABASE_URL. It checks exact result IDs, field/publication exclusions, highlight contents, and PostgreSQL/JavaScript trigram parity for repeated letters, accented names, and Japanese words. Small-catalogue route calls in this run were roughly 4–35ms; this is correctness-scale evidence, not a production latency benchmark. No browser behavior changed; the endpoint's existing preview format is preserved.

Trigram padding and word boundaries follow [PostgreSQL's pg_trgm documentation](https://www.postgresql.org/docs/current/pgtrgm.html). The similarity implementation uses intersection size divided by union size of distinct padded trigrams. PostgreSQL remains responsible for actual eligibility; SQL and JavaScript comparison fixtures guard preview parity. Search does not perform accent folding or Unicode normalization; composed and decomposed spellings are not promised equivalent.


Review follow-up: PostgreSQL now owns case normalization of both queries and source texts. The existing rows query returns an internal original-to-normalized text map, used only while building previews and never sent in the public API payload. This avoids JavaScript/PostgreSQL differences for Turkish dotted I and Greek sigma without special-casing particular letters or narrowing all non-ASCII matching. It adds internal database response bytes proportional to the selected page's allowed source texts, with no extra round trip. Database locale defines case equivalence; identity input remains searchable. Real PostgreSQL fixtures cover `İstanbul`, `istanbul`, `οσ`, and `ος` explicitly.

Generated page separators recognize the same explicit ASCII whitespace set (space, tab, CR, LF, form feed, vertical tab) in SQL and JavaScript. A lookalike separator containing NBSP remains literal source content in both, so it can still be matched and explained. This avoids locale-dependent regular-expression whitespace disagreement.

ICU review follow-up: preview offset mapping groups each Unicode base code point with its following combining marks, preserving leading mark runs separately. Unicode lowercase expansions/contractions change marks within these groups (English dotted I, Lithuanian accents, Turkish dot removal); contextual Greek sigma changes values without changing group count. SQL still owns the folded text. Matching ranges map back to the complete original base/mark span, including astral UTF-16 coordinates. This is a lowercase-specific mapping, not general case folding or a full grapheme algorithm. An unexpected group-count mismatch safely omits highlights instead of returning incorrect coordinates or throwing.

Both strings are scanned once with Unicode regular expressions, retaining only group indices/lengths and output offsets. A 35k-character repeated-expansion transcript is a regression fixture. An initial `Intl.Segmenter` prototype was rejected after a Node20 cost check exposed copied-input allocations and an out-of-memory failure at 30k characters; it is not used in the implementation.

To exercise the actual route with ICU English as the database default, run:

```sh
ARCHIVE_SEARCH_POSTGRES_TEST=1 ARCHIVE_SEARCH_POSTGRES_ICU=1 npm test -- archive-search.postgres.test.ts archive-search-matching.test.ts
```

The fixture asserts the actual database mapping before testing highlights at and after the expansion. Both database modes also check explicit Lithuanian and Turkish ICU collations, including expansion/contraction and trailing matches. Casing equivalence intentionally follows the active database locale, so English ICU `İstanbul` matches itself but does not match unaccented `istanbul`.

A bounded local Node20.20.1 probe of the final mapping with 1k/10k/30k/100k repeated dotted-I characters took approximately 3/7/14/54ms and returned correct trailing offsets. These are single-run implementation-cost checks, not production latency measurements.

Fuzzy review follow-up: eligibility is checked against each original typed term, before database lowercase can introduce combining marks. Preview terms preserve their original positions, including repeats and case variants, so a literal-only term cannot inherit another term's fuzzy permission. Trigram comparison follows PostgreSQL by splitting normalized input at non-alphanumeric characters and unioning each word's separately padded trigrams. Real ICU fixtures cover the expanded query, repeated/mixed terms, the stricter metadata source, and literal-only exclusions; the ordinary search contract and SQL admission are unchanged.
