# Canopy

Wildlife survey data platform. FastAPI backend, React frontend, PostgreSQL database.

## Quick Start

```bash
make dev          # Start development environment
make down         # Stop all services
```

**Access:**
- Frontend: http://localhost:5173
- API: http://localhost:8000/api/docs

## Accounts

Everything requires a login (viewer / editor / admin roles). A fresh
database has no users, so bootstrap the first admin, then invite everyone
else from **Admin → Users** in the app:

```bash
./run dev create_admin.py --org heal --email you@example.org --first-name You
```

(Use `./run staging …` / `./run prod …` for the hosted environments.)
Without `RESEND_API_KEY` set, invite emails aren't sent — the invite link
is shown in the UI to copy instead.

## Commands

```bash
# Environments
make dev              # Local PostgreSQL
make staging          # Neon staging DB
make prod             # Neon production DB

# Testing
make test-backend     # Run pytest
make test-frontend    # Run vitest
make typecheck        # Run mypy
make check            # Run all tests

# Scripts
./run dev <script.py>      # Run script in dev
./run staging <script.py>  # Run script in staging
./run prod <script.py>     # Run script in prod (requires confirmation)

# Database
make migrate          # Run migrations (dev)
make migrate-staging  # Run migrations (staging)
make migrate-prod     # Run migrations (prod)

# Other
make shell            # Open bash in dev container
make logs             # Tail all logs
make help             # Show all commands
```

## Running Scripts

```bash
./run <env> <script.py> [--build] [args...]
```

Examples:
```bash
./run dev populate_species.py           # Run in dev
./run staging import_data.py --build    # Rebuild container first
./run prod backup_db.py                 # Requires confirmation
```

Available scripts are in `app/backend/scripts/`.

## Database Migrations

```bash
# Apply migrations
make migrate              # Dev
make migrate-staging      # Staging
make migrate-prod         # Production

# Create new migration (in dev container)
make shell
alembic revision --autogenerate -m "description"
exit

# Other alembic commands (in container)
alembic history           # View migration history
alembic downgrade -1      # Rollback one migration
```

## Environment Files

```
.env          # Development (local DB)
.env.staging  # Staging (Neon)
.env.prod     # Production (Neon)
```

## Project Structure

```
app/
├── backend/           # FastAPI REST API
│   ├── routers/       # API endpoints
│   ├── models.py      # SQLModel models
│   ├── scripts/       # Utility scripts
│   └── alembic/       # Migrations
└── frontend/          # React + TypeScript
    └── src/
        ├── pages/
        ├── components/
        └── services/
```

## Tech Stack

- **Backend:** FastAPI, SQLModel, PostgreSQL, Alembic
- **Frontend:** React, TypeScript, Vite
- **Infra:** Docker, Neon (serverless Postgres)
