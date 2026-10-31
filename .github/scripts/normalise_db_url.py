"""Normalise the PROD_SUPABASE_DB_URL secret before handing it to the Supabase CLI.

The CLI refuses ("failed to parse connection string") a URL whose password
isn't URL-safe, and the dashboard hands you a template with `[YOUR-PASSWORD]`
in it. This tolerates the common paste mistakes so the secret works as pasted:
surrounding whitespace, the square brackets left in, and passwords containing
characters that must be percent-encoded (@ : / ? # % etc.).

Reads RAW_DB_URL from the environment. Prints the normalised URL, or with the
argument `password`, just the encoded password (so the workflow can mask it).
Nothing is ever printed on failure except a description of the problem.
"""
import os
import sys
from urllib.parse import quote, unquote


def normalise(raw: str) -> tuple[str, str]:
    raw = raw.strip()
    scheme, sep, rest = raw.partition("://")
    if not sep or scheme not in ("postgres", "postgresql"):
        raise ValueError("it should start with postgresql://")
    # The password may itself contain '@' — the host follows the LAST one.
    userinfo, at, hostpart = rest.rpartition("@")
    user, colon, password = userinfo.partition(":")
    if not at or not colon or not user or not password or not hostpart:
        raise ValueError("it should look like postgresql://USER:PASSWORD@HOST:PORT/postgres")
    if password.startswith("[") and password.endswith("]"):
        password = password[1:-1]
    if "YOUR-PASSWORD" in password:
        raise ValueError("the [YOUR-PASSWORD] placeholder hasn't been replaced")
    # unquote first so an already-encoded password isn't encoded twice.
    encoded = quote(unquote(password), safe="")
    return f"{scheme}://{user}:{encoded}@{hostpart}", encoded


if __name__ == "__main__":
    try:
        url, encoded = normalise(os.environ.get("RAW_DB_URL", ""))
    except ValueError as e:
        print(f"PROD_SUPABASE_DB_URL can't be used: {e}", file=sys.stderr)
        sys.exit(2)
    print(encoded if sys.argv[1:] == ["password"] else url)
