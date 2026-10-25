# ASL Assistant

[![CI](https://github.com/alimustafaekmen/asl-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/alimustafaekmen/asl-assistant/actions/workflows/ci.yml)

**Live demo:** https://asl-assistant.pages.dev/ · [Technical report](docs/technical-report.md) · [Türkçe](README.tr.md)

ASL Assistant reads American Sign Language letters from the camera and turns them into text, in the browser. MediaPipe finds the hand, face and pose landmarks, and two small ONNX models classify them inside the page: there is no server, and the camera image never leaves the device. Letter recognition is the main mode; an experimental mode recognises 50 isolated ASL words. The interface is in English and Turkish.

![The letter screen on a laptop: a dark camera stage with the Turn on camera and Watch the demo buttons, side cards with the most likely results, the letter reference and the keyboard shortcuts, and the text strip with the Delete, Space and Add buttons below.](docs/assets/screenshots/letter-laptop.png)

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/assets/screenshots/letter-phone.png" width="240" alt="The letter screen on a phone, light theme."><br><sub>Letter screen on a phone</sub></td>
    <td align="center" width="33%"><img src="docs/assets/screenshots/letter-phone-dark.png" width="240" alt="The letter screen on a phone, dark theme."><br><sub>Dark theme</sub></td>
    <td align="center" width="33%"><img src="docs/assets/screenshots/camera-help-phone.png" width="240" alt="The camera stage after the camera permission was refused, with step-by-step help for iPhone Safari and Chrome."><br><sub>Help after a refused camera</sub></td>
  </tr>
  <tr>
    <td align="center" colspan="2"><img src="docs/assets/screenshots/demo-laptop.png" width="100%" alt="The camera-free demo: a recorded hand drawn in landmarks spells FLY; the result card reads L and the text already holds F."><br><sub>The camera-free demo</sub></td>
    <td align="center"><img src="docs/assets/screenshots/word-laptop.png" width="100%" alt="The word screen on a laptop, with the results, the word reference and the 50-word list."><br><sub>Word screen (experimental)</sub></td>
  </tr>
</table>

## What it does

- **Letters.** Recognises 24 static ASL letters live from the camera. Space adds the letter shown, Enter adds a space, Backspace deletes; the text can be copied or read aloud.
- **Camera-free demo.** *Watch the demo* plays a recorded hand spelling FLY through the same pipeline as the camera, and you add each letter yourself.
- **Words (experimental).** Records one isolated sign and shows the three most likely of 50 words. Nothing reaches the text until you accept it.
- **Coach.** Practice with a chosen letter or word; progress stays on the device.
- **Also:** a QR code to open the app on a phone, a short project page, and Model Test (`#test`), which runs bundled samples through the models.

## How it works

```text
camera frame -> MediaPipe Tasks Vision (hand, pose, face landmarks)
  letter: 21 hand landmarks -> 93 features -> LightGBM (ONNX) -> 24 letters
  word:   45 frames x 168 features + mask -> SignTransformer (ONNX) -> top 3 of 50 words
  -> ONNX Runtime Web (WebAssembly) -> the user adds the letter or accepts the word
```

The app is plain HTML, CSS and JavaScript loaded as classic scripts, with no framework and no build step. Feature engineering is defined in Python (`asl-features/`) for training and repeated in JavaScript for the browser; parity checks keep the two within 1e-4. Models download on first use, so opening the page costs about 0.35 MB.

| | Letter model | Word model |
|---|---|---|
| Model | LightGBM, 93 engineered features | SignTransformer, 45 × 168 features and a mask |
| Classes | 24 static letters | 50 isolated signs |
| Result | 99.35% on a random held-out split; about 70% on hands from another dataset | 71.92% accuracy, 0.714 macro-F1 on 4 unseen signers |

The demo reads its poses at 100% because their photographs are in the letter model's training data: it shows how the app works, not how accurate it is. The [technical report](docs/technical-report.md) covers the data, the experiments and the browser runtime.

## Quick start

```bash
make web    # serves asl-web/ at http://localhost:8080; nothing to install
```

The camera needs `localhost` or HTTPS. To work on the code you need Python 3.12 and Node 24; `environment.yml` provides both:

```bash
conda env create -f environment.yml && conda activate asl-assistant   # or: make setup in a Python 3.12 venv
npm ci                 # TypeScript, for the type check
make check             # lint, format, type check, runtime files, Python and JS tests, parity
make browser-check     # headless Chrome checks (needs Chrome)
```

`make help` lists every target; [getting started](docs/getting-started.md) has the details.

## Tech stack

- **Browser:** MediaPipe Tasks Vision 0.10.18, ONNX Runtime Web 1.22.0, kjua for QR codes, Web Speech; JSDoc types checked by TypeScript.
- **Machine learning:** Python 3.12, LightGBM, PyTorch, scikit-learn, ONNX; the word model was trained in a Kaggle notebook.
- **Testing:** `node:test` on the real browser scripts, pytest, headless Chrome over the DevTools Protocol, Ruff.
- **Hosting:** Cloudflare Pages, as a static folder with no build step.

## Limitations

- The letter model knows 24 static letters. J and Z need motion, and I have not trained a model for them.
- The letter model scores 99% on a random split of its training data but about 70% on hands from a different dataset. The training photos are long runs of near-identical frames, so a random split leaves near-copies of the test rows in training.
- The word model is experimental: 50 isolated signs, 72% on 4 signers it never saw. It never adds a word without the user's consent.
- So far I have tested it in desktop Chrome.

## Licence

The source code and the trained model files are released under the [PolyForm Noncommercial License 1.0.0](LICENSE): personal, educational and research use are allowed, commercial use needs my permission. The terms of the training data below also apply to the model files. The `.pkl` and `.pt` files are Python pickles; load them only from a copy you trust.

## Data and attribution

| Used for | Source | Terms |
|---|---|---|
| Letters | [ASL Alphabet](https://www.kaggle.com/datasets/grassknoted/asl-alphabet), Akash Nagaraj, 2018, [doi:10.34740/KAGGLE/DSV/29550](https://doi.org/10.34740/KAGGLE/DSV/29550) | GPL-2.0, as labelled by the provider |
| Letters, demo poses | [American Sign Language Dataset](https://www.kaggle.com/datasets/ayuraj/asl-dataset), Ayush Thakur | CC0 1.0 |
| Letters | `ASL_SemCom` images associated with [ASL-Fingerspelling](https://github.com/Mohammed-Shoaib/ASL-Fingerspelling) | Not recorded; not redistributed |
| Words | [Google - Isolated Sign Language Recognition](https://www.kaggle.com/competitions/asl-signs) (Kaggle, 2023), Deaf Professional Arts Network and Georgia Institute of Technology | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), subject to the competition rules |

Changes: the letter images were reduced to MediaPipe hand landmarks and 93 features; for words, 50 of the 250 signs were kept and each sequence resampled to 45 frames of 168 features. The models hold learned parameters only. The competition rules forbid redistributing the data (section 7.B), so the repository publishes no landmark data from it and its word sample is synthetic. The 24 Model Test letter samples are the 93 features of held-out rows, 23 from ASL Alphabet and the K sample from the `ASL_SemCom` images. The demo poses in `asl-web/data/demo-letters.json` are landmarks found in three American Sign Language Dataset photographs.

| Component | Licence | Use |
|---|---|---|
| [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) and Google's landmarker models | Apache-2.0 | Loaded from jsDelivr and Google Cloud Storage |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime), [kjua](https://github.com/lrsjng/kjua) | MIT | Loaded from jsDelivr |
| [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) and [Mono](https://github.com/googlefonts/atkinson-hyperlegible-next-mono) | SIL OFL 1.1 | Subset, in `asl-web/assets/fonts/` with the licence |
| [ASL alphabet chart](https://commons.wikimedia.org/wiki/File:Asl_alphabet_gallaudet.svg) by Ds13, from the Gallaudet font (© 1991 David Rakowski), vectorised by Marnanel | Public domain | Cropped as `asl-web/assets/signs/letters.png` |

The video links in `asl-web/data/asl_video_links.json` point to YouTube videos owned by their creators.
