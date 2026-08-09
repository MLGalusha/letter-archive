#!/usr/bin/env python3
"""Compare local ink recovery under increasingly generous anchor boxes."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels
from word_envelope.local_ink_recovery import recover_local_ink_candidates


PAPER = (251, 247, 238)
RED = (201, 55, 48)
GREEN = (24, 151, 75)


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def binary(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L")) > 0


def font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def find_packet(run: Path, unit_id: str) -> tuple[Path, dict]:
    for path in sorted((run / "packets").glob("*/work-packet.json")):
        packet = read(path)
        if packet.get("current", {}).get("unit_id") == unit_id:
            return path, packet
    raise SystemExit(f"No frozen packet for {unit_id}")


def fit(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    item = image.copy()
    item.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, PAPER)
    canvas.paste(item, ((size[0]-item.width)//2, (size[1]-item.height)//2))
    return canvas


def overlay(selectable: np.ndarray, candidate: np.ndarray) -> Image.Image:
    rgb = np.full((*selectable.shape, 3), PAPER, dtype=np.uint8)
    rgb[selectable] = RED
    rgb[candidate] = GREEN
    return Image.fromarray(rgb, mode="RGB")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--unit-id", required=True)
    parser.add_argument("--clean-mask", type=Path, required=True)
    parser.add_argument("--maximum-mask", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--padding-fractions", default="0.0,0.2,0.45,0.75")
    args = parser.parse_args()
    if args.output_dir.exists():
        raise SystemExit("Output exists; refusing overwrite")
    fractions = [float(value) for value in args.padding_fractions.split(",")]
    if len(fractions) != 4 or any(value < 0 or value > 1.5 for value in fractions):
        raise SystemExit("Supply four padding fractions between 0 and 1.5")

    manifest = read(args.run_dir / "run-manifest.json")
    packet_path, packet = find_packet(args.run_dir, args.unit_id)
    source_path = Path(manifest["input_bindings"]["source"]["path"])
    source_image = Image.open(source_path).convert("RGB")
    source = np.asarray(source_image, dtype=np.uint8)
    clean = binary(args.clean_mask)
    maximum = binary(args.maximum_mask)
    revision = int(packet["revision"])
    checkpoint = read(args.run_dir / "commits" / f"{revision:06d}" / "checkpoint.json")
    claimed = binary(args.run_dir / checkpoint["state"]["global_claimed_mask"]["path"])
    tx,ty,tw,th = packet["current"]["active_target_bbox_source_xywh"]
    wx,wy,ww,wh = packet["current"]["work_bbox_source_xywh"]
    crop = [wx,wy,ww,wh]
    selectable = maximum[wy:wy+wh, wx:wx+ww] & ~claimed[wy:wy+wh, wx:wx+ww]

    args.output_dir.mkdir(parents=True)
    results=[]
    images=[]
    for fraction in fractions:
        pad_x=max(8,round(tw*fraction)); pad_y=max(8,round(th*fraction))
        ax0=max(0,tx-pad_x); ay0=max(0,ty-pad_y)
        ax1=min(source_image.width,tx+tw+pad_x); ay1=min(source_image.height,ty+th+pad_y)
        anchor=np.zeros_like(clean)
        anchor[ay0:ay1,ax0:ax1]=clean[ay0:ay1,ax0:ax1] & ~claimed[ay0:ay1,ax0:ax1]
        recovered=recover_local_ink_candidates(source,anchor,claimed,crop)
        local_candidate=recovered["candidates"]["maximum_recall"]["mask"]
        # Selection remains clipped to the maximum page-level source-supported universe.
        local_candidate &= selectable
        additions=local_candidate & ~anchor[wy:wy+wh,wx:wx+ww]
        labels,count=ndimage.label(local_candidate,structure=np.ones((3,3),dtype=np.uint8))
        generous=np.zeros_like(local_candidate)
        gx0=max(0,tx-wx-round(tw*0.8)); gy0=max(0,ty-wy-round(th*0.8))
        gx1=min(ww,tx+tw-wx+round(tw*0.8)); gy1=min(wh,ty+th-wy+round(th*0.8))
        generous[gy0:gy1,gx0:gx1]=True
        outside=int(np.count_nonzero(local_candidate & ~generous))
        image=overlay(selectable,local_candidate)
        images.append(image)
        results.append({
            "padding_fraction":fraction,
            "anchor_bbox_source_xywh":[ax0,ay0,ax1-ax0,ay1-ay0],
            "anchor_pixels":int(anchor.sum()),
            "candidate_pixels":int(local_candidate.sum()),
            "recovered_pixels":int(additions.sum()),
            "candidate_component_count":int(count),
            "pixels_outside_generous_target_neighborhood":outside,
            "outside_fraction":round(outside/max(1,int(local_candidate.sum())),6),
            "candidate_pixel_sha256":sha256_mask_pixels(local_candidate),
        })

    canvas=Image.new("RGB",(1800,1180),(245,237,225)); draw=ImageDraw.Draw(canvas)
    draw.text((34,24),"RECOVERY ANCHOR SIZE EXPERIMENT",fill=(45,36,29),font=font(34))
    draw.text((34,70),f"{args.unit_id} · reference only: {packet['current']['tentative_text']}",fill=(78,67,57),font=font(21))
    draw.text((34,108),"Green = recovered word proposal · red = available ink. More green is not automatically better.",fill=(20,83,94),font=font(20))
    focus=source_image.crop((wx,wy,wx+ww,wy+wh))
    canvas.paste(fit(focus,(850,370)),(34,180)); draw.rectangle((34,180,884,550),outline=(185,170,150),width=2)
    draw.text((34,148),"Original work context",fill=(45,36,29),font=font(22))
    for index,(result,image) in enumerate(zip(results,images)):
        x0=34+index*440; y0=650; x1=x0+410; y1=1050
        draw.text((x0,y0-68),f"Anchor +{round(result['padding_fraction']*100)}%",fill=(45,36,29),font=font(22))
        draw.text((x0,y0-36),f"anchor {result['anchor_pixels']:,} · recovered {result['recovered_pixels']:,} · outside {result['outside_fraction']:.1%}",fill=(78,67,57),font=font(16))
        canvas.paste(fit(image,(x1-x0,y1-y0)),(x0,y0)); draw.rectangle((x0,y0,x1,y1),outline=(185,170,150),width=2)
    draw.text((34,1090),"Decision rule: prefer complete strokes with low foreign-line capture; do not maximize recovered-pixel count.",fill=(20,83,94),font=font(20))
    collage=args.output_dir/"anchor-comparison.jpg"; canvas.save(collage,format="JPEG",quality=95,subsampling=0,optimize=True)
    record={
        "schema_version":"recovery-anchor-size-experiment.v1",
        "unit_id":args.unit_id,
        "frozen_packet":{"path":str(packet_path),"file_sha256":sha256_file(packet_path),"work_packet_sha256":packet["work_packet_sha256"]},
        "source":{"path":str(source_path),"file_sha256":sha256_file(source_path)},
        "proposal_boxes":{key:packet["current"][key] for key in ("original_target_bbox_source_xywh","active_target_bbox_source_xywh","work_bbox_source_xywh","context_bbox_source_xywh")},
        "results":results,
        "collage":{"path":collage.name,"file_sha256":sha256_file(collage)},
        "metric_warning":"Recovered pixels and outside fraction are diagnostics, not an optimization objective. Final semantic ownership and residual completeness are independent gates.",
    }
    record["experiment_sha256"]=hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    (args.output_dir/"experiment.json").write_bytes(canonical_json_bytes(record)+b"\n")
    print(json.dumps({"output":str(args.output_dir),"results":results,"experiment_sha256":record["experiment_sha256"]},indent=2))


if __name__ == "__main__":
    main()
