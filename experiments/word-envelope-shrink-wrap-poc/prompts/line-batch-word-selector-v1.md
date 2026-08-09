# Line-batch visible-word selection

Select every complete visible word in this one crop in reading order. This is an
ink-ownership task, not a transcription task.

The supplied reference words and software boxes are fallible navigation hints.
They may be wrong, duplicated, missing, too broad, or clipped. Never select only
the letters that happen to match a hint. If the hint says `now` but the visible
word is `how`, select all of visible `how`.

For each visible word, place one tiny seed point on every disconnected clean-ink
piece needed to own the complete word. One point is enough when the entire word
is connected. Use additional points for detached dots, punctuation, or fragmented
letters that belong to the word. Do not seed neighboring words, folds, rules, or
noise. Do not draw fitted boxes; software will grow each seed to its full connected
component and fit the final envelope later.

Return all visible words in the crop in one response. A word may loosely cite zero,
one, or several proposal IDs. Proposal IDs are only locators. Do not omit a visible
word merely because no proposal or reference token exists for it. Do not invent a
word merely because a proposal exists.

Coordinates are integer pixels in the clean-ink panel content, with origin at its
top-left. Return only the strict JSON response.
