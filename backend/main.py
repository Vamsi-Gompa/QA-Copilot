import os
import ssl
import warnings

# ── Corporate TLS fix: export Windows trust store → PEM bundle ────────────────
# Must run before any SDK imports so REQUESTS_CA_BUNDLE is set in time.
def _export_windows_ca_bundle():
    if not hasattr(ssl, "enum_certificates"):
        return None
    path = os.path.join(os.path.expanduser('~'), 'corp_cacert.pem')
    pem = []
    for store in ('ROOT', 'CA'):
        for cert, encoding, _ in ssl.enum_certificates(store):
            if encoding == 'x509_asn':
                pem.append(ssl.DER_cert_to_PEM_cert(cert))
    with open(path, 'w') as f:
        f.write('\n'.join(pem))
    return path

_bundle = _export_windows_ca_bundle()
if _bundle:
    os.environ['REQUESTS_CA_BUNDLE'] = _bundle
    os.environ['SSL_CERT_FILE'] = _bundle
warnings.filterwarnings("ignore", category=DeprecationWarning)
# ─────────────────────────────────────────────────────────────────────────────

import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv()

from services.storage import init_storage
from routers import stories, codebase, tests, execution, github, dashboard, scan_test, lifecycle
from controllers import claim_controller


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_storage()
    yield


app = FastAPI(
    title="AI QA Copilot",
    description="Automated test generation & execution powered by Anthropic Claude",
    version="1.0.0",
    lifespan=lifespan,
)

origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stories.router, prefix="/api/stories", tags=["Stories"])
app.include_router(codebase.router, prefix="/api/codebase", tags=["Codebase"])
app.include_router(tests.router, prefix="/api/tests", tags=["Tests"])
app.include_router(execution.router, prefix="/api/execution", tags=["Execution"])
app.include_router(github.router, prefix="/api/github", tags=["GitHub"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(scan_test.router, prefix="/api/scan-test", tags=["Scan & Test"])
app.include_router(lifecycle.router, prefix="/api/lifecycles", tags=["Agentic SDLC"])
app.include_router(
    claim_controller.router,
    prefix="/api/claims",
    tags=["Claim Adjudication"],
)

SCREENSHOTS_DIR = Path(__file__).parent / "data" / "screenshots"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/api/screenshots",
    StaticFiles(directory=str(SCREENSHOTS_DIR)),
    name="screenshots",
)


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "AI QA Copilot API"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
