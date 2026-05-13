import os
import json
import time
import logging

logger = logging.getLogger(__name__)

_cache: dict[str, tuple[str, float]] = {}
_CACHE_TTL = 3600  # re-fetch from Secret Manager at most once per hour


def get_secret(secret_id: str) -> str:
    """Return secret value from Google Secret Manager, cached for 1 hour.

    Falls back to an environment variable named SECRET_ID.upper().replace('-', '_')
    so local dev works without GCP credentials.
    """
    now = time.monotonic()
    cached = _cache.get(secret_id)
    if cached and now < cached[1]:
        return cached[0]

    project_id = os.environ.get("GCP_PROJECT_ID")
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")

    if project_id:
        try:
            value = _fetch(secret_id, project_id, creds_json)
            _cache[secret_id] = (value, now + _CACHE_TTL)
            logger.info("Loaded secret %s from Secret Manager", secret_id)
            return value
        except Exception as exc:
            logger.warning("Secret Manager fetch failed for %s: %s", secret_id, exc)

    # Local / fallback: read from environment variable
    env_key = secret_id.upper().replace("-", "_")
    value = os.environ.get(env_key, "")
    if not value:
        raise RuntimeError(
            f"Secret '{secret_id}' not found in Secret Manager or env var {env_key}"
        )
    return value


def _fetch(secret_id: str, project_id: str, creds_json: str | None) -> str:
    from google.cloud import secretmanager  # imported lazily — not installed locally

    if creds_json:
        from google.oauth2 import service_account
        creds = service_account.Credentials.from_service_account_info(
            json.loads(creds_json),
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        client = secretmanager.SecretManagerServiceClient(credentials=creds)
    else:
        client = secretmanager.SecretManagerServiceClient()

    name = f"projects/{project_id}/secrets/{secret_id}/versions/latest"
    response = client.access_secret_version(request={"name": name})
    return response.payload.data.decode("UTF-8").strip()
