from __future__ import annotations

from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from word_envelope.human_review_console import ConsoleError
from word_envelope.simple_page_selector import (
    SimplePageSelector,
    SimpleSelectorLibrary,
    derive_uploaded_dual_ink,
    initialize_simple_selector,
    install_dual_ink_layers,
    reset_simple_selector,
)


class SimplePageSelectorTests(unittest.TestCase):
    def _commit(self, selector: SimplePageSelector, state: dict, rectangles: list[list[int]]):
        payload = {
            "base_state_sha256": state["state_sha256"],
            "rectangles": rectangles,
            "deselect_rectangles": [],
        }
        if selector.ink_layers is not None:
            payload["ink_variant"] = "clean"
        preview = selector.preview_selection(payload)
        self.assertTrue(preview["commit_ready"])
        commit_payload = {
            "schema_version": "simple-page-word-selection-action.v1",
            "base_state_sha256": state["state_sha256"],
            "rectangles": rectangles,
            "deselect_rectangles": [],
            "selection_preview_sha256": preview["selection_preview_sha256"],
        }
        if selector.ink_layers is not None:
            commit_payload["ink_variant"] = "clean"
        return selector.commit_word(commit_payload)

    def _session(self, root: Path) -> tuple[SimplePageSelector, Path]:
        source_path = root / "source.png"
        mask_path = root / "strong.png"
        source = np.full((90, 140, 3), 245, dtype=np.uint8)
        source[30:38, 20:38] = (70, 50, 45)
        source[31:40, 42:62] = (70, 50, 45)
        source[28:39, 85:110] = (70, 50, 45)
        Image.fromarray(source, mode="RGB").save(source_path)
        mask = np.zeros((90, 140), dtype=np.uint8)
        mask[30:38, 20:38] = 255
        mask[31:40, 42:62] = 255
        mask[28:39, 85:110] = 255
        Image.fromarray(mask, mode="L").save(mask_path)
        session_dir = root / "session"
        initialize_simple_selector(
            session_dir,
            page_id="synthetic-p01",
            source_path=source_path,
            strong_mask_path=mask_path,
        )
        return SimplePageSelector(session_dir), session_dir

    def test_select_enter_repeat_contract_claims_fragmented_word_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector, _session = self._session(Path(directory))
            initial = selector.bootstrap()
            self.assertEqual(initial["state"]["word_count"], 0)
            self.assertFalse(initial["manifest"]["protocol"]["per_word_annotations"])
            result = self._commit(
                selector,
                initial["state"],
                [[18, 27, 48, 18]],
            )
            word = result["committed_word"]
            self.assertEqual(word["word_number"], 1)
            self.assertEqual(word["selected_pixels"], 324)
            self.assertEqual(word["fit_status"], "pending_page_finish")
            self.assertIsNone(word["envelope_metrics"])
            self.assertEqual(word["fit_trials"], [])
            self.assertEqual(result["state"]["claimed_pixels"], 324)
            self.assertEqual(result["bootstrap"]["state"]["word_count"], 1)

            with self.assertRaisesRegex(ConsoleError, "changed"):
                selector.commit_word(
                    {
                        "schema_version": "simple-page-word-selection-action.v1",
                        "base_state_sha256": initial["state"]["state_sha256"],
                        "rectangles": [[82, 25, 32, 19]],
                        "deselect_rectangles": [],
                        "selection_preview_sha256": "0" * 64,
                    }
                )
            with patch(
                "word_envelope.simple_page_selector.ndimage.label",
                side_effect=AssertionError(
                    "normal next-word selection must reuse the remaining component map"
                ),
            ):
                second = self._commit(
                    selector,
                    result["state"],
                    [[82, 25, 32, 19]],
                )
            self.assertEqual(second["state"]["word_count"], 2)
            self.assertEqual(second["state"]["claimed_pixels"], 599)

    def test_reset_creates_a_fresh_run_without_erasing_the_prior_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector, session = self._session(Path(directory))
            committed = self._commit(
                selector,
                selector.bootstrap()["state"],
                [[18, 27, 48, 18]],
            )
            replacement = reset_simple_selector(selector)
            self.assertNotEqual(replacement.session_dir, session)
            self.assertEqual(replacement.bootstrap()["state"]["word_count"], 0)
            self.assertEqual(
                SimplePageSelector(session).bootstrap()["state"]["word_count"],
                committed["state"]["word_count"],
            )
            self.assertEqual(
                replacement.manifest["source"]["working_file_sha256"],
                selector.manifest["source"]["working_file_sha256"],
            )

    def test_internal_library_starts_resumes_and_resets_one_saved_run_per_page(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current, _session = self._session(root)
            catalog_source = Image.new("RGB", (240, 160), (235, 222, 188))
            pixels = np.asarray(catalog_source).copy()
            pixels[52:59, 24:214] = (55, 75, 145)
            pixels[94:98, 36:204] = (78, 90, 150)
            catalog_path = root / "catalog-source.png"
            Image.fromarray(pixels, mode="RGB").save(catalog_path)
            item_id = "007-19430411-L01-02"

            class FakeCatalog:
                catalog_revision = "a" * 64

                def public_listing(self):
                    return {
                        "catalog_revision": self.catalog_revision,
                        "count": 1,
                        "items": [
                            {
                                "catalog_item_id": item_id,
                                "identity": {
                                    "collection_code": "007",
                                    "date_raw": "19430411",
                                    "letter_sequence": 1,
                                    "page_number": 2,
                                    "original_filename": "007-19430411-L01-02.jpg",
                                },
                                "dimensions": {"width": 240, "height": 160},
                                "challenge_tags": ["blue-ink"],
                                "thumbnail_available": True,
                            }
                        ],
                    }

                def resolve_catalog_source(self, catalog_item_id):
                    if catalog_item_id != item_id:
                        raise AssertionError("unexpected catalog item")
                    return SimpleNamespace(absolute_path=catalog_path)

            library = SimpleSelectorLibrary(root, current, catalog=FakeCatalog())
            listing = library.listing()
            self.assertIsNone(listing["items"][0]["saved_progress"])
            opened = library.open_item(item_id, FakeCatalog.catalog_revision)
            self.assertEqual(opened.bootstrap()["state"]["word_count"], 0)
            self.assertEqual(
                library.open_item(item_id, FakeCatalog.catalog_revision).session_dir,
                opened.session_dir,
            )
            self._commit(
                opened,
                opened.bootstrap()["state"],
                [[20, 48, 198, 16]],
            )
            saved = library.listing()["items"][0]["saved_progress"]
            self.assertEqual(saved["word_count"], 1)
            replacement = library.reset_active(opened)
            self.assertEqual(replacement.bootstrap()["state"]["word_count"], 0)
            self.assertEqual(SimplePageSelector(opened.session_dir).bootstrap()["state"]["word_count"], 1)

    def test_generic_dual_ink_keeps_clean_as_exact_high_recall_subset(self) -> None:
        source = Image.new("RGB", (180, 100), (238, 226, 195))
        values = np.asarray(source).copy()
        values[45:51, 20:160] = (55, 72, 142)
        clean, high_recall = derive_uploaded_dual_ink(Image.fromarray(values))
        self.assertGreater(int(clean.sum()), 0)
        self.assertFalse(np.any(clean & ~high_recall))
        self.assertGreater(int(np.count_nonzero(high_recall & ~clean)), 0)

    def test_click_or_partial_box_expands_the_entire_touched_component(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector, _session = self._session(Path(directory))
            state = selector.bootstrap()["state"]
            preview = selector.preview_selection(
                {
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[20, 30, 1, 1]],
                    "deselect_rectangles": [],
                }
            )
            self.assertEqual(preview["component_count"], 1)
            self.assertEqual(preview["selected_pixels"], 144)
            self.assertTrue(preview["overlay_data_url"].startswith("data:image/png;base64,"))
            result = selector.commit_word(
                {
                    "schema_version": "simple-page-word-selection-action.v1",
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[20, 30, 1, 1]],
                    "deselect_rectangles": [],
                    "selection_preview_sha256": preview["selection_preview_sha256"],
                }
            )
            self.assertEqual(result["committed_word"]["selected_pixels"], 144)
            self.assertEqual(result["committed_word"]["selected_source_component_count"], 1)

    def test_micro_noise_islands_cannot_create_fragmented_envelope_spurs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = np.full((90, 140, 3), 245, dtype=np.uint8)
            source[35:45, 30:70] = (70, 50, 45)
            mask = np.zeros((90, 140), dtype=np.uint8)
            mask[35:45, 30:70] = 255
            mask[20, 22] = 255
            mask[68, 88:90] = 255
            source_path = root / "source.png"
            mask_path = root / "mask.png"
            Image.fromarray(source, mode="RGB").save(source_path)
            Image.fromarray(mask, mode="L").save(mask_path)
            session = root / "session"
            initialize_simple_selector(
                session,
                page_id="micro-noise-test",
                source_path=source_path,
                strong_mask_path=mask_path,
            )
            selector = SimplePageSelector(session)
            state = selector.bootstrap()["state"]
            preview = selector.preview_selection(
                {
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[15, 15, 85, 60]],
                    "deselect_rectangles": [],
                }
            )
            self.assertEqual(preview["selected_pixels"], 400)
            self.assertEqual(preview["component_count"], 1)
            self.assertEqual(
                preview["selection_hygiene"]["suppressed_pixels"], 3
            )
            self.assertEqual(
                len(preview["selection_hygiene"]["suppressed_component_ids"]), 2
            )
            committed = selector.commit_word(
                {
                    "schema_version": "simple-page-word-selection-action.v1",
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[15, 15, 85, 60]],
                    "deselect_rectangles": [],
                    "selection_preview_sha256": preview[
                        "selection_preview_sha256"
                    ],
                }
            )
            self.assertEqual(
                committed["committed_word"]["selection_hygiene"][
                    "suppressed_pixels"
                ],
                3,
            )
            finished = selector.finish_words(
                {"base_state_sha256": committed["state"]["state_sha256"]}
            )
            word = finished["state"]["words"][0]
            self.assertNotEqual(
                word["fit_method"], "component_tree_fragmented_envelope"
            )
            self.assertNotEqual(word["fit_quality"], "fitted_fragmented_selection")

    def test_dual_extracted_layers_select_and_record_one_exact_variant_per_word(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selector, session = self._session(root)
            clean_path = root / "clean.png"
            high_recall_path = root / "high-recall.png"
            clean = np.zeros((90, 140), dtype=np.uint8)
            clean[30:38, 20:38] = 255
            high_recall = clean.copy()
            high_recall[30:38, 38:62] = 255
            Image.fromarray(clean, mode="L").save(clean_path)
            Image.fromarray(high_recall, mode="L").save(high_recall_path)
            record = install_dual_ink_layers(
                session,
                clean_mask_path=clean_path,
                high_recall_mask_path=high_recall_path,
            )
            self.assertEqual(record["default_layer"], "clean")
            self.assertEqual(record["layers"]["clean"]["pixels"], 144)
            self.assertEqual(record["layers"]["high_recall"]["pixels"], 336)

            selector = SimplePageSelector(session)
            bootstrap = selector.bootstrap()
            self.assertEqual(
                bootstrap["manifest"]["protocol"]["selection_mode"],
                "dual_extracted_ink",
            )
            self.assertEqual(
                set(bootstrap["manifest"]["ink_layers"]),
                {"clean", "high_recall"},
            )
            self.assertIn("clean", bootstrap["assets"])
            self.assertIn("high_recall", bootstrap["assets"])
            state = bootstrap["state"]
            high_recall_preview = selector.preview_selection(
                {
                    "base_state_sha256": state["state_sha256"],
                    "ink_variant": "high_recall",
                    "rectangles": [[20, 30, 1, 1]],
                    "deselect_rectangles": [],
                }
            )
            clean_preview = selector.preview_selection(
                {
                    "base_state_sha256": state["state_sha256"],
                    "ink_variant": "clean",
                    "rectangles": [[20, 30, 1, 1]],
                    "deselect_rectangles": [],
                }
            )
            self.assertEqual(high_recall_preview["selected_pixels"], 336)
            self.assertEqual(clean_preview["selected_pixels"], 144)
            self.assertEqual(clean_preview["ink_variant"], "clean")
            committed = selector.commit_word(
                {
                    "schema_version": "simple-page-word-selection-action.v1",
                    "base_state_sha256": state["state_sha256"],
                    "ink_variant": "clean",
                    "rectangles": [[20, 30, 1, 1]],
                    "deselect_rectangles": [],
                    "selection_preview_sha256": clean_preview[
                        "selection_preview_sha256"
                    ],
                }
            )
            word = committed["committed_word"]
            self.assertEqual(word["ink_variant"], "clean")
            self.assertEqual(
                word["ink_variant_pixel_sha256"],
                record["layers"]["clean"]["mask_pixel_sha256"],
            )
            self.assertEqual(word["selected_pixels"], 144)

    def test_local_source_recovery_is_visible_optional_and_commits_exact_chosen_pixels(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector, _session = self._session(Path(directory))
            state = selector.bootstrap()["state"]
            anchor = selector.preview_selection(
                {
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[20, 30, 1, 1]],
                    "deselect_rectangles": [],
                }
            )
            recovery = selector.preview_recovery(
                {
                    "base_state_sha256": state["state_sha256"],
                    "selection_preview_sha256": anchor[
                        "selection_preview_sha256"
                    ],
                }
            )
            self.assertEqual(recovery["active_profile"], "conservative")
            self.assertEqual(
                recovery["candidate_order"],
                ["original", "conservative", "balanced", "maximum_recall"],
            )
            balanced = selector.choose_recovery(
                {
                    "base_state_sha256": state["state_sha256"],
                    "recovery_set_sha256": recovery["recovery_set_sha256"],
                    "profile": "balanced",
                }
            )["surface"]
            self.assertEqual(balanced["selected_pixels"], 0)
            self.assertFalse(balanced["commit_ready"])
            self.assertTrue(balanced["requires_manual_reselection"])
            self.assertIsNone(selector._selection_preview_cache)
            recovery_cache = selector._recovery_preview_cache
            additions = (
                recovery_cache["candidates"]["balanced"]
                & ~recovery_cache["anchor"]
            )
            recovered_y, recovered_x = np.argwhere(additions)[0]
            selected = selector.preview_selection(
                {
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[int(recovered_x), int(recovered_y), 1, 1]],
                    "deselect_rectangles": [],
                    "recovery_set_sha256": recovery["recovery_set_sha256"],
                    "recovery_profile": "balanced",
                }
            )
            self.assertGreater(selected["selected_pixels"], 0)
            self.assertLess(selected["selected_pixels"], balanced["selectable_pixels"])
            committed = selector.commit_word(
                {
                    "schema_version": "simple-page-word-selection-action.v1",
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[int(recovered_x), int(recovered_y), 1, 1]],
                    "deselect_rectangles": [],
                    "selection_preview_sha256": selected[
                        "selection_preview_sha256"
                    ],
                }
            )["committed_word"]
            self.assertEqual(committed["selected_pixels"], selected["selected_pixels"])
            self.assertEqual(committed["recovery"]["profile"], "balanced")
            self.assertGreater(committed["recovery"]["recovered_source_pixels"], 0)
            with self.assertRaisesRegex(ConsoleError, "no longer current"):
                selector.choose_recovery(
                    {
                        "base_state_sha256": state["state_sha256"],
                        "recovery_set_sha256": recovery["recovery_set_sha256"],
                        "profile": "maximum_recall",
                    }
                )

    def test_recovered_punctuation_can_never_reselect_an_already_red_word(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector, _session = self._session(Path(directory))
            first = self._commit(
                selector,
                selector.bootstrap()["state"],
                [[20, 30, 1, 1]],
            )
            state = first["state"]
            anchor = selector.preview_selection(
                {
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[90, 31, 1, 1]],
                    "deselect_rectangles": [],
                }
            )

            def deliberately_leaky_recovery(_source, _anchor, _forbidden, crop):
                _x, _y, width, height = crop
                leaked = np.ones((height, width), dtype=bool)
                return {
                    "candidates": {
                        name: {"mask": leaked, "added_component_count": 1}
                        for name in ("conservative", "balanced", "maximum_recall")
                    }
                }

            with patch(
                "word_envelope.simple_page_selector.recover_local_ink_candidates",
                side_effect=deliberately_leaky_recovery,
            ):
                recovery = selector.preview_recovery(
                    {
                        "base_state_sha256": state["state_sha256"],
                        "selection_preview_sha256": anchor[
                            "selection_preview_sha256"
                        ],
                    }
                )
            self.assertIsNone(selector._selection_preview_cache)
            claimed = selector._claimed(state)
            selected = selector.preview_selection(
                {
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[90, 31, 1, 1]],
                    "deselect_rectangles": [],
                    "recovery_set_sha256": recovery["recovery_set_sha256"],
                    "recovery_profile": "conservative",
                }
            )
            cached = selector._selection_preview_cache
            self.assertEqual(int(np.count_nonzero(cached["selected"] & claimed)), 0)
            committed = selector.commit_word(
                {
                    "schema_version": "simple-page-word-selection-action.v1",
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[90, 31, 1, 1]],
                    "deselect_rectangles": [],
                    "selection_preview_sha256": selected[
                        "selection_preview_sha256"
                    ],
                }
            )
            self.assertEqual(committed["state"]["word_count"], 2)
            self.assertEqual(
                int(
                    np.count_nonzero(
                        selector._word_mask(committed["committed_word"]) & claimed
                    )
                ),
                0,
            )

    def test_undo_last_red_word_restores_pixels_and_allows_safe_recommit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector, session = self._session(Path(directory))
            initial = selector.bootstrap()["state"]
            committed = self._commit(selector, initial, [[20, 30, 1, 1]])
            first_path = committed["committed_word"]["selected_mask_path"]
            self.assertEqual(committed["state"]["claimed_pixels"], 144)
            undone = selector.undo_last_word(
                {"base_state_sha256": committed["state"]["state_sha256"]}
            )
            self.assertEqual(undone["state"]["word_count"], 0)
            self.assertEqual(undone["state"]["claimed_pixels"], 0)
            self.assertTrue((session / first_path).is_file())
            recommitted = self._commit(
                selector,
                undone["state"],
                [[20, 30, 1, 1]],
            )
            self.assertEqual(recommitted["state"]["word_count"], 1)
            self.assertEqual(recommitted["state"]["claimed_pixels"], 144)
            self.assertNotEqual(
                recommitted["committed_word"]["selected_mask_path"],
                first_path,
            )
            self.assertTrue(
                (session / recommitted["committed_word"]["selected_mask_path"]).is_file()
            )

    def test_enter_reuses_the_exact_fitted_preview_without_refitting(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector, _session = self._session(Path(directory))
            state = selector.bootstrap()["state"]
            rectangles = [[20, 30, 1, 1]]
            preview = selector.preview_selection(
                {
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": rectangles,
                    "deselect_rectangles": [],
                }
            )
            self.assertTrue(preview["commit_ready"])
            self.assertEqual(len(preview["selection_preview_sha256"]), 64)

            def unexpected_refit(*_args, **_kwargs):
                self.fail("Enter must commit the already-fitted preview")

            selector._fit = unexpected_refit  # type: ignore[method-assign]
            result = selector.commit_word(
                {
                    "schema_version": "simple-page-word-selection-action.v1",
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": rectangles,
                    "deselect_rectangles": [],
                    "selection_preview_sha256": preview[
                        "selection_preview_sha256"
                    ],
                }
            )
            self.assertEqual(
                result["committed_word"]["selection_preview_sha256"],
                preview["selection_preview_sha256"],
            )

    def test_clicking_selected_ink_removes_that_whole_piece(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector, _session = self._session(Path(directory))
            state = selector.bootstrap()["state"]
            preview = selector.preview_selection(
                {
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[18, 27, 48, 18]],
                    "deselect_rectangles": [[20, 30, 1, 1]],
                }
            )
            self.assertEqual(preview["selected_pixels"], 180)
            self.assertTrue(preview["commit_ready"])
            committed = selector.commit_word(
                {
                    "schema_version": "simple-page-word-selection-action.v1",
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[18, 27, 48, 18]],
                    "deselect_rectangles": [[20, 30, 1, 1]],
                    "selection_preview_sha256": preview[
                        "selection_preview_sha256"
                    ],
                }
            )
            self.assertEqual(committed["committed_word"]["selected_pixels"], 180)

    def test_valid_fragmented_selection_gets_component_tree_envelope_when_old_fit_rejects(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector, _session = self._session(Path(directory))
            state = selector.bootstrap()["state"]

            def rejected_fit(*_args, **_kwargs):
                raise ConsoleError(
                    "envelope_failed",
                    "Synthetic fitted-envelope rejection",
                    details={"trials": [{"status": "rejected"}]},
                )

            selector._fit = rejected_fit  # type: ignore[method-assign]
            preview = selector.preview_selection(
                {
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[20, 30, 1, 1]],
                    "deselect_rectangles": [],
                }
            )
            self.assertTrue(preview["commit_ready"])
            self.assertEqual(preview["fit_status"], "deferred_until_page_finish")
            committed = selector.commit_word(
                {
                    "schema_version": "simple-page-word-selection-action.v1",
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [[20, 30, 1, 1]],
                    "deselect_rectangles": [],
                    "selection_preview_sha256": preview[
                        "selection_preview_sha256"
                    ],
                }
            )
            self.assertEqual(
                committed["committed_word"]["fit_status"],
                "pending_page_finish",
            )
            finished = selector.finish_words(
                {"base_state_sha256": committed["state"]["state_sha256"]}
            )
            word = finished["state"]["words"][0]
            self.assertEqual(
                word["fit_quality"],
                "fitted_fragmented_selection",
            )
            self.assertEqual(
                word["fit_method"],
                "component_tree_fragmented_envelope",
            )
            self.assertGreater(len(word["envelope_polygon"]), 4)
            self.assertEqual(
                word["envelope_metrics"]["selected_ink_coverage"],
                1.0,
            )

    def test_finish_then_one_page_note_can_bind_generated_context_crop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            selector, session = self._session(Path(directory))
            initial = selector.bootstrap()["state"]
            first = self._commit(selector, initial, [[18, 27, 48, 18]])["state"]
            notes_stage = selector.finish_words({"base_state_sha256": first["state_sha256"]})["state"]
            self.assertEqual(notes_stage["status"], "page_notes")
            saved = selector.save_page_notes(
                {
                    "base_state_sha256": notes_stage["state_sha256"],
                    "summary": "Selection was fast; this fragmented word needed two pieces.",
                    "items": [{"text": "The gap is visible here.", "bbox_xywh": [10, 20, 70, 35]}],
                }
            )["state"]
            self.assertEqual(saved["status"], "complete")
            self.assertTrue((session / "page-notes/crop-01.png").is_file())
            self.assertTrue((session / "page-notes/notes.json").is_file())
            with self.assertRaisesRegex(ConsoleError, "already finished"):
                selector.finish_words({"base_state_sha256": saved["state_sha256"]})

    def test_invalid_empty_out_of_bounds_and_nonbinary_inputs_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selector, _session = self._session(root)
            state = selector.bootstrap()["state"]
            with self.assertRaises(ConsoleError):
                selector.commit_word({"schema_version": "simple-page-word-selection-action.v1", "base_state_sha256": state["state_sha256"], "rectangles": [[0, 0, 5, 5]], "deselect_rectangles": [], "selection_preview_sha256": "0" * 64})
            with self.assertRaises(ConsoleError):
                selector.commit_word({"schema_version": "simple-page-word-selection-action.v1", "base_state_sha256": state["state_sha256"], "rectangles": [[130, 80, 20, 20]], "deselect_rectangles": [], "selection_preview_sha256": "0" * 64})

            source = root / "other-source.png"
            bad = root / "bad.png"
            Image.new("RGB", (10, 10), "white").save(source)
            values = np.zeros((10, 10), dtype=np.uint8)
            values[2, 2] = 127
            Image.fromarray(values, mode="L").save(bad)
            with self.assertRaisesRegex(ConsoleError, "binary"):
                initialize_simple_selector(
                    root / "bad-session",
                    page_id="bad",
                    source_path=source,
                    strong_mask_path=bad,
                )

    def test_source_color_mode_hides_ink_view_and_recovers_source_pixels_beyond_seed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.png"
            seed_path = root / "seed.png"
            source = np.full((90, 140, 3), (236, 225, 201), dtype=np.uint8)
            source[30:40, 18:62] = (72, 84, 145)
            source[31:39, 86:112] = (72, 84, 145)
            Image.fromarray(source, mode="RGB").save(source_path)
            seed = np.zeros((90, 140), dtype=np.uint8)
            seed[32:38, 24:55] = 255
            seed[33:37, 91:106] = 255
            Image.fromarray(seed, mode="L").save(seed_path)
            session = root / "color-session"
            initialize_simple_selector(
                session,
                page_id="color-p01",
                source_path=source_path,
                strong_mask_path=seed_path,
                selection_mode="source_color_guided",
            )
            selector = SimplePageSelector(session)
            bootstrap = selector.bootstrap()
            self.assertEqual(
                bootstrap["manifest"]["protocol"]["visible_selection_surface"],
                "original_source_image_only",
            )
            self.assertNotIn("strong", bootstrap["assets"])
            self.assertNotIn("available", bootstrap["assets"])
            state = bootstrap["state"]
            claimed = selector._claimed(state)
            selected, _groups, _candidate = selector._selection_from_rectangles(
                state,
                claimed,
                [[28, 34, 1, 1]],
            )
            self.assertTrue(selected[30, 18])
            self.assertTrue(selected[39, 61])
            self.assertFalse(selected[34, 90])
            self.assertGreater(int(selected.sum()), int((seed > 0).sum()))
            committed = self._commit(selector, state, [[28, 34, 1, 1]])[
                "committed_word"
            ]
            self.assertGreater(committed["selected_pixels"], 0)
            self.assertEqual(committed["fit_status"], "pending_page_finish")

    def test_source_only_click_without_a_nearby_hidden_seed_fails_softly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.png"
            seed_path = root / "seed.png"
            source = np.full((180, 900, 3), (236, 225, 201), dtype=np.uint8)
            source[70:84, 700:760] = (72, 84, 145)
            Image.fromarray(source, mode="RGB").save(source_path)
            seed = np.zeros((180, 900), dtype=np.uint8)
            seed[60:72, 20:55] = 255
            Image.fromarray(seed, mode="L").save(seed_path)
            session = root / "color-session"
            initialize_simple_selector(
                session,
                page_id="source-only-fallback",
                source_path=source_path,
                strong_mask_path=seed_path,
                selection_mode="source_color_guided",
            )
            selector = SimplePageSelector(session)
            state = selector.bootstrap()["state"]
            selected, _groups, _candidate = selector._selection_from_rectangles(
                state,
                selector._claimed(state),
                [[718, 74, 2, 2]],
            )
            self.assertGreater(int(selected.sum()), 0)

    def test_one_enter_cut_persists_a_split_then_either_side_is_selectable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.png"
            mask_path = root / "strong.png"
            source = np.full((100, 180, 3), 245, dtype=np.uint8)
            source[45:55, 20:160] = (70, 50, 45)
            Image.fromarray(source, mode="RGB").save(source_path)
            mask = np.zeros((100, 180), dtype=np.uint8)
            mask[45:55, 20:160] = 255
            Image.fromarray(mask, mode="L").save(mask_path)
            session = root / "cut-session"
            initialize_simple_selector(
                session,
                page_id="cut-p01",
                source_path=source_path,
                strong_mask_path=mask_path,
            )
            selector = SimplePageSelector(session)
            state = selector.bootstrap()["state"]
            before, _ids, _available = selector._selection_from_rectangles(
                state,
                selector._claimed(state),
                [[30, 49, 1, 1]],
            )
            self.assertEqual(int(before.sum()), 1_400)
            committed = selector.apply_cut(
                {
                    "schema_version": "simple-page-cut-apply-action.v1",
                    "base_state_sha256": state["state_sha256"],
                    "points": [[90, 38], [90, 62]],
                    "width_px": 5,
                }
            )
            self.assertGreater(
                committed["cut"]["touched_high_recall_ink_pixels"],
                0,
            )
            next_state = committed["state"]
            self.assertGreater(next_state["assets"]["cut_mask"]["pixels"], 0)
            left, _ids, _available = selector._selection_from_rectangles(
                next_state,
                selector._claimed(next_state),
                [[30, 49, 1, 1]],
            )
            right, _ids, _available = selector._selection_from_rectangles(
                next_state,
                selector._claimed(next_state),
                [[130, 49, 1, 1]],
            )
            self.assertGreater(int(left.sum()), 0)
            self.assertGreater(int(right.sum()), 0)
            self.assertLess(int(left.sum()), int(before.sum()))
            self.assertEqual(int(np.count_nonzero(left & right)), 0)

    def test_cut_is_a_persistent_barrier_even_when_detector_sees_no_ink(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.png"
            mask_path = root / "strong.png"
            source = np.full((100, 180, 3), 245, dtype=np.uint8)
            source[45:55, 20:160] = (62, 74, 142)
            Image.fromarray(source, mode="RGB").save(source_path)

            # The source contains one continuous stroke, but the detector has
            # a wide missing section exactly where the user places the cut.
            mask = np.zeros((100, 180), dtype=np.uint8)
            mask[45:55, 20:82] = 255
            mask[45:55, 98:160] = 255
            Image.fromarray(mask, mode="L").save(mask_path)

            session = root / "detector-gap-cut-session"
            initialize_simple_selector(
                session,
                page_id="detector-gap-p01",
                source_path=source_path,
                strong_mask_path=mask_path,
                selection_mode="source_color_guided",
            )
            selector = SimplePageSelector(session)
            state = selector.bootstrap()["state"]
            committed = selector.apply_cut(
                {
                    "schema_version": "simple-page-cut-apply-action.v1",
                    "base_state_sha256": state["state_sha256"],
                    "points": [[90, 36], [90, 64]],
                    "width_px": 5,
                }
            )
            self.assertEqual(
                committed["cut"]["touched_high_recall_ink_pixels"],
                0,
            )
            self.assertTrue(committed["cut"]["persists_when_detected_ink_is_zero"])
            next_state = committed["state"]
            self.assertGreater(next_state["assets"]["cut_mask"]["pixels"], 0)

            left, _ids, _available = selector._selection_from_rectangles(
                next_state,
                selector._claimed(next_state),
                [[30, 49, 2, 2]],
            )
            right, _ids, _available = selector._selection_from_rectangles(
                next_state,
                selector._claimed(next_state),
                [[130, 49, 2, 2]],
            )
            self.assertGreater(int(left.sum()), 0)
            self.assertGreater(int(right.sum()), 0)
            self.assertEqual(int(np.count_nonzero(left & right)), 0)
            self.assertFalse(np.any(left[:, 93:]))
            self.assertFalse(np.any(right[:, :88]))


class SimpleSelectorFrontendContractTests(unittest.TestCase):
    def test_ui_is_exactly_select_enter_repeat_with_deferred_notes(self) -> None:
        root = Path(__file__).resolve().parents[1]
        html = (root / "simple_selector/index.html").read_text()
        script = (root / "simple_selector/app.js").read_text()
        styles = (root / "simple_selector/app.css").read_text()
        self.assertIn("Select one word · press Enter", html)
        self.assertIn("Boxes off", html)
        self.assertIn("Once, at the end", html)
        self.assertIn('if (event.key === "Enter")', script)
        self.assertIn('state.rectangles.push(rect)', script)
        self.assertIn('state.deselectRectangles.push(rect)', script)
        self.assertIn("selectedAtPointer", script)
        self.assertIn("click green ink to remove it", script)
        self.assertNotIn("state.images.selection = null;\n  if (!state.rectangles.length)", script)
        self.assertIn('"/api/apply-cut"', script)
        self.assertIn("Enter · apply cut", script)
        self.assertIn("press Enter once to save it and return to selection", script)
        self.assertNotIn('"/api/preview-cut"', script)
        self.assertNotIn('"/api/commit-cut"', script)
        self.assertIn("page-coordinate barrier", (root / "SIMPLE_PAGE_SELECTOR.md").read_text())
        self.assertIn('id="ink-clean"', html)
        self.assertIn('id="ink-high-recall"', html)
        self.assertIn('ink_variant: state.inkVariant', script)
        self.assertIn('function setInkVariant(variant)', script)
        self.assertIn('state.images.available = state.images[variant]', script)
        self.assertIn("Original letter", html)
        self.assertIn("Finish + fit boxes", html)
        self.assertIn("Erase selection", html)
        self.assertIn("Undo last red word", html)
        self.assertIn('id="open-library"', html)
        self.assertIn('id="reset-page"', html)
        self.assertIn('id="library-grid"', html)
        self.assertIn('class="page-view-controls"', html)
        self.assertIn('id="ink-shell"', html)
        self.assertIn('"/api/library"', script)
        self.assertIn('"/api/open-library-item"', script)
        self.assertIn('"/api/reset-page"', script)
        self.assertIn('"/api/undo-last-word"', script)
        self.assertIn("event.metaKey || event.ctrlKey", script)
        self.assertIn('"/api/preview-selection"', script)
        self.assertIn('ink selected · press Enter', script)
        self.assertIn("state.images.optimisticClaim", script)
        self.assertIn("state.commitBusy", script)
        self.assertIn('style.setProperty("--image-zoom"', script)
        self.assertIn("function synchronizePageScroll", script)
        self.assertIn("result.surface.selectable_ink_data_url", script)
        self.assertNotIn("state.selectionReceipt = result.selection", script)
        commit_start = html.index('<footer id="commit-bar"')
        commit_end = html.index("</footer>", commit_start)
        recovery_position = html.index('id="recovery-panel"')
        self.assertLess(commit_start, recovery_position)
        self.assertLess(recovery_position, commit_end)
        self.assertNotIn("Compare source-supported recovery", html)
        self.assertIn('(count === 0 && !state.recovery)', script)
        self.assertIn('state.images.available = state.images[state.inkVariant]', script)
        self.assertIn('const commitRecoverySurface = commitRecovery ? state.images.available : null;', script)
        self.assertIn('if (commitRecovery && dualInkMode()) state.images.available = state.images[state.inkVariant];', script)
        self.assertIn('if (commitRecoverySurface) state.images.available = commitRecoverySurface;', script)
        self.assertNotIn("position: fixed;\n  left: 50%;\n  bottom: 88px", styles)
        self.assertIn('error.code === "stale_selection_preview"', script)
        self.assertIn("cleaned up automatically", script)
        self.assertIn("{preserveSelection: true}", script)
        self.assertNotIn("confidence", html.lower())
        self.assertNotIn("transcript", html.lower())


if __name__ == "__main__":
    unittest.main()
