# Residual-line word selection

This crop was discovered after candidate-owned ink was erased from the page. The
left panel is the original context. The right panel contains only remaining clean
ink. Select every complete visible residual word belonging to the target line in
reading order.

Return one approximate center point per word. Exact stroke clicking is unnecessary:
software will divide the line at midpoints between your ordered centers and collect
all residual ink in each resulting word region. Do not transcribe, label, or select
neighboring context rows. Do not turn isolated noise or partial leftover strokes
from an already handled word into a new word.

Every `proposal_ids` array is empty because this is proposal-independent recovery.
Coordinates are integer pixels in the right residual panel content, origin at its
top-left. Return only strict JSON.
