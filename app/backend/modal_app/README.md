# Modal serverless inference

Offloads BirdNET audio analysis, EVA02 species classification, and
MegaDetector filtering from the web container to
[Modal](https://modal.com) serverless functions. Containers scale to zero
when idle and bill per second of use, so a batch that takes hours on the
web container's CPU finishes in minutes on fanned-out workers for well
under a pound.

## One-time setup

1. Create a Modal account (the monthly free credit comfortably covers this
   workload at current volumes).
2. Install the client and authenticate on your machine:

   ```sh
   pip install modal
   modal setup
   ```

3. Deploy the app (re-run after changing `modal_app/` or `services/`):

   ```sh
   make modal-deploy
   ```

   The first deploy builds two images and bakes the model weights into
   them (several GB; takes a while). Subsequent deploys reuse the layers.

4. Create an API token for the backend (`modal token new`, or from the
   Modal dashboard) and set it on the deployed backend:

   ```
   INFERENCE_MODE=modal
   MODAL_TOKEN_ID=ak-...
   MODAL_TOKEN_SECRET=as-...
   ```

   Without `INFERENCE_MODE=modal` everything keeps running locally
   in-process, so dev environments need no Modal account.

## How it works

- The backend's job dispatcher (`services/job_queue.py`) claims pending
  rows as usual; with modal mode on, each job is a network call instead of
  local compute, so job concurrency defaults to 16 instead of 2.
- Stored media is passed by **presigned R2 URL**, wizard uploads as raw
  bytes — Modal holds no R2 or database credentials.
- Results return as plain dicts and are converted back to the local
  service dataclasses in `services/inference.py`; nothing downstream
  changes.
- Modal retries each call twice on failure, on top of the job queue's own
  retry budget.

## Functions

| Function | Model | Resources |
|---|---|---|
| `analyze_audio` | BirdNET 2.4 (TF) | 4 CPUs, 8 GB |
| `classify_image` | EVA02-large iNat21 | T4 GPU |
| `detect_animals` | MegaDetector V6 | T4 GPU |

## Rough costs (June 2026 pricing)

- T4 GPU ≈ $0.59/h, billed per second. EVA02 classifies an image in well
  under a second on a T4 → ~10,000 images ≈ $0.50–1.50 including cold
  starts.
- 4-CPU container ≈ $0.50/h. BirdNET processes a ~1 h recording in a few
  minutes → 100 recordings ≈ $1–2, and they run in parallel.
