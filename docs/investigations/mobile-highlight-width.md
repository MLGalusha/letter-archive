# Mobile collection highlight width

Release inspected: b1f3e6ed (#209). Reproduced on the public Collection 012 page at 390px: the content lane was 358px wide, but the highlight frame and card were only 102px. Collection 009's lane and highlights were both 358px.

The trigger is an absent `.cd-people-col`, which happens when the collection has neither correspondents nor description/notes. It is not missing text inside the image card. The no-sidebar CSS subtracts 240px and a 1rem gap to preserve the desktop highlight column. Reusing `.cd-highlights-col` for the carousel exposed that desktop cap on mobile. The existing 860px single-column breakpoint did not remove it.

The fix scopes the absent-sidebar layout rules to desktop widths above 860px. The collection section owns the available lane; the carousel still owns clipping and scrolling. No card dimensions, image cropping, or gesture code changes are needed.

Live-data local checks for Collections 012 and 009 at widths 320, 390, 430, 640, 768, 860, 861, and 1280 passed: mobile cards fill the lane; tablet highlight groups fill the lane; desktop column dimensions remain unchanged; no document horizontal overflow. At 390px the corrected Collection 012 card is 358px wide. Screenshots were visually inspected. This is browser verification, not a physical iPhone acceptance check.

The existing Chromium/WebKit geometry regression fixture now explicitly omits notes and verifies that the People panel is absent and both frame/card fill the collection lane. Previous fixtures included collection notes, inadvertently exercising only the sidebar-present branch.
