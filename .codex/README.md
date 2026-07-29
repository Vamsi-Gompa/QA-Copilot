# Codex workspace configuration

This repository is configured for Codex-style agent workflows.

## Goals
- Prefer repository-native instructions over tool-specific setup.
- Keep local runtime artifacts out of source control.
- Support backend and frontend development flows with minimal friction.

## Development
- Backend: run `python -m uvicorn main:app --host 127.0.0.1 --port 8001` from the backend folder.
- Frontend: run `npm run dev` from the frontend folder.

## Notes
- Use the repository files and README as the primary source of truth.
- Do not depend on Claude-specific configuration files.
