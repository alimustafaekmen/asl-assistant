# Changelog

This file records changes that matter to people who use, deploy or build on the
project. Day-to-day work notes are not kept here; `git log` has them.

## Unreleased

### Web application

Interface

- Redesigned the interface in stages: a new shell, camera stage, caption plate,
  transcript strip and action bar, light and dark themes, self-hosted
  Atkinson Hyperlegible fonts (SIL Open Font License), and layouts for phone,
  phone landscape and laptop. Some screens still use the earlier styling.
- The theme follows the system setting until the visitor picks one; the choice
  is remembered, and it is applied before the first paint.
- Removed the separate home screen. The brand link opens letter mode, and an
  empty camera stage explains the app.
- Moved interface text toward plain Turkish in the formal *siz* form.
- Keyboard: Space adds the current letter, Enter adds a space and Backspace
  removes the last character, in letter mode only. The single-letter shortcuts
  are gone, Cmd+C no longer clears the transcript, and shortcuts no longer fire
  while a form control has focus.
- Clearing the transcript shows a toast with an Undo action.
- Camera problems (permission refused, no camera, insecure page, camera lost)
  now explain themselves and offer a retry and help.
- Accessibility: one `h1` per screen, landmarks, a skip link, a document title
  per screen, focus moved to the new heading on navigation, and live-region
  announcements for camera and download problems.
- Percentages use the Turkish decimal comma. The phone menu also works in
  browsers without the Popover API.
- Replaced the sign reference images: a new alphabet chart, five word pages for
  the 50-word web model, and a page for the desktop app's 25 words.
- Added a favicon, a page description and a link preview image. The camera
  placeholder says that the image stays on the device.

Camera and word mode

- Models download when they are first needed (camera start, a word recording,
  the offline check, a Model Test run), not on every page open. The letter
  model is served gzip-compressed (about 2 MB instead of 13 MB), with a
  fallback to the uncompressed file.
- Leaving a camera screen for Model Test, QR demo, Project or the brand link
  now stops the camera. A stop during the permission prompt or MediaPipe
  start-up cancels that start, and a track the browser ends is released.
- A word recording that cannot fill ends on its own: when no usable frame
  arrives, when frames stop arriving, or when it runs too long. It is also
  abandoned when the page is hidden.
- An accepted word is appended once. A result from an abandoned or older
  recording can no longer be accepted, and starting a recording or a failed run
  clears the previous word. Results below the accept threshold read as
  uncertain, and a close top two reads as a close call.
- A word frame is buffered once per MediaPipe timestamp, and the letter
  landmark smoother resets when the hand is lost, the camera stops or the mode
  changes.

Other screens

- Model Test can run every sample of a kind and sum the results. Made-up and
  local samples are left out of the accuracy summary, and a word sample with no
  real frame is refused.
- QR demo draws the code with a scannable quiet zone and unthemed colours, shows
  the link when the code cannot be drawn, reports the real result of copying,
  and offers the system share sheet where there is one.

### Security and deployment

- Pinned the MediaPipe landmark models to a fixed version instead of `latest`.
- Added Subresource Integrity to the CDN scripts.
- Added response headers (`nosniff`, a camera-only permissions policy, framing
  denial, a referrer policy) and a report-only Content Security Policy.
- Moved the demo to <https://asl-assistant.netlify.app/> and documented the
  manual deploy.
- The 50 Model Test word fixtures derived from the competition data are no
  longer published. The export script writes them to an ignored `local/` folder,
  and `make deploy-check` refuses an upload that contains it.

### Tooling and validation

- Added `make check`, `make deploy-check`, `make browser-check`, `make parity`,
  `make quick`, `make test-web`, `make watch-web` and `make test-py`.
- `tests/browser/` runs facts about the page that need a real browser (cascade
  layers, hidden elements, dark theme, overflow, camera release) in headless
  Chrome, with no npm dependency.
- The web tests now boot the real page markup and `init()`. New behavioural
  tests cover word consent, the mask polarity, frame order and camera release,
  and Python goldens pin the 93D letter and 168D word features.
- The runtime asset check now reports an unimportable ONNX Runtime as unverified
  (exit 2) instead of safe, checks the word model's tensor types, and fails when
  a provenance source is missing. The parity commands share one exit-code
  contract: 0 equal, 1 mismatch, 2 could not run.
- Node and the full JavaScript syntax check are mandatory in the health gate.
- A Git hygiene check fails when ignored files are tracked. Validation also
  fails when the compressed letter model drifts from the deployed model, or when
  a page link does not resolve.
- Dependency installs into a shared Conda base environment are blocked, and the
  exact requirement pins match the package metadata.

### Documentation and repository

- Public documentation is a flat set of documents under `docs/` with an index,
  plus a Turkish getting-started guide and a README for each component.
- Setup paths for web-only use, Conda and `venv`, with Python 3.12 and Node 24
  as the development contract, a portable `environment.yml` and a
  `.node-version` file. No personal environment name is required.
- Licence: PolyForm Noncommercial 1.0.0, replacing the earlier MIT declaration.
- Added the project journey (desktop 25-word phase, 50-word web model, unused
  approaches, results, engineering fixes) with research context and
  limitations.
- Consolidated the letter and word artifacts under `models/` and replaced the
  duplicate word notebooks with clearly named 25- and 50-class records.
- Renamed event-specific fixture paths and commands to `model-test-samples` and
  `model-test-fixtures`.

### Maintenance

- Matched the desktop letter artifact to scikit-learn 1.8.0.
- The desktop personalization profile is saved once per completed calibration
  batch, not once per captured frame.
- Removed unused browser state, compatibility branches and a runtime request
  for curriculum data; the Kjua QR path stays.

## 0.1.0 — 2026

### Web application

- Letter translation, learning coach, experimental word practice, a
  deterministic Model Test and a QR demo.
- LightGBM and SignTransformer models served through ONNX Runtime Web.
- MediaPipe hand, pose and face landmarks.
- Mode-specific confidence handling, top-3 word output, confusion hints, coach
  progress tracking, and speech output.

### Model and data contracts

- The 93D letter and 45×168 word feature contracts.
- The word padding mask is `true` for a real frame.
- A tensor-probability letter export, compatible with ONNX Runtime Web,
  replaced the ZipMap export.
- Deterministic fixtures and provenance hashes for the deployed artifacts.

### Project structure

- Separated the browser product, shared Python helpers, desktop prototype,
  model provenance, training notebooks, scripts, tests and docs.
- Make targets for setup, serving, validation, tests, fixture export and
  repository health checks.
