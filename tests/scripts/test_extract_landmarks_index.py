"""The index CSV that follows landmark extraction, built from the saved state."""

from __future__ import annotations

import json
import logging

import pandas as pd

from scripts.data_preparation import extract_msasl_landmarks as extractor


def test_index_csv_is_built_from_the_state_without_the_raw_annotations(tmp_path) -> None:
    """Someone with the extracted landmarks but not the MS-ASL JSON can still index them."""
    word = "hello"
    class_id = extractor.WORD_TO_MSASL_CLASS[word]
    state_file = tmp_path / "state.json"
    state_file.write_text(
        json.dumps(
            {
                "version": 1,
                "completed": {
                    "train_0": {
                        "status": "success",
                        "path": "0_hello/train_0.parquet",
                        "class_id": class_id,
                        "signer_id": 7,
                    },
                    "train_1": {"status": "rejected", "class_id": class_id},
                },
                "failed": {},
            }
        )
    )

    csv_path = extractor.generate_csv(tmp_path, state_file, logging.getLogger("test"))

    rows = pd.read_csv(csv_path)
    assert rows["path"].tolist() == ["0_hello/train_0.parquet"]
    assert rows["sign"].tolist() == [word]
    assert rows["participant_id"].tolist() == [extractor.SIGNER_ID_OFFSET + 7]
