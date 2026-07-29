"""
Unified LLM service.

Provider selection: an explicit LLM_PROVIDER wins. When LLM_PROVIDER is not set,
Anthropic Claude is preferred whenever ANTHROPIC_API_KEY is configured; otherwise
the service falls back to the OpenAI-compatible providers (Gemini / Groq / ...).

Usage:
  - call_parallel(messages)       → Claude (single call) OR Groq + Gemini, merge JSON arrays
  - call_with_retry(client, ...)  → one completion; accepts an Anthropic or AsyncOpenAI client
  - get_client(provider)          → Claude client when enabled, else AsyncOpenAI for a provider
  - call_vision(prompt, images)   → multimodal extraction (Claude when enabled, else Gemini)
"""
import os
import asyncio
import re
import json
import logging
import httpx
from openai import AsyncOpenAI, RateLimitError, APIConnectionError

# Anthropic SDK is only required when ANTHROPIC_API_KEY is configured.
try:
    from anthropic import (
        AsyncAnthropic,
        DefaultAsyncHttpxClient,
        APIStatusError as AnthropicAPIStatusError,
        RateLimitError as AnthropicRateLimitError,
    )
except ImportError:  # pragma: no cover - exercised only when the package is absent
    AsyncAnthropic = None            # type: ignore
    DefaultAsyncHttpxClient = None   # type: ignore
    AnthropicAPIStatusError = AnthropicRateLimitError = Exception  # type: ignore

logger = logging.getLogger("llm")

# ── Anthropic Claude (preferred whenever a key is present) ────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
# Default to the most capable model; override with ANTHROPIC_MODEL in .env if needed.
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-4-8")
_anthropic_singleton = None


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


ANTHROPIC_GENERATION_TIMEOUT = _env_float("ANTHROPIC_GENERATION_TIMEOUT_SECONDS", 180.0)


_RAW_LLM_PROVIDER = os.getenv("LLM_PROVIDER")
LLM_PROVIDER = (_RAW_LLM_PROVIDER or "groq").lower()


def _trust_env_proxies() -> bool:
    """Avoid inherited dead proxies unless explicitly enabled for LLM calls."""
    return os.getenv("LLM_TRUST_ENV_PROXY", "").lower() in ("1", "true", "yes")


def _verify_setting():
    ca = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
    if ca and os.path.exists(ca):
        return ca
    return True


def anthropic_enabled(provider: str | None = None) -> bool:
    """Claude is active when explicitly selected, or as the no-provider default."""
    if not ANTHROPIC_API_KEY:
        return False
    selected = (provider or _RAW_LLM_PROVIDER or "").lower()
    return selected in ("", "anthropic", "claude")


# ── Active provider (default: groq) ──────────────────────────────────────────
_DEFAULT_MODELS = {
    "groq":       "llama-3.3-70b-versatile",
    "together":   "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "openrouter": "meta-llama/llama-3.3-70b-instruct:free",
    "gemini":     "gemini-2.5-flash",
    "ollama":     "qwen2.5-coder:7b",
}

MODEL = os.getenv("LLM_MODEL", _DEFAULT_MODELS.get(LLM_PROVIDER, "llama-3.3-70b-versatile"))

# ── SSL: pass corporate CA bundle into httpx so openai SDK respects it ────────
def _ssl_client() -> httpx.AsyncClient | None:
    verify = _verify_setting()
    timeout = httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=10.0)
    if isinstance(verify, str):
        logger.info("Using CA bundle: %s", verify)
    return httpx.AsyncClient(verify=verify, timeout=timeout, trust_env=_trust_env_proxies())


# ── Anthropic helpers ─────────────────────────────────────────────────────────
def _anthropic_client() -> "AsyncAnthropic":
    """Cached AsyncAnthropic client, corporate-CA-bundle aware (Zscaler/Fortigate)."""
    global _anthropic_singleton
    if _anthropic_singleton is not None:
        return _anthropic_singleton
    if AsyncAnthropic is None:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is set but the 'anthropic' package is not installed — "
            "run: pip install anthropic"
        )
    verify = _verify_setting()
    timeout = httpx.Timeout(connect=15.0, read=240.0, write=30.0, pool=10.0)
    kw = {
        "timeout": timeout,
        "http_client": httpx.AsyncClient(
            verify=verify,
            timeout=timeout,
            trust_env=_trust_env_proxies(),
        ),
    }
    if isinstance(verify, str):
        logger.info("Anthropic using CA bundle: %s", verify)
    _anthropic_singleton = AsyncAnthropic(api_key=ANTHROPIC_API_KEY, **kw)
    return _anthropic_singleton


def _split_system(messages: list) -> tuple[list, list]:
    """OpenAI-style messages → (cacheable system blocks, user/assistant turns).

    Anthropic takes the system prompt as a top-level parameter, not a message role.
    The system prompt is marked cacheable — it's large and reused across calls.
    """
    system_text = "\n\n".join(
        (m.get("content") or "") for m in messages if m.get("role") == "system"
    ).strip()
    system_blocks = (
        [{"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}]
        if system_text else []
    )
    convo = [
        {"role": m["role"], "content": m.get("content") or ""}
        for m in messages if m.get("role") in ("user", "assistant")
    ]
    if not convo:  # Anthropic requires at least one user turn
        convo = [{"role": "user", "content": system_text or "Continue."}]
    return system_blocks, convo


def _anthropic_text(message) -> str:
    """Join visible text blocks from a Message, ignoring thinking blocks."""
    return "".join(b.text for b in message.content if getattr(b, "type", "") == "text")


def _anthropic_error(e: Exception) -> str:
    """Map an Anthropic SDK exception to a reason string the agents can classify."""
    if isinstance(e, asyncio.TimeoutError):
        return (
            f"anthropic/{ANTHROPIC_MODEL}: timed out after "
            f"{ANTHROPIC_GENERATION_TIMEOUT:.0f}s"
        )
    if isinstance(e, AnthropicRateLimitError):
        return f"anthropic/{ANTHROPIC_MODEL}: rate limited (429) — wait and retry"
    if isinstance(e, AnthropicAPIStatusError):
        code = getattr(e, "status_code", "")
        if code == 401:
            return "anthropic: invalid API key (401) — check ANTHROPIC_API_KEY in backend/.env"
        return f"anthropic/{ANTHROPIC_MODEL}: API error {code}: {str(e)[:120]}"
    return f"anthropic/{ANTHROPIC_MODEL}: {type(e).__name__}: {str(e)[:120]}"


async def _anthropic_message(messages: list, *, max_tokens: int) -> str:
    """One Claude completion. Streams (avoids HTTP timeouts) with adaptive thinking.

    Sampling params (temperature/top_p) are intentionally omitted — they are not
    accepted on Opus 4.x. Extra headroom over the caller's max_tokens leaves room
    for thinking so the JSON answer is never truncated.
    """
    client = _anthropic_client()
    system_blocks, convo = _split_system(messages)
    kwargs = dict(
        model=ANTHROPIC_MODEL,
        max_tokens=min(12000, max(max_tokens, 4096) + 2048),
        messages=convo,
    )
    if os.getenv("ANTHROPIC_THINKING", "0").lower() in ("1", "true", "yes"):
        kwargs["thinking"] = {"type": "adaptive"}
    if system_blocks:
        kwargs["system"] = system_blocks
    async with client.messages.stream(**kwargs) as stream:
        final = await stream.get_final_message()
    text = _anthropic_text(final)
    logger.info("[anthropic/%s] got %d chars", ANTHROPIC_MODEL, len(text))
    return text


class _OpenAIShape:
    """Adapter so Claude responses expose `.choices[0].message.content` like AsyncOpenAI."""
    def __init__(self, text: str):
        msg = type("Msg", (), {"content": text})()
        self.choices = [type("Choice", (), {"message": msg})()]


def get_client(provider: str | None = None):
    """Return an LLM client.

    With no explicit provider, prefer Anthropic Claude when ANTHROPIC_API_KEY is set;
    otherwise return an AsyncOpenAI client for the given/configured provider.
    """
    if provider is None and anthropic_enabled():
        return _anthropic_client()
    p = (provider or LLM_PROVIDER).lower()
    if p in ("anthropic", "claude"):
        return _anthropic_client()
    ssl = _ssl_client()
    kw = dict(http_client=ssl) if ssl else {}

    if p == "groq":
        key = os.getenv("GROQ_API_KEY", "")
        if not key:
            raise RuntimeError("GROQ_API_KEY missing — add it to backend/.env")
        return AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=key, **kw)

    elif p == "gemini":
        key = os.getenv("GEMINI_API_KEY", "")
        return AsyncOpenAI(
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            api_key=key, **kw,
        )

    elif p == "together":
        key = os.getenv("TOGETHER_API_KEY", "")
        return AsyncOpenAI(base_url="https://api.together.xyz/v1", api_key=key, **kw)

    elif p == "openrouter":
        key = os.getenv("OPENROUTER_API_KEY", "")
        return AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1", api_key=key,
            default_headers={"HTTP-Referer": "http://localhost:5200", "X-Title": "QA-Copilot"},
            **kw,
        )

    elif p == "ollama":
        base = os.getenv("OLLAMA_URL", "http://localhost:11434/v1")
        return AsyncOpenAI(base_url=base, api_key="ollama", **kw)

    raise ValueError(f"Unknown provider: {p!r}")


def _model_for(provider: str) -> str:
    return os.getenv("LLM_MODEL", _DEFAULT_MODELS.get(provider, "llama-3.3-70b-versatile"))


def provider_label(provider: str | None = None) -> str:
    if anthropic_enabled(provider):
        return f"Anthropic / {ANTHROPIC_MODEL}"
    p = provider or LLM_PROVIDER
    m = _model_for(p)
    return f"{p.capitalize()} / {m}"


# ── Single call with retry ────────────────────────────────────────────────────
_CONN_ERRORS = (
    "Connection aborted", "Connection reset", "forcibly closed",
    "ConnectionResetError", "RemoteDisconnected", "BrokenPipe", "10054",
    "Connection error", "connect timeout", "ConnectTimeout", "ReadTimeout",
    "ECONNREFUSED", "ETIMEDOUT", "timed out",
)


async def call_with_retry(client, *, messages, provider: str | None = None,
                          max_retries: int = 4, **kwargs) -> object:
    # Anthropic client → native call (SDK handles retries/backoff itself).
    if AsyncAnthropic is not None and isinstance(client, AsyncAnthropic):
        text = await _anthropic_message(messages, max_tokens=kwargs.get("max_tokens", 4096))
        return _OpenAIShape(text)

    model = _model_for(provider or LLM_PROVIDER)
    delay = 3.0
    last_exc = None
    for attempt in range(max_retries):
        try:
            return await client.chat.completions.create(model=model, messages=messages, **kwargs)
        except RateLimitError as exc:
            wait = _parse_retry_after(str(exc))
            if attempt < max_retries - 1:
                logger.warning("[%s] rate limited, retrying in %.0fs", provider, max(wait, delay))
                await asyncio.sleep(max(wait, delay))
                delay = min(delay * 2, 30.0)
                last_exc = exc
                continue
            raise
        except APIConnectionError as exc:
            # Always retry connection errors (SSL handshake, proxy timeout, etc.)
            if attempt < max_retries - 1:
                logger.warning("[%s] connection error (attempt %d/%d): %s", provider, attempt+1, max_retries, str(exc)[:120])
                await asyncio.sleep(delay)
                delay = min(delay * 2, 20.0)
                last_exc = exc
                continue
            raise
        except Exception as exc:
            if any(k in str(exc) for k in _CONN_ERRORS) and attempt < max_retries - 1:
                logger.warning("[%s] transient error (attempt %d/%d): %s", provider, attempt+1, max_retries, str(exc)[:120])
                last_exc = exc
                await asyncio.sleep(delay)
                delay = min(delay * 2, 20.0)
                continue
            raise
    raise last_exc


def _parse_retry_after(text: str) -> float:
    m = re.search(r'retry[_ ](?:in|after)[^\d]*(\d+(?:\.\d+)?)', text, re.I)
    return float(m.group(1)) + 1.0 if m else 5.0


async def _call_openai_provider(provider: str, messages: list, *,
                                max_tokens: int, temperature: float) -> tuple[str | None, str | None]:
    """Small fallback call used when the selected Anthropic call times out."""
    try:
        client = get_client(provider)
        resp = await call_with_retry(
            client,
            messages=messages,
            provider=provider,
            temperature=temperature,
            max_tokens=max_tokens,
            max_retries=2,
        )
        text = resp.choices[0].message.content or ""
        logger.info("[%s/%s fallback] got %d chars", provider, _model_for(provider), len(text))
        if text.strip().startswith("<") or "<!DOCTYPE" in text[:50]:
            return None, f"{provider}: blocked by corporate proxy (HTML response)"
        return text, None
    except Exception as e:
        err = str(e)
        if "429" in err or "quota" in err.lower() or "rate" in err.lower():
            return None, f"{provider}/{_model_for(provider)}: quota exceeded (429)"
        if "401" in err or "Unauthorized" in err:
            return None, f"{provider}: invalid API key (401)"
        if "Connection" in err or "timeout" in err.lower() or "ReadTimeout" in err:
            return None, f"{provider}: connection timeout"
        return None, f"{provider}: {type(e).__name__}: {err[:100]}"


# ── Parallel call: Groq + Gemini simultaneously (falls back gracefully) ───────
async def call_parallel(messages: list, max_tokens: int = 8192,
                        temperature: float = 0.2) -> tuple[str | None, str | None, list]:
    """
    If ANTHROPIC_API_KEY is set, makes ONE Claude call and returns (claude_text, None, errors).
    Otherwise tries Groq + Gemini in parallel.
    If Groq is blocked by corporate proxy, returns (None, gemini_text).
    If only Gemini available, runs two Gemini calls at temp/temp+0.15 for diversity.
    """
    # Anthropic Claude when selected, or as the legacy default when no provider is set.
    if anthropic_enabled():
        try:
            text = await asyncio.wait_for(
                _anthropic_message(messages, max_tokens=max_tokens),
                timeout=ANTHROPIC_GENERATION_TIMEOUT,
            )
            return text, None, []
        except Exception as e:
            reason = _anthropic_error(e)
            logger.error("[anthropic] %s", reason)
            errors = [reason]
            fallback_max = min(max_tokens, 4096)
            for provider, key_name in (("gemini", "GEMINI_API_KEY"), ("groq", "GROQ_API_KEY")):
                if not os.getenv(key_name, ""):
                    continue
                text, err = await _call_openai_provider(
                    provider,
                    messages,
                    max_tokens=fallback_max,
                    temperature=temperature,
                )
                if text:
                    return text, None, errors
                if err:
                    errors.append(err)
            return None, None, errors

    groq_key   = os.getenv("GROQ_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")

    # Gemini model fallback chain — only models supported by the OpenAI-compatible endpoint
    # (gemini-1.5-flash and gemini-1.5-flash-8b return 404 on v1beta/openai)
    _GEMINI_FALLBACKS = ["gemini-2.0-flash", "gemini-2.5-flash-lite-preview-06-17"]

    async def _call(provider: str, temp: float) -> tuple[str | None, str | None]:
        """Returns (text_or_none, error_reason_or_none)."""
        models_to_try = [None]  # None = use configured model
        if provider == "gemini":
            models_to_try += _GEMINI_FALLBACKS  # auto-fallback on quota

        last_reason = None
        for fallback_model in models_to_try:
            try:
                client = get_client(provider)
                if fallback_model:
                    # Temporarily override model for this call
                    original = os.environ.get("LLM_MODEL")
                    os.environ["LLM_MODEL"] = fallback_model
                try:
                    resp = await call_with_retry(
                        client, messages=messages, provider=provider,
                        temperature=temp, max_tokens=max_tokens,
                    )
                finally:
                    if fallback_model:
                        if original is not None:
                            os.environ["LLM_MODEL"] = original
                        else:
                            os.environ.pop("LLM_MODEL", None)

                text = resp.choices[0].message.content or ""
                model_used = fallback_model or _model_for(provider)
                logger.info("[%s/%s] got %d chars", provider, model_used, len(text))
                if text.strip().startswith("<") or "<!DOCTYPE" in text[:50]:
                    logger.warning("[%s] blocked by proxy (HTML response)", provider)
                    return None, f"{provider}: blocked by corporate proxy (Zscaler/Fortigate)"
                return text, None

            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "quota" in err_str.lower() or "rate" in err_str.lower():
                    model_name = fallback_model or _model_for(provider)
                    last_reason = f"{provider}/{model_name}: quota exceeded (429) — trying fallback model"
                    logger.warning("[%s] %s", provider, last_reason)
                    continue  # Try next model in fallback chain
                elif "401" in err_str or "Unauthorized" in err_str:
                    last_reason = f"{provider}: invalid API key (401)"
                elif "<!DOCTYPE" in err_str[:100] or "Zscaler" in err_str or "PermissionDenied" in err_str:
                    last_reason = f"{provider}: blocked by corporate proxy"
                elif "Connection" in err_str or "timeout" in err_str.lower():
                    last_reason = f"{provider}: connection error"
                else:
                    last_reason = f"{provider}: {type(e).__name__}: {err_str[:100]}"
                logger.error("[%s] %s", provider, last_reason)
                return None, last_reason

        # All fallbacks exhausted
        final_reason = (last_reason or f"{provider}: all models quota exceeded").replace("— trying fallback model", "— all models quota exceeded")
        return None, final_reason

    # Explicit provider selection should make exactly one provider call.
    if _RAW_LLM_PROVIDER and LLM_PROVIDER not in ("anthropic", "claude"):
        t1, e1 = await _call(LLM_PROVIDER, temperature)
        return t1, None, ([e1] if e1 else [])

    # Strategy: try Groq + Gemini in parallel.
    # If only one provider works → use that single response (no wasted 2nd call).
    # This conserves quota: one comprehensive prompt = one LLM call.
    if groq_key and gemini_key:
        (t1, e1), (t2, e2) = await asyncio.gather(
            _call("groq",   temperature),
            _call("gemini", temperature),
        )
        errors = [e for e in (e1, e2) if e]
        return t1, t2, errors

    # Single provider — one call only
    if gemini_key:
        t1, e1 = await _call("gemini", temperature)
        return t1, None, ([e1] if e1 else [])

    if groq_key:
        t1, e1 = await _call("groq", temperature)
        return t1, None, ([e1] if e1 else [])

    return None, None, ["No API keys configured — add GEMINI_API_KEY or GROQ_API_KEY to .env"]


# ── Vision call: extract text/requirements from images (Gemini) ───────────────
# Gemini flash/pro models are multimodal via the OpenAI-compatible endpoint.
_VISION_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite-preview-06-17"]


def _image_block(url: str) -> dict | None:
    """Convert a data: URL (or http URL) into an Anthropic image content block."""
    m = re.match(r"data:(?P<mime>[^;]+);base64,(?P<data>.+)", url, re.DOTALL)
    if m:
        return {"type": "image", "source": {
            "type": "base64", "media_type": m.group("mime"), "data": m.group("data"),
        }}
    if url.startswith("http"):
        return {"type": "image", "source": {"type": "url", "url": url}}
    return None


async def _anthropic_vision(prompt: str, images: list[str], *,
                            max_tokens: int) -> tuple[str | None, str | None]:
    """Claude is multimodal — extract text/requirements from images natively."""
    client = _anthropic_client()
    content: list[dict] = [b for b in (_image_block(u) for u in images) if b]
    if not content:
        return None, None
    content.append({"type": "text", "text": prompt})
    try:
        async with client.messages.stream(
            model=ANTHROPIC_MODEL,
            max_tokens=min(64000, max(max_tokens, 4096) + 8000),
            thinking={"type": "adaptive"},
            messages=[{"role": "user", "content": content}],
        ) as stream:
            final = await stream.get_final_message()
        text = _anthropic_text(final)
        logger.info("[anthropic/%s] vision extracted %d chars from %d image(s)",
                    ANTHROPIC_MODEL, len(text), len(images))
        return text, None
    except Exception as e:
        reason = _anthropic_error(e)
        logger.error("[anthropic vision] %s", reason)
        return None, reason


async def call_vision(prompt: str, images: list[str], *,
                      max_tokens: int = 4096, temperature: float = 0.1) -> tuple[str | None, str | None]:
    """
    Send a text prompt + one or more images (data: URLs) to a vision-capable model.
    Returns (text_or_none, error_reason_or_none).
    Uses Claude when ANTHROPIC_API_KEY is set, otherwise Gemini (needs GEMINI_API_KEY).
    """
    if not images:
        return None, None
    if anthropic_enabled():
        return await _anthropic_vision(prompt, images, max_tokens=max_tokens)
    if not os.getenv("GEMINI_API_KEY", ""):
        return None, "Image extraction needs a GEMINI_API_KEY (vision-capable model) in backend/.env"

    content: list[dict] = [{"type": "text", "text": prompt}]
    for url in images:
        content.append({"type": "image_url", "image_url": {"url": url}})
    messages = [{"role": "user", "content": content}]

    last_reason = None
    for model in _VISION_MODELS:
        try:
            client = get_client("gemini")
            resp = await client.chat.completions.create(
                model=model, messages=messages,
                temperature=temperature, max_tokens=max_tokens,
            )
            text = resp.choices[0].message.content or ""
            logger.info("[vision/%s] extracted %d chars from %d image(s)", model, len(text), len(images))
            if text.strip().startswith("<") or "<!DOCTYPE" in text[:50]:
                return None, "vision: blocked by corporate proxy"
            return text, None
        except Exception as e:
            err = str(e)
            if "429" in err or "quota" in err.lower() or "rate" in err.lower():
                last_reason = f"vision/{model}: quota exceeded (429) — trying fallback model"
                logger.warning("[vision] %s", last_reason)
                continue
            last_reason = f"vision/{model}: {type(e).__name__}: {err[:120]}"
            logger.error("[vision] %s", last_reason)
            return None, last_reason
    return None, (last_reason or "vision: all models failed")


# ── JSON object parser (strips markdown fences) ──────────────────────────────
def parse_json_object(text: str | None) -> dict:
    """Parse a single JSON object from LLM output. Returns {} on failure."""
    if not text:
        return {}
    text = re.sub(r'^```(?:json)?\s*', '', text.strip(), flags=re.IGNORECASE)
    text = re.sub(r'\s*```\s*$', '', text)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    m = re.search(r'\{.*\}', text, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group())
    except json.JSONDecodeError:
        return {}


# ── JSON array parser (strips markdown fences) ───────────────────────────────
def parse_json_array(text: str | None) -> list:
    if not text:
        return []
    # Strip ```json ... ``` fences
    text = re.sub(r'^```(?:json)?\s*', '', text.strip(), flags=re.IGNORECASE)
    text = re.sub(r'\s*```\s*$', '', text)

    # Some models wrap the array as {"tests": [...]} or {"test_cases": [...]}.
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            for key in ("tests", "test_cases", "cases", "data"):
                value = parsed.get(key)
                if isinstance(value, list):
                    return value
    except json.JSONDecodeError:
        pass

    # Find first [...] block
    m = re.search(r'\[.*\]', text, re.DOTALL)
    if not m:
        return []
    try:
        return json.loads(m.group())
    except json.JSONDecodeError:
        # Try to recover truncated JSON
        try:
            partial = m.group().rstrip(',').rstrip()
            if not partial.endswith(']'):
                partial += ']'
            return json.loads(partial)
        except Exception:
            return []
