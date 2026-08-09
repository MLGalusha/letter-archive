#!/usr/bin/env python3
"""Stage 1 semantic page pass, derived from visible source context only.

Unlike stage 0, this pass has an agent-supplied reading stream and line text.
It never draws a final polygon: each word uses a deterministic interval cut of
the regional ink mask, then the standard soft-union envelope.  A transcript is
explicitly unreadable only where the image itself did not support a reading.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from skimage import filters, measure

from word_envelope.engine import EnvelopeError, EnvelopeParams, wrap_envelope
from word_envelope.io_utils import sha256_file, sha256_mask_pixels, write_json

ROOT = Path("artifacts/full-page-agent-trial-v1/worker/stage-10-agent-007-final")
FONT = ImageFont.load_default()

PAGES: dict[str, dict[str, Any]] = {
    "007-p02": {
        "path": "/Users/masongalusha/Workspace/projects/letter-archive/backend/storage/collections/007/19430411/L01/007-19430411-L01-02.jpg",
        "sha": "0bce0fe0b8c4a578b846bf004a36cc7774ecf7cbaeebe4f12106a1b962490312",
        "crop": [200, 250, 2600, 3650], "scale": 0.4, "profile": "blue",
        "lines": [
            ["body-01", [350, 440, 2200, 95], "you so many times. I guess"],
            ["body-02", [350, 565, 2200, 95], "by now you know that this"],
            ["body-03", [350, 690, 2200, 95], "letter won't take no for"],
            ["body-04", [350, 820, 2200, 95], "an answer sweetheart you"],
            ["body-05", [350, 995, 2200, 95], "don't realize how much I do"],
            ["body-06", [350, 1120, 2200, 95], "love you I guess from things"],
            ["body-07", [350, 1245, 2200, 95], "that I am so far away that"],
            ["body-08", [350, 1370, 2200, 95], "I will write anything but"],
            ["body-09", [350, 1495, 2200, 95], "I mean it I sure wish you"],
            ["body-10", [350, 1620, 2200, 95], "felt like I do I miss you"],
            ["body-11", [350, 1745, 2200, 95], "an awful lot trying to"],
            ["body-12", [350, 1870, 2200, 95], "say this so I will be"],
            ["body-13", [350, 1995, 2200, 95], "thinking and loving you"],
            ["body-14", [350, 2120, 2200, 95], "more each day"],
            ["closing-01", [1450, 2800, 1200, 180], "I love you always"],
            ["closing-02", [1550, 3000, 800, 140], "Fred"],
            ["postscript-ps", [390, 2700, 350, 230], "P.S."],
            ["postscript-did", [350, 2860, 550, 220], "Did"],
            ["postscript-rest", [300, 3010, 1300, 520], "[unreadable] [unreadable] [unreadable] [unreadable] [unreadable]"],
        ],
        "vertical": [],
    },
    "014-p04": {
        "path": "/Users/masongalusha/Workspace/projects/letter-archive/backend/storage/collections/014/18780127/L01/014-18780127-L01-04.jpg",
        "sha": "a52f9665c362880699636c45bd6533767c8ff46df996affd6cfca856ed2b2d69",
        "crop": [150, 40, 970, 1510], "scale": 0.8, "profile": "dark",
        "lines": [
            ["body-01", [185, 255, 900, 42], "Dearest I want you to write to me"],
            ["body-02", [185, 295, 900, 42], "as soon as you can and give"],
            ["body-03", [185, 335, 900, 42], "us all the news It does us a"],
            ["body-04", [185, 375, 900, 42], "great deal of good to get a letter"],
            ["body-05", [185, 415, 900, 42], "Tell Sammy I would be glad to"],
            ["body-06", [185, 455, 900, 42], "hear from him and give our"],
            ["body-07", [185, 495, 900, 42], "best wishes to uncle Andy"],
            ["body-08", [185, 535, 900, 42], "folks all of them Tell all [unreadable]"],
            ["body-09", [185, 575, 900, 42], "ing friends where to write to me"],
            ["body-10", [185, 615, 900, 42], "and tell them that I will gladly"],
            ["body-11", [185, 655, 900, 42], "answer their letters if they will"],
            ["body-12", [185, 695, 900, 42], "be so kind as to write"],
            ["body-13", [185, 735, 900, 42], "I write to uncle Willie for seed he"],
            ["body-14", [185, 775, 900, 42], "sent a few but not as many pump"],
            ["body-15", [185, 815, 900, 42], "kin seed as we wanted Billy Smith"],
            ["body-16", [185, 855, 900, 42], "is crazy almost for pumpkin seed"],
            ["body-17", [185, 895, 900, 42], "and don't let them here I wish"],
            ["body-18", [185, 935, 900, 42], "you would send a large package"],
            ["body-19", [185, 975, 900, 42], "as can be sent by mail if you"],
            ["body-20", [185, 1015, 900, 42], "please immediately if there is"],
            ["body-21", [185, 1055, 900, 42], "extra postage send pay it"],
            ["body-22", [185, 1095, 900, 42], "here We want them just as soon as"],
            ["body-23", [185, 1135, 900, 42], "they can be sent"],
            ["lower-01", [185, 1190, 900, 55], "Write soon Write much"],
            ["signature-01", [180, 1280, 400, 180], "[unreadable]"],
            ["signature-02", [570, 1280, 500, 220], "[unreadable] [unreadable]"],
        ],
        "vertical": [["top-we-will", [200, 45, 95, 220], "We will"]],
    },
}


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _ink(image: Image.Image, profile: str) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"), dtype=float)
    gray = np.asarray(image.convert("L"), dtype=float) / 255.0
    if profile == "blue":
        value = ((rgb[:, :, 2] - rgb[:, :, 0]) > 6) & (gray < .78)
    else:
        # Stage 0's broad adaptive mask joined paper texture/folds across 014.
        # This conservative local darkness gate loses faint marks to review rather
        # than treating the paper as a word-sized component.
        local = filters.threshold_sauvola(gray, window_size=41, k=.17)
        value = (gray < local) & (gray < .57)
    return ndimage.binary_opening(value, structure=np.ones((1, 1)))


AGENT_BOUNDARY_OVERRIDES: dict[tuple[str, str], list[int]] = {
    # Bounded Stage 2 visual probe: page-context x=732 is the selected zero-ink
    # semantic separator between the capital I and `guess`.  The first four
    # separators were already visually aligned in the Stage 3 checkpoint.
    ("007-p02", "body-01"): [158, 243, 429, 603, 672],
}


def _boundaries(mask: np.ndarray, words: list[str], axis: int) -> tuple[list[int], list[int]]:
    count = len(words)
    length = mask.shape[1] if axis == 1 else mask.shape[0]
    density = mask.sum(axis=0 if axis == 1 else 1).astype(float)
    smooth = ndimage.gaussian_filter1d(density, sigma=1.5)
    active = np.flatnonzero(density > 0)
    if active.size < 2:
        return [0, *[round(length * slot / count) for slot in range(1, count)], length], list(range(1, count))
    active_left, active_right = int(active.min()), int(active.max()) + 1
    low = smooth <= max(0.5, np.percentile(smooth, 26))
    runs = []
    start = None
    for index, val in enumerate(low):
        if val and start is None: start = index
        if start is not None and (not val or index == length - 1):
            end = index if not val else index + 1
            if end - start >= 2: runs.append((start, end, end - start))
            start = None
    candidates = [(width, (left + right)//2) for left, right, width in runs if active_left + 2 < (left + right)//2 < active_right - 2]
    # The transcript supplies semantic order, not box widths.  Each expected word
    # break searches a local visual valley; character span is only a tie-breaker
    # for which nearby valley belongs to that semantic break.
    weights = [max(1, len(word.replace("[unreadable]", "xxxx"))) + 1 for word in words]
    total = sum(weights)
    ideals = [round(active_left + (active_right-active_left) * sum(weights[:slot]) / total) for slot in range(1, count)]
    cuts: list[int] = []
    forced: list[int] = []
    min_gap = max(5, length // max(count * 4, 1))
    for slot, ideal in enumerate(ideals):
        lower = (cuts[-1] + min_gap) if cuts else active_left + min_gap
        remaining = len(ideals) - slot
        upper = active_right - remaining * min_gap
        ideal = min(max(ideal, lower), upper)
        window = max(16, round(length * .13))
        nearby = [(width, pos) for width, pos in candidates if lower <= pos <= upper and abs(pos - ideal) <= window]
        if nearby:
            # Prefer an actual blank/low-ink valley; then closeness to semantic
            # position. This avoids proportional-box fallback behavior.
            _, chosen = max(nearby, key=lambda row: (row[0] * 8 - abs(row[1] - ideal), -abs(row[1] - ideal)))
        else:
            local_positions = range(max(lower, ideal-window), min(upper, ideal+window)+1)
            chosen = (
                min(local_positions, key=lambda pos: (smooth[pos], abs(pos-ideal)))
                if local_positions.start <= local_positions.stop - 1
                else ideal
            )
            forced.append(chosen)
        cuts.append(chosen)
    cuts = sorted(cuts)
    return [0, *cuts, length], forced


def _page_image(page: dict[str, Any]) -> Image.Image:
    if sha256_file(Path(page["path"])) != page["sha"]: raise RuntimeError("source drift")
    x, y, w, h = page["crop"]
    with Image.open(page["path"]) as im: source = im.convert("RGB").crop((x, y, x+w, y+h))
    return source.resize((round(w*page["scale"]), round(h*page["scale"])), Image.Resampling.LANCZOS)


def _tokenize_line(page_id: str, image: Image.Image, ink: np.ndarray, page: dict[str, Any], spec: list[Any], vertical: bool, order: int) -> list[dict[str, Any]]:
    stream, box, text = spec
    words = text.split(); sx, sy, sw, sh = page["crop"]; scale = page["scale"]
    x, y, w, h = [round((value - origin) * scale) for value, origin in zip(box, (sx, sy, 0, 0))]
    # Width/height are not origin translated.
    w, h = round(box[2]*scale), round(box[3]*scale)
    x, y = max(0,x), max(0,y); x2, y2 = min(image.width,x+w), min(image.height,y+h)
    # Boundaries are discovered in the narrow line band, while ownership is
    # evaluated in a larger vertical context.  This preserves an ascender or a
    # descender that crosses the nominal baseline without admitting an unrelated
    # neighboring-line component.
    base_top, base_bottom = y, y2
    local = ink[base_top:base_bottom, x:x2]
    axis = 0 if vertical else 1
    boundaries, forced = _boundaries(local, words, axis)
    override = AGENT_BOUNDARY_OVERRIDES.get((page_id, stream)) if not vertical else None
    if override is not None:
        if len(override) != len(words) - 1:
            raise RuntimeError(f"Bad agent boundary override for {stream}")
        boundaries = [0, *override, local.shape[1]]
    tokens = []
    for idx, word in enumerate(words):
        if vertical:
            left, right, top, bottom = x, x2, y+boundaries[idx], y+boundaries[idx+1]
            context_left, context_right = max(0, left-25), min(image.width, right+25)
            core = ink[top:bottom, context_left:context_right]
            local_labels = measure.label(core, connectivity=2)
            owned_core = local_labels > 0
            left, right = context_left, context_right
        else:
            left, right = x+boundaries[idx], x+boundaries[idx+1]
            # The line bands are already separated at roughly half the adjacent
            # baselines.  Five pixels permits local ascenders/descenders but can
            # never absorb the next writing line through a fold/cursive bridge.
            context_top, context_bottom = max(0, base_top-5), min(image.height, base_bottom+5)
            core = ink[context_top:context_bottom, left:right]
            local_labels = measure.label(core, connectivity=2)
            seed_ids = {int(value) for value in np.unique(local_labels[base_top-context_top:base_bottom-context_top, :]) if value}
            owned_core = np.isin(local_labels, sorted(seed_ids))
            top, bottom = context_top, context_bottom
        pad = 3
        left, top, right, bottom = max(0,left-pad), max(0,top-pad), min(image.width,right+pad), min(image.height,bottom+pad)
        # Keep the semantic cut exact, but place it in a padded zero context for
        # the envelope operation.  This prevents a correct ascender on a line
        # edge from being rejected merely because the context crop was tight.
        envelope_pad = 10
        owned = np.pad(owned_core, envelope_pad)
        flags = ["agent_semantic_transcript"] if word != "[unreadable]" else ["localized_unreadable"]
        cut = boundaries[idx+1] if idx + 1 < len(words) else None
        if cut in forced: flags.append("forced_gap_cut_review_required")
        if int(owned.sum()) < 14: flags.append("low_ink_support_review_required")
        envelope = None; error = None; poly = None
        try:
            result = wrap_envelope(owned, EnvelopeParams(angle_degrees=90 if vertical else 0, along_bridge_px=7, cross_bridge_px=3, padding_px=2, smooth_iterations=1, simplify_tolerance_px=.6, soft_threshold=.2, maximum_envelope_fraction=.95, maximum_envelope_to_ink_area_ratio=40, maximum_excluded_contamination=1, maximum_excluded_component_contamination=1), method="soft_union", rough_box=(0,0,float(owned.shape[1]),float(owned.shape[0])))
            envelope = result.as_record(); poly = [[round(sx+(left-envelope_pad+px)/scale,2),round(sy+(top-envelope_pad+py)/scale,2)] for px,py in result.polygon]
        except EnvelopeError as exc:
            error = str(exc); flags.append("envelope_failed_review_required")
        if owned_core.any():
            ys, xs = np.nonzero(owned_core)
            ink_left, ink_top = left + int(xs.min()), top + int(ys.min())
            ink_right, ink_bottom = left + int(xs.max()) + 1, top + int(ys.max()) + 1
            # Report the tight source bbox derived from owned ink, padded only
            # enough to make it readable.  The interval context stays in history.
            source_box = [round(sx+(ink_left-2)/scale), round(sy+(ink_top-2)/scale), round((ink_right-ink_left+4)/scale), round((ink_bottom-ink_top+4)/scale)]
        else:
            source_box = None
            flags.append("empty_mask_deferred_no_box")
        stream_id = (
            "postscript-island" if stream.startswith("postscript") else
            "closing" if stream.startswith("closing") else
            "top-margin" if stream.startswith("top-") else
            "signatures" if stream.startswith("signature") else
            "lower-body" if stream.startswith("lower-") else "main-body"
        )
        orientation = "vertical" if vertical else ("oblique" if stream.startswith("postscript") else "horizontal")
        tokens.append({"id":f"{page_id}-{stream}-{idx+1:02d}","transcript":word,"stream_id":stream_id,"line_island_id":stream,"reading_orientation":orientation,"reading_order":order+idx,"source_axis_aligned_bbox_xywh":source_box,"source_envelope_polygon":poly,"owned_ink_pixel_sha256":sha256_mask_pixels(owned),"owned_ink_pixels":int(owned_core.sum()),"flags":flags,"confidence":.82 if word != "[unreadable]" and cut not in forced else .42,"action_history":[{"type":"regional_context_claim","stream_id":stream_id,"line_island_id":stream,"source_line_box_xywh":box},{"type":"semantic_boundary_partition","axis":"y" if vertical else "x","at_processing_px":cut,"forced":cut in forced,"agent_override":override is not None,"removed_ink_pixels":0} if cut is not None else {"type":"final_interval_claim"}],"envelope":envelope,"envelope_error":error,"processing_box_xywh":[left,top,right-left,bottom-top]})
    return tokens


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    log = Path("artifacts/full-page-agent-trial-v1/worker/worker-log.md")
    pages_out=[]
    # This checkpoint intentionally stops after 007's main page.  014 is only
    # expanded after visual inspection validates that boxes follow owned ink.
    for page_id in ("007-p02",):
        page = PAGES[page_id]
        out=ROOT/page_id
        if out.exists(): raise RuntimeError(f"Refusing overwrite {out}")
        out.mkdir(parents=True); image=_page_image(page); ink=_ink(image,page["profile"]); image.save(out/"page-context.jpg",quality=90)
        tokens=[]; order=1
        for spec in page["lines"]:
            vals=_tokenize_line(page_id,image,ink,page,spec,False,order); tokens.extend(vals); order+=len(vals)
        for spec in page["vertical"]:
            vals=_tokenize_line(page_id,image,ink,page,spec,True,order); tokens.extend(vals); order+=len(vals)
        preview=image.copy(); draw=ImageDraw.Draw(preview)
        for token in tokens:
            x,y,w,h=token["processing_box_xywh"]; color=(230,45,45) if "envelope_failed_review_required" in token["flags"] else (245,145,20) if "forced_gap_cut_review_required" in token["flags"] else (0,170,220)
            draw.rectangle((x,y,x+w,y+h),outline=color,width=1); draw.text((x,max(0,y-9)),str(token["reading_order"]),fill=color,font=FONT,stroke_width=1,stroke_fill=(255,255,255))
        preview.save(out/"semantic-numbered-boxes.jpg",quality=90)
        labels=measure.label(ink,connectivity=2)
        shared=[]
        for region in measure.regionprops(labels):
            if region.area > ink.size*.1:
                top,left,bottom,right=region.bbox
                shared.append({"classification":"fold_background_or_shared_ink_review_required","processing_bbox_xywh":[left,top,right-left,bottom-top],"area_px":int(region.area)})
        streams={stream: [token["id"] for token in tokens if token["stream_id"]==stream] for stream in sorted({token["stream_id"] for token in tokens})}
        write_json(out/"residual-and-shared-ink-audit.json",{"schema_version":"word-envelope-stage-2-residual-audit.v1","page_id":page_id,"stream_token_ids":streams,"shared_ink_components":shared,"rule":"A page-spanning or fold-like component is never claimed as a word; it remains an explicit shared-ink review item."})
        unresolved=[{"id":token["id"],"reason":"unreadable" if token["transcript"]=="[unreadable]" else "envelope_or_segmentation_review","flags":token["flags"]} for token in tokens if token["transcript"]=="[unreadable]" or token["envelope"] is None]
        write_json(out/"unresolved-tokens.json",{"schema_version":"word-envelope-unresolved-tokens.v1","page_id":page_id,"unresolved_tokens":unresolved,"rule":"Nonempty semantic selections with disconnected glyphs remain usable boxes but require adaptive-envelope or human review before acceptance."})
        record={"schema_version":"word-envelope-full-page-agent-stage-10.v1","page_id":page_id,"source":{"path":page["path"],"sha256":page["sha"],"copy_created":False},"line_registration_reference":"../stage-7-line-registration/frozen-lines.json","stage_0_reference":"../../007-p02/page-record.json or ../../014-p04/page-record.json","prior_stage_references":["../stage-1-agent (superseded draft; retained unchanged)","../stage-2-agent-corrected (checkpoint; retained unchanged)","../stage-3-agent-expanded-support (checkpoint; retained unchanged)","../stage-4-agent-line-reviewed (checkpoint; retained unchanged)","../stage-5-agent-active-ink (checkpoint; retained unchanged)","../stage-6-agent-baseline-corrected (checkpoint; retained unchanged)","../stage-8-agent-unique-boundaries (incomplete run; retained unchanged)","../stage-9-agent-unique-boundaries (checkpoint; retained unchanged)"],"method":"Final 007 agent pass: frozen reading-stream line registration + visual valley search constrained to distinct active-ink boundaries; explicit semantic boundary partitions; selected local connected-ink support; soft-union envelope. Fold/background components stay unclaimed.","token_count":len(tokens),"shared_ink_audit":"residual-and-shared-ink-audit.json","unresolved_token_audit":"unresolved-tokens.json","tokens":tokens}
        record["record_sha256"]=_hash(record); write_json(out/"semantic-page-record.json",record); pages_out.append({"page_id":page_id,"token_count":len(tokens),"record_sha256":record["record_sha256"],"forced_cut_count":sum("forced_gap_cut_review_required" in t["flags"] for t in tokens),"envelope_failure_count":sum(t["envelope"] is None for t in tokens)})
        with log.open("a") as f: f.write(f"[stage-10 {page_id}] final 007 agent pass tokens={len(tokens)} forced_cuts={pages_out[-1]['forced_cut_count']} envelope_failures={pages_out[-1]['envelope_failure_count']} unresolved={len(unresolved)} record_sha256={record['record_sha256']}\n")
    summary={"schema_version":"word-envelope-full-page-agent-stage-10.v1","stage":"final-007-agent-semantic-pass","uses_stage_0_only_as_candidate_discovery":True,"prior_stages_retained_not_overwritten":True,"pages":pages_out}; summary["summary_sha256"]=_hash(summary);write_json(ROOT/"summary.json",summary)
    with log.open("a") as f: f.write(f"[stage-10] summary_sha256={summary['summary_sha256']}\n")

if __name__ == "__main__": main()
