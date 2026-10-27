# asl-desktop

The first version of the project: a desktop app in Python with CustomTkinter,
OpenCV and MediaPipe. The web app in `asl-web/` is the product; this one is
kept working as a reference.

- **Translation view:** letters with the same 93-feature LightGBM model as the
  web app, words with a 25-word BiGRU, and offline text-to-speech (`pyttsx3`).
- **Learning coach:** practice with letters and the 25 words.
- **Personalisation:** few-shot letter templates recorded by the user, kept in
  the ignored `models/profiles/` folder.

```text
src/asl_desktop/
├── app/         main window and navigation
├── camera/      camera widget
├── config.py    paths, camera, thresholds, UI and model settings
├── detection/   MediaPipe hand and holistic wrappers
├── models/      letter and sequence classifier wrappers
├── services/    personalisation and text-to-speech
├── ui/          translation and coach views
└── utils/       landmark smoothing and motion tracking
```

It uses [`asl-features`](../asl-features/README.md) for the square-units step,
normalisation and the 93 features. It detects on the camera frame as captured
and mirrors only the preview; a left hand is mirrored into the right-hand shape
the letter model was trained on. Its word model reads 30 frames of 321 values
from `models/word/desktop-25/` and is not the web app's 50-word model.

## Run

You need Python 3.12, a camera and a desktop session. Set up the environment as
in [getting started](../docs/getting-started.md), then:

```bash
python asl-desktop/main.py
python -m pytest tests/asl_desktop
```

LightGBM needs an OpenMP runtime on macOS (`environment.yml` includes it), and
the letter pickle needs the scikit-learn version pinned in `requirements.txt`.
