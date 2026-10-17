"""Draw detected landmarks on the mirrored camera preview.

The detectors read the camera frame as captured, because the models were
trained on landmarks from unmirrored images. The user sees that frame
mirrored, so a landmark at ``x`` in the camera frame lies at ``1 - x`` in the
preview; ``y`` is unchanged.
"""


def mirrored_for_preview(landmark_list):
    """Return a copy of a MediaPipe landmark list placed as in the preview.

    The copy has the same message type, so MediaPipe's drawing utilities take
    it as they take the original. The original is left untouched.
    """
    mirrored = type(landmark_list)()
    mirrored.CopyFrom(landmark_list)
    for landmark in mirrored.landmark:
        landmark.x = 1.0 - landmark.x
    return mirrored
