from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageDraw

from word_envelope.engine import EnvelopeError
from word_envelope.io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels
from word_envelope.sequential_ownership import (
    apply_compact_action,
    init_run as ownership_init,
    next_packet as ownership_next,
    requeue_review,
)
from word_envelope.sequential_residual_audit import ACTION_SCHEMA_VERSION, apply_action, init_run, next_packet, status


def legacy(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def canonical(value: object) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def owner_with_residual(root: Path, *, defer_owner: bool = False, commit: bool = True,
                        reopen_owner: bool = False) -> tuple[Path, np.ndarray]:
    source = root / "source.png"; image = Image.new("RGB", (100, 80), "#eee4d0"); draw = ImageDraw.Draw(image)
    # A claimed visible word, a detached fragment, an omitted visible word, and
    # a component safely outside every line.
    for box in ((15, 25, 24, 31), (34, 28, 37, 31), (49, 25, 58, 31), (3, 68, 5, 70)):
        draw.rectangle(box, fill="#111111")
    image.save(source)
    mask = np.zeros((80, 100), dtype=bool)
    mask[25:32, 15:25] = True; mask[28:32, 34:38] = True; mask[25:32, 49:59] = True; mask[68:71, 3:6] = True
    knockout = root / "knockout"; mask_path = knockout / "masks/ink-proposal.png"; mask_path.parent.mkdir(parents=True)
    Image.fromarray(mask.astype(np.uint8) * 255).save(mask_path)
    packet = {"schema_version":"synthetic.v1", "page_id":"synthetic-p01", "source":{"path":str(source),"sha256":sha256_file(source),"size":[100,80]},"lines":[]}
    packet["packet_sha256"] = legacy(packet); packet_path=root/"packet.json"; write(packet_path,packet)
    decision={"schema_version":"synthetic-pass1.v1","page_id":"synthetic-p01","source_sha256":sha256_file(source),"public_packet_sha256":sha256_file(packet_path),"lines":[{"line_id":"line-1","line_reading_order":1,"upright_rotation_degrees":0,"directed_reading":"left_to_right","visible_units":[{"unit_id":"U1","reading_order":1,"bbox_source_xywh":[10,20,55,20],"tentative_text":"known","unit_kind":"word","ownership_route":"terra_box_mask","risk_flags":["none"]}]}]}
    decision_path=root/"decision.json"; write(decision_path,decision)
    manifest={"schema_version":"full-page-ownership-knockout-manifest.v2","page_id":"synthetic-p01","inputs":{"decision":{"file_sha256":sha256_file(decision_path)},"public_packet":{"file_sha256":sha256_file(packet_path)},"source":{"file_sha256":sha256_file(source),"size":[100,80]},"ink_proposal_pixel_sha256":sha256_mask_pixels(mask)},"outputs":[{"path":"masks/ink-proposal.png","file_sha256":sha256_file(mask_path)}]}
    manifest["manifest_sha256"] = legacy(manifest); manifest_path=knockout/"manifest.json"; write(manifest_path,manifest)
    run=root/"owner"; ownership_init(pass1_decision_path=decision_path, knockout_manifest_path=manifest_path, public_packet_path=packet_path, run_dir=run, work_padding_px=2, context_padding_px=5)
    packet1=ownership_next(run)
    if reopen_owner:
        apply_compact_action(run, {
            "schema_version":"sequential-full-page-ownership-compact-action.v1",
            "work_packet_sha256":packet1["work_packet_sha256"],
            "action":{
                "type":"reopen_bbox", "bbox_source_xywh":[10,20,20,20],
                "confidence":"high", "reason_codes":["clipped_target"],
            },
        })
        packet1=ownership_next(run)
    action={"schema_version":"sequential-full-page-ownership-compact-action.v1","work_packet_sha256":packet1["work_packet_sha256"],"action":{"type":"defer_manual","disposition":"touching_or_overwritten_ink","confidence":"low","reason_codes":["touching_words"]}} if defer_owner else {"schema_version":"sequential-full-page-ownership-compact-action.v1","work_packet_sha256":packet1["work_packet_sha256"],"action":{"type":"claim_select","component_ids":[1],"confidence":"high","reason_codes":["same_word_body"]}}
    if commit:
        apply_compact_action(run,action)
    return run, mask


def envelope(packet: dict, dispositions: list[dict]) -> dict:
    return {"schema_version":ACTION_SCHEMA_VERSION,"packet_sha256":packet["packet_sha256"],"dispositions":dispositions}


def rehash_checkpoint(checkpoint: dict, run_manifest_sha256: str) -> None:
    checkpoint["state_sha256"] = canonical(checkpoint["state"])
    checkpoint["ledger_sha256"] = canonical({
        "run_manifest_sha256": run_manifest_sha256,
        "revision": checkpoint["revision"],
        "parent_ledger_sha256": checkpoint["parent_ledger_sha256"],
        "event_sha256": checkpoint["event_sha256"],
        "state_sha256": checkpoint["state_sha256"],
    })
    checkpoint["checkpoint_sha256"] = canonical({key: value for key, value in checkpoint.items()
                                               if key != "checkpoint_sha256"})


def rehash_owner_chain(run: Path) -> None:
    manifest=json.loads((run/"run-manifest.json").read_text())
    parent_checkpoint=parent_ledger=None
    commits=sorted(path for path in (run/"commits").iterdir() if path.is_dir())
    for revision, commit in enumerate(commits):
        checkpoint_path=commit/"checkpoint.json"
        checkpoint=json.loads(checkpoint_path.read_text())
        checkpoint["parent_checkpoint_sha256"]=parent_checkpoint
        checkpoint["parent_ledger_sha256"]=parent_ledger
        if revision:
            event_path=commit/"event.json"
            event=json.loads(event_path.read_text())
            event["base_checkpoint_sha256"]=parent_checkpoint
            event["base_ledger_sha256"]=parent_ledger
            event["event_sha256"]=canonical({key:value for key,value in event.items()
                                               if key!="event_sha256"})
            write(event_path,event)
            checkpoint["event_sha256"]=event["event_sha256"]
        rehash_checkpoint(checkpoint,manifest["run_manifest_sha256"])
        write(checkpoint_path,checkpoint)
        parent_checkpoint=checkpoint["checkpoint_sha256"]
        parent_ledger=checkpoint["ledger_sha256"]


def owner_action(packet: dict, action: dict) -> dict:
    return {
        "schema_version":"sequential-full-page-ownership-compact-action.v1",
        "work_packet_sha256":packet["work_packet_sha256"],
        "action":action,
    }


def owner_with_review_requeue(root: Path, *, finish_sol: bool = True) -> tuple[Path, np.ndarray]:
    source=root/"review-source.png"
    image=Image.new("RGB",(120,80),"#eee4d0"); draw=ImageDraw.Draw(image)
    for box in ((10,25,19,31),(45,25,54,31),(80,25,89,31),(108,68,111,71)):
        draw.rectangle(box,fill="#111111")
    image.save(source)
    mask=np.zeros((80,120),dtype=bool)
    mask[25:32,10:20]=True; mask[25:32,45:55]=True
    mask[25:32,80:90]=True; mask[68:72,108:112]=True
    knockout=root/"review-knockout"; mask_path=knockout/"masks/ink-proposal.png"
    mask_path.parent.mkdir(parents=True)
    Image.fromarray(mask.astype(np.uint8)*255).save(mask_path)
    packet={
        "schema_version":"synthetic.v1", "page_id":"review-p01",
        "source":{"path":str(source),"sha256":sha256_file(source),"size":[120,80]},
        "lines":[],
    }
    packet["packet_sha256"]=legacy(packet); packet_path=root/"review-packet.json"; write(packet_path,packet)
    units=[
        {"unit_id":"U1","reading_order":1,"bbox_source_xywh":[5,20,25,20],"tentative_text":"one","unit_kind":"word","ownership_route":"terra_box_mask","risk_flags":["none"]},
        {"unit_id":"U2","reading_order":2,"bbox_source_xywh":[40,20,25,20],"tentative_text":"two","unit_kind":"word","ownership_route":"terra_box_mask","risk_flags":["none"]},
        {"unit_id":"U3","reading_order":3,"bbox_source_xywh":[75,20,25,20],"tentative_text":"three","unit_kind":"word","ownership_route":"terra_box_mask","risk_flags":["none"]},
    ]
    decision={
        "schema_version":"synthetic-pass1.v1", "page_id":"review-p01",
        "source_sha256":sha256_file(source), "public_packet_sha256":sha256_file(packet_path),
        "lines":[{"line_id":"line-1","line_reading_order":1,"upright_rotation_degrees":0,
                  "directed_reading":"left_to_right","visible_units":units}],
    }
    decision_path=root/"review-decision.json"; write(decision_path,decision)
    manifest={
        "schema_version":"full-page-ownership-knockout-manifest.v2", "page_id":"review-p01",
        "inputs":{
            "decision":{"file_sha256":sha256_file(decision_path)},
            "public_packet":{"file_sha256":sha256_file(packet_path)},
            "source":{"file_sha256":sha256_file(source),"size":[120,80]},
            "ink_proposal_pixel_sha256":sha256_mask_pixels(mask),
        },
        "outputs":[{"path":"masks/ink-proposal.png","file_sha256":sha256_file(mask_path)}],
    }
    manifest["manifest_sha256"]=legacy(manifest); manifest_path=knockout/"manifest.json"; write(manifest_path,manifest)
    run=root/"review-owner"
    ownership_init(
        pass1_decision_path=decision_path, knockout_manifest_path=manifest_path,
        public_packet_path=packet_path, run_dir=run,
        work_padding_px=2, context_padding_px=5,
    )

    first=ownership_next(run)
    apply_compact_action(run,owner_action(first,{
        "type":"reopen_bbox", "bbox_source_xywh":[8,20,20,20],
        "confidence":"high", "reason_codes":["clipped_target"],
    }))
    apply_compact_action(run,owner_action(ownership_next(run),{
        "type":"claim_select","component_ids":[1],"confidence":"high",
        "reason_codes":["same_word_body"],
    }))
    apply_compact_action(run,owner_action(ownership_next(run),{
        "type":"defer_tier","target":"sol",
        "reason":"agent_discovered_nonroutine_complexity",
    }))
    apply_compact_action(run,owner_action(ownership_next(run),{
        "type":"defer_manual","disposition":"touching_or_overwritten_ink",
        "confidence":"low","reason_codes":["touching_words"],
    }))
    requeue_review(run,target="sol",unit_ids=["U3"])
    if finish_sol:
        apply_compact_action(run,owner_action(ownership_next(run),{
            "type":"claim_select","component_ids":[1],"confidence":"high",
            "reason_codes":["same_word_body"],
        }))
        apply_compact_action(run,owner_action(ownership_next(run),{
            "type":"claim_select","component_ids":[1],"confidence":"high",
            "reason_codes":["same_word_body"],
        }))
    return run,mask


class FreshResidualAuditTests(unittest.TestCase):
    def test_omitted_word_and_fragment_are_exhaustively_recorded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            owner, _ = owner_with_residual(Path(directory)); audit=Path(directory)/"audit"; init_run(ownership_run=owner,audit_dir=audit)
            first=next_packet(audit); self.assertEqual(first,next_packet(audit))
            ids=first["region"]["component_ids"]
            # The first line region contains the detached fragment and omitted word.
            self.assertGreaterEqual(len(ids),2)
            components=first["components"]; ordered=sorted(components,key=lambda c:c["bbox"]["x"])
            apply_action(audit,envelope(first,[
                {"type":"attach_existing_unit","component_ids":[ordered[0]["id"]],"unit_id":"U1"},
                {"type":"new_missing_word","component_ids":[ordered[1]["id"]],"new_word_id":"missing-001","bbox_source_xywh":[49,25,10,7],"text_guess":"omitted","route":"human_or_model_followup"},
            ]))
            second=next_packet(audit)
            apply_action(audit,envelope(second,[{"type":"noise_or_fold","component_ids":second["region"]["component_ids"]}]))
            result=status(audit); self.assertEqual(result["machine_status"],"complete"); self.assertEqual(result["production_status"],"ready")
            self.assertEqual(result["progress"]["terminal_components"],result["progress"]["total_components"])

    def test_duplicate_accounting_stale_action_and_exact_equation_are_rejected_or_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            owner, mask=owner_with_residual(Path(directory)); audit=Path(directory)/"audit"; init_run(ownership_run=owner,audit_dir=audit)
            packet=next_packet(audit); ids=packet["region"]["component_ids"]
            duplicate=envelope(packet,[{"type":"noise_or_fold","component_ids":ids},{"type":"punctuation_or_nonword","component_ids":[ids[0]]}])
            with self.assertRaisesRegex(EnvelopeError,"exactly once"): apply_action(audit,duplicate)
            action=envelope(packet,[{"type":"noise_or_fold","component_ids":ids}]); apply_action(audit,action)
            with self.assertRaisesRegex(EnvelopeError,"stale"): apply_action(audit,action)
            head=json.loads((owner/"commits/000001/checkpoint.json").read_text()); claimed=np.asarray(Image.open(owner/head["state"]["global_claimed_mask"]["path"]))>0
            residual=np.asarray(Image.open(audit/"commits/000000/fresh-residual-input.png"))>0
            self.assertTrue(np.array_equal(residual, mask & ~claimed))

    def test_outside_line_human_block_and_resume_are_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,_=owner_with_residual(root, defer_owner=True); audit=root/"audit"; init_run(ownership_run=owner,audit_dir=audit)
            seen=[]
            while status(audit)["machine_status"] != "complete":
                packet=next_packet(audit); seen.append(packet["region"]["kind"])
                apply_action(audit,envelope(packet,[{"type":"defer_human","component_ids":packet["region"]["component_ids"],"reason":"needs reading"}]))
            self.assertIn("outside_line_cluster",seen); self.assertEqual(status(audit)["production_status"],"blocked_human_review")
            self.assertTrue(any(item.startswith("manual_ownership:") for item in status(audit)["production_blockers"]))
            # Loading after all commits gives the same stable final state rather than replaying work.
            final=status(audit); self.assertEqual(final,status(audit))

    def test_unfinished_ownership_is_rejected_before_audit_initialization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            owner, _ = owner_with_residual(Path(directory), commit=False)
            with self.assertRaisesRegex(EnvelopeError, "queue is unfinished"):
                init_run(ownership_run=owner, audit_dir=Path(directory) / "audit")

    def test_real_reopen_then_claim_replays_into_exact_fresh_residual(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,mask=owner_with_residual(root,reopen_owner=True)
            head=json.loads((owner/"commits/000002/checkpoint.json").read_text())
            override=head["state"]["global_claimed_mask"]["registration_bbox_overrides"]["U1"]
            self.assertEqual(override["original_bbox_source_xywh"],[10,20,55,20])
            self.assertEqual(override["active_bbox_source_xywh"],[10,20,20,20])
            self.assertEqual(len(override["history"]),1)
            audit=root/"audit"; init_run(ownership_run=owner,audit_dir=audit)
            claimed=np.asarray(Image.open(owner/head["state"]["global_claimed_mask"]["path"]))>0
            residual=np.asarray(Image.open(audit/"commits/000000/fresh-residual-input.png"))>0
            self.assertTrue(np.array_equal(residual,mask & ~claimed))

    def test_rehashed_invalid_or_forged_reopen_replay_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,_=owner_with_residual(root,reopen_owner=True)
            event_path=owner/"commits/000001/event.json"
            event=json.loads(event_path.read_text())
            event["compact_action"]["action"]["bbox_source_xywh"]=[70,60,10,10]
            write(event_path,event); rehash_owner_chain(owner)
            with self.assertRaisesRegex(EnvelopeError,"zero normalized ink"):
                init_run(ownership_run=owner,audit_dir=root/"audit")
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,_=owner_with_residual(root,reopen_owner=True)
            event_path=owner/"commits/000001/event.json"
            event=json.loads(event_path.read_text())
            event["registration_correction"]["after_active_bbox_source_xywh"]=[11,20,20,20]
            write(event_path,event); rehash_owner_chain(owner)
            with self.assertRaisesRegex(EnvelopeError,"event provenance"):
                init_run(ownership_run=owner,audit_dir=root/"audit")

    def test_requeue_review_joins_tier_and_manual_work_then_sol_claims_and_audits(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,mask=owner_with_review_requeue(root)
            before=json.loads((owner/"commits/000004/checkpoint.json").read_text())["state"]
            review=json.loads((owner/"commits/000005/checkpoint.json").read_text())["state"]
            control=json.loads((owner/"commits/000005/event.json").read_text())["control_action"]
            self.assertEqual(control["requested_unit_ids"],["U3"])
            self.assertEqual(control["queue_unit_ids"],["U2","U3"])
            self.assertEqual([item["unit_id"] for item in review["tier_deferred_units"]],["U2","U3"])
            self.assertEqual(review["claimed_units"],before["claimed_units"])
            self.assertEqual(review["global_claimed_mask"],before["global_claimed_mask"])
            self.assertIn("U1",review["global_claimed_mask"]["registration_bbox_overrides"])
            head=json.loads((owner/"commits/000007/checkpoint.json").read_text())
            self.assertEqual([item["unit_id"] for item in head["state"]["claimed_units"]],["U1","U2","U3"])
            audit=root/"audit"; init_run(ownership_run=owner,audit_dir=audit)
            claimed=np.asarray(Image.open(owner/head["state"]["global_claimed_mask"]["path"]))>0
            residual=np.asarray(Image.open(audit/"commits/000000/fresh-residual-input.png"))>0
            self.assertTrue(np.array_equal(residual,mask & ~claimed))

    def test_rehashed_requeue_review_unknown_duplicate_noneligible_and_forged_conversions_fail(self) -> None:
        for label, mutate, message in (
            ("duplicate-request",lambda event:event["control_action"].update(
                {"requested_unit_ids":["U3","U3"]}),"requested IDs are invalid"),
            ("unknown-request",lambda event:event["control_action"].update(
                {"requested_unit_ids":["UNKNOWN"]}),"requested unknown units"),
            ("duplicate-conversion",lambda event:event["control_action"]["conversions"].append(
                dict(event["control_action"]["conversions"][0])),"conversions do not exactly replay"),
            ("unknown-conversion",lambda event:event["control_action"]["conversions"][0].update(
                {"unit_id":"UNKNOWN"}),"conversions do not exactly replay"),
            ("forged-conversion",lambda event:event["control_action"]["conversions"][0]["to"].update(
                {"reason":"forged"}),"conversions do not exactly replay"),
        ):
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); owner,_=owner_with_review_requeue(root,finish_sol=False)
                event_path=owner/"commits/000005/event.json"; event=json.loads(event_path.read_text())
                mutate(event); write(event_path,event); rehash_owner_chain(owner)
                with self.assertRaisesRegex(EnvelopeError,message):
                    init_run(ownership_run=owner,audit_dir=root/"audit")
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,_=owner_with_review_requeue(root,finish_sol=False)
            checkpoint_path=owner/"commits/000004/checkpoint.json"
            checkpoint=json.loads(checkpoint_path.read_text())
            checkpoint["state"]["deferred_units"][0]["disposition"]="ambiguous_detached_mark"
            write(checkpoint_path,checkpoint); rehash_owner_chain(owner)
            with self.assertRaisesRegex(EnvelopeError,"converted noneligible manual units"):
                init_run(ownership_run=owner,audit_dir=root/"audit")
        for label, mutate, message in (
            ("wrong-active-order",lambda event,state:(
                event["control_action"].update({"queue_unit_ids":["U3","U2"]}),
                state.update({"queue_unit_ids":["U3","U2"]}),
            ),"immutable reading order"),
            ("changed-claim-history",lambda event,state:
                state["claimed_units"][0].update({"at_revision":1}),
             "active state does not exactly replay"),
            ("changed-registration-history",lambda event,state:
                state["global_claimed_mask"]["registration_bbox_overrides"]["U1"]["history"][0].update(
                    {"confidence":"medium"}),
             "changed claims or registration history"),
        ):
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); owner,_=owner_with_review_requeue(root,finish_sol=False)
                event_path=owner/"commits/000005/event.json"
                checkpoint_path=owner/"commits/000005/checkpoint.json"
                event=json.loads(event_path.read_text()); checkpoint=json.loads(checkpoint_path.read_text())
                mutate(event,checkpoint["state"])
                write(event_path,event); write(checkpoint_path,checkpoint); rehash_owner_chain(owner)
                with self.assertRaisesRegex(EnvelopeError,message):
                    init_run(ownership_run=owner,audit_dir=root/"audit")

    def test_rehashed_manifest_cannot_erase_residual_inventory_or_regions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,_=owner_with_residual(root); audit=root/"audit"
            init_run(ownership_run=owner,audit_dir=audit)
            manifest=json.loads((audit/"run-manifest.json").read_text())
            manifest["components"] = []
            manifest["regions"] = []
            manifest["run_manifest_sha256"] = canonical({key: value for key, value in manifest.items()
                                                       if key != "run_manifest_sha256"})
            write(audit/"run-manifest.json",manifest)
            with self.assertRaisesRegex(EnvelopeError,"freshly derived"):
                status(audit)

    def test_rehashed_checkpoint_state_cannot_forge_component_dispositions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,_=owner_with_residual(root); audit=root/"audit"
            init_run(ownership_run=owner,audit_dir=audit)
            packet=next_packet(audit)
            apply_action(audit,envelope(packet,[{"type":"noise_or_fold","component_ids":packet["region"]["component_ids"]}]))
            checkpoint_path=audit/"commits/000001/checkpoint.json"
            checkpoint=json.loads(checkpoint_path.read_text())
            checkpoint["state"]["component_dispositions"][0]["type"]="punctuation_or_nonword"
            manifest=json.loads((audit/"run-manifest.json").read_text())
            rehash_checkpoint(checkpoint,manifest["run_manifest_sha256"])
            write(checkpoint_path,checkpoint)
            with self.assertRaisesRegex(EnvelopeError,"exactly replay"):
                status(audit)

    def test_rehashed_packet_evidence_is_still_checked_against_source_rendering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,_=owner_with_residual(root); audit=root/"audit"
            init_run(ownership_run=owner,audit_dir=audit); packet=next_packet(audit)
            packet_dir=next((audit/"packets").iterdir())
            evidence=packet_dir/packet["evidence"]["source_context_claimed_red"]["path"]
            image=Image.open(evidence).convert("RGB"); image.putpixel((0,0),(1,2,3)); image.save(evidence)
            packet["evidence"]["source_context_claimed_red"]["file_sha256"]=sha256_file(evidence)
            packet["legal_actions"]["packet_bound_envelope"]["packet_sha256"]=None
            packet["packet_sha256"]=canonical({key:value for key,value in packet.items() if key!="packet_sha256"})
            packet["legal_actions"]["packet_bound_envelope"]["packet_sha256"]=packet["packet_sha256"]
            write(packet_dir/"packet.json",packet)
            with self.assertRaisesRegex(EnvelopeError,"deterministic source rendering"):
                next_packet(audit)

    def test_action_geometry_route_and_target_proximity_are_enforced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,_=owner_with_residual(root); audit=root/"audit"
            init_run(ownership_run=owner,audit_dir=audit); first=next_packet(audit)
            ids=first["region"]["component_ids"]
            with self.assertRaisesRegex(EnvelopeError,"bbox must cover"):
                apply_action(audit,envelope(first,[{"type":"new_missing_word","component_ids":ids,
                    "new_word_id":"missing-001","bbox_source_xywh":[49,25,10,7],"text_guess":"x",
                    "route":"human_or_model_followup"}]))
            boxes=[item["bbox"] for item in first["components"]]
            x0=min(item["x"] for item in boxes); y0=min(item["y"] for item in boxes)
            x1=max(item["x"]+item["width"] for item in boxes); y1=max(item["y"]+item["height"] for item in boxes)
            with self.assertRaisesRegex(EnvelopeError,"text_guess and route"):
                apply_action(audit,envelope(first,[{"type":"new_missing_word","component_ids":ids,
                    "new_word_id":"missing-001","bbox_source_xywh":[x0,y0,x1-x0,y1-y0],"text_guess":"x",
                    "route":"../../arbitrary"}]))
            apply_action(audit,envelope(first,[{"type":"noise_or_fold","component_ids":ids}]))
            outside=next_packet(audit)
            with self.assertRaisesRegex(EnvelopeError,"too far"):
                apply_action(audit,envelope(outside,[{"type":"attach_existing_unit",
                    "component_ids":outside["region"]["component_ids"],"unit_id":"U1"}]))

    def test_unknown_owner_claim_and_partial_numeric_commit_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,_=owner_with_residual(root)
            checkpoint_path=owner/"commits/000001/checkpoint.json"
            checkpoint=json.loads(checkpoint_path.read_text())
            checkpoint["state"]["claimed_units"][0]["unit_id"]="UNKNOWN"
            manifest=json.loads((owner/"run-manifest.json").read_text())
            rehash_checkpoint(checkpoint,manifest["run_manifest_sha256"])
            write(checkpoint_path,checkpoint)
            with self.assertRaisesRegex(EnvelopeError,"claims are invalid"):
                init_run(ownership_run=owner,audit_dir=root/"audit")
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); owner,_=owner_with_residual(root); audit=root/"audit"
            init_run(ownership_run=owner,audit_dir=audit)
            (audit/"transactions"/"abandoned").mkdir()
            status(audit)  # abandoned transactions are never commits
            (audit/"commits"/"000001").mkdir()
            with self.assertRaisesRegex(EnvelopeError,"valid JSON"):
                status(audit)
