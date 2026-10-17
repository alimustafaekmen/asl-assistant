"""The word features in asl-features are the trained notebook's, value for value.

The word model was trained with the feature code in
``notebooks/word_50_training.ipynb``; ``asl_features.word`` keeps a
copy so the parity check and the golden fixtures can import it. A copy can
drift: a constant edited, a block reordered, and the 45 x 168 input would
still have the right shape and silently mean something else to the model.

These tests run the notebook's own functions, taken from its cells and
executed (nothing is matched as text), and require the package to return the
same values on the same sequences: the golden fixtures' inputs and the parity
check's fixtures, which between them cover missing shoulders, a left-only
signer and a hand switch.
"""

import ast
import json
from pathlib import Path

import numpy as np
import pytest
from asl_features import word as package

from tests.validation import check_word_feature_parity as parity

PROJECT_ROOT = Path(__file__).resolve().parents[3]
NOTEBOOKS = {
    "training": PROJECT_ROOT / "notebooks" / "word_50_training.ipynb",
    "results": PROJECT_ROOT / "notebooks" / "word_50_training_results.ipynb",
}
GOLDEN = PROJECT_ROOT / "tests" / "web" / "fixtures" / "feature-golden.json"

FUNCTIONS = (
    "safe_norm",
    "angle_between_vectors",
    "normalize_shoulders",
    "compute_per_frame_shape_features",
    "compute_dominant_hand_features",
    "compute_hand_body_relations",
    "build_compact_features",
)
CONSTANTS = ("FACE_INDICES", "POSE_INDICES", "NUM_FACE", "NUM_POSE", "NUM_RIGHT", "NUM_LEFT")


def _notebook_namespace(path: Path) -> dict:
    """The notebook's feature functions and constants, defined by running them."""
    cells = [
        "".join(cell["source"])
        for cell in json.loads(path.read_text(encoding="utf-8"))["cells"]
        if cell["cell_type"] == "code"
    ]
    namespace = {"np": np}
    for source in cells:
        try:
            tree = ast.parse(source)
        except SyntaxError:  # a cell with shell or magic lines
            continue
        for node in tree.body:
            wanted = (isinstance(node, ast.FunctionDef) and node.name in FUNCTIONS) or (
                isinstance(node, ast.Assign)
                and all(isinstance(t, ast.Name) and t.id.isupper() for t in node.targets)
            )
            if not wanted:
                continue
            try:
                exec(compile(ast.Module([node], []), str(path), "exec"), namespace)
            except Exception:  # a constant that needs the training environment
                if isinstance(node, ast.FunctionDef):
                    raise
    missing = [name for name in (*FUNCTIONS, *CONSTANTS) if name not in namespace]
    assert not missing, f"{path.name} no longer defines {missing}"
    return namespace


def _sequences() -> dict[str, np.ndarray]:
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    sequences = {
        f"golden:{entry['name']}": np.asarray(entry["frames"], dtype=np.float32)
        for entry in golden["word"]["sequences"]
    }
    for name in (
        "fixture_right_only_nominal",
        "fixture_left_only_mirror",
        "fixture_shoulders_present",
        "fixture_shoulders_missing",
        "fixture_dominant_switch_sequence",
        "fixture_two_hands_stable",
    ):
        sequences[f"parity:{name}"] = getattr(parity, name)()
    return sequences


SEQUENCES = _sequences()


@pytest.fixture(scope="module", params=sorted(NOTEBOOKS))
def notebook(request) -> dict:
    return _notebook_namespace(NOTEBOOKS[request.param])


def test_the_landmark_layout_is_the_notebooks(notebook) -> None:
    for name in CONSTANTS:
        assert getattr(package, name) == notebook[name], name


@pytest.mark.parametrize("name", sorted(SEQUENCES))
def test_word_features_equal_the_notebooks(notebook, name) -> None:
    raw = SEQUENCES[name]
    expected = notebook["build_compact_features"](
        np.stack([notebook["normalize_shoulders"](frame) for frame in raw])
    )
    actual = package.build_compact_features(
        np.stack([package.normalize_shoulders(frame) for frame in raw])
    )

    assert actual.shape == expected.shape == (raw.shape[0], 168)
    np.testing.assert_array_equal(actual, expected)
