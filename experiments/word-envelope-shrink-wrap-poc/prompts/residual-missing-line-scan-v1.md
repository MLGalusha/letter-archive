# Residual missing-line scan

The page has already received a candidate word pass. The left panel shows the
original with candidate-owned ink faded and remaining clean ink red. The right
panel shows only that remaining clean ink.

Find coherent residual text lines containing complete visible words that the
candidate pass clearly missed. Return one approximate rectangle per missing line.
Do not transcribe. Do not create one region per tiny dot, detached fragment, fold,
rule, or leftover stroke from a mostly handled word. Small uncertain remnants can
remain for the later residual-fragment audit.

Use the visible direction of each line, including diagonal writing. Rectangles use
integer coordinates in the 900 x 1200 right residual panel, with origin at its
top-left. Return only the strict JSON response.
