# Python SDK — get merchant

Minimal example for the SolvaPay Python binding. Offline `http.server` coverage for `run(...)`; live `.env` is optional.

Install the wheel from this monorepo (or a published PyPI release) before running:

```bash
pip install path/to/solvapay-*.whl
# or: pip install solvapay
```

## Offline test (CI-safe)

```bash
cd examples/python/get-merchant
python -m pytest -q
```

## Setup (live run)

```bash
cp .env.example .env
# Edit .env with your sandbox secret and optional API base URL.
```

## Run

From the example directory:

```bash
python main.py
```
