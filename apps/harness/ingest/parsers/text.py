"""Plain text / code / markdown / CSV / JSON / YAML / HTML parser."""
from __future__ import annotations

# Extensions handled as plain text (returned as-is or lightly processed)
TEXT_EXTENSIONS = {
    "txt", "md", "markdown", "csv", "json", "jsonl",
    "yaml", "yml", "toml", "ini", "cfg", "conf",
    "html", "htm", "xml", "svg",
    "py", "ts", "tsx", "js", "jsx", "go", "rs", "java", "rb", "rb",
    "sh", "bash", "zsh", "fish", "ps1",
    "c", "cpp", "h", "hpp", "cs", "swift", "kt", "dart",
    "sql", "graphql", "gql",
    "css", "scss", "sass", "less",
    "diff", "patch", "log",
    "env", "gitignore", "dockerignore",
    "r", "m", "ipynb",
}


def extract(content_bytes: bytes, filename: str = "", mime_type: str = "") -> str:
    """Decode bytes as UTF-8 text. Returns the raw content."""
    try:
        text = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = content_bytes.decode("latin-1")
        except Exception:
            return "[Could not decode file as text]"

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    # Wrap code files in fenced block for readability when injected into prompts
    code_exts = {
        "py", "ts", "tsx", "js", "jsx", "go", "rs", "java", "rb",
        "sh", "bash", "c", "cpp", "h", "cs", "swift", "kt", "sql",
        "css", "scss", "graphql", "diff", "patch",
    }
    if ext in code_exts:
        return f"```{ext}\n{text}\n```"

    return text
