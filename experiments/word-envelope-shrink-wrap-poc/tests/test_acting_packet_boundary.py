from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from word_envelope.acting_packet_boundary import validate_packet_dir
from word_envelope.io_utils import sha256_file


class ActingPacketBoundaryTests(unittest.TestCase):
    def test_safe_packet_with_bound_evidence_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = Path(directory)
            (run / "run-manifest.json").write_text("{}\n", encoding="utf-8")
            packet = run / "packets" / "one"
            packet.mkdir(parents=True)
            image = packet / "source-context.jpg"
            image.write_bytes(b"acting-image")
            payload = {
                "evidence": {
                    "source_context": {
                        "path": "packets/one/source-context.jpg",
                        "file_sha256": sha256_file(image),
                    }
                }
            }
            (packet / "work-packet.json").write_text(json.dumps(payload), encoding="utf-8")
            result = validate_packet_dir(packet)
            self.assertTrue(result["passed"])
            self.assertEqual(result["violation_count"], 0)

    def test_sealed_evaluation_marker_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = Path(directory)
            (run / "run-manifest.json").write_text("{}\n", encoding="utf-8")
            packet = run / "packets" / "one"
            packet.mkdir(parents=True)
            (packet / "work-packet.json").write_text(
                json.dumps({"evidence": {}, "evaluation_human_word_number": 3}),
                encoding="utf-8",
            )
            result = validate_packet_dir(packet)
            self.assertFalse(result["passed"])
            self.assertTrue(any(row["kind"] == "blocked_marker" for row in result["violations"]))

    def test_hash_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run = Path(directory)
            (run / "run-manifest.json").write_text("{}\n", encoding="utf-8")
            packet = run / "packets" / "one"
            packet.mkdir(parents=True)
            image = packet / "source-context.jpg"
            image.write_bytes(b"acting-image")
            (packet / "work-packet.json").write_text(
                json.dumps({"evidence": {"source": {"path": "packets/one/source-context.jpg", "file_sha256": "0" * 64}}}),
                encoding="utf-8",
            )
            result = validate_packet_dir(packet)
            self.assertFalse(result["passed"])
            self.assertTrue(any(row["kind"] == "evidence_hash_mismatch" for row in result["violations"]))


if __name__ == "__main__":
    unittest.main()
