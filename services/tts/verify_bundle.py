"""Validate a local deployment inventory. Does NOT certify offline inference."""
import hashlib
import json
import re
from pathlib import Path

REQUIRED_ROLES = {"source", "weights", "tokenizer_codec", "config", "dependency_lock", "dependency_package", "license", "runtime"}


def verify_bundle(root: Path, manifest_path: Path) -> dict:
    root = root.resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source = manifest.get("source", {})
    if not (re.fullmatch(r"[a-fA-F0-9]{40}", source.get("commit", "")) or
            (source.get("package") and source.get("version") and not any(c in source["version"] for c in "*<>~^"))):
        raise ValueError("Source must have an exact commit or package version")
    if not manifest.get("target_platform") or not manifest.get("python_version"):
        raise ValueError("Target platform and Python version are required")
    artifacts = manifest.get("artifacts", [])
    roles, paths = set(), set()
    for artifact in artifacts:
        relative = Path(artifact["path"])
        if relative.is_absolute() or ".." in relative.parts or relative.as_posix() in paths:
            raise ValueError("Invalid or duplicate artifact path")
        path = root / relative
        if any(part.is_symlink() for part in [path, *path.parents] if part != root):
            raise ValueError("Artifact symlinks are not allowed")
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(root) or not resolved.is_file():
            raise ValueError("Artifact must be a file inside the bundle")
        expected = artifact.get("sha256", "")
        if not re.fullmatch(r"[a-fA-F0-9]{64}", expected):
            raise ValueError("Invalid SHA256")
        digest = hashlib.sha256()
        with resolved.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected.lower():
            raise ValueError(f"Checksum mismatch: {relative}")
        if not artifact.get("license_path") or not artifact.get("origin"):
            raise ValueError("Each artifact requires provenance and a local license path")
        paths.add(relative.as_posix())
        roles.add(artifact["role"])
    if REQUIRED_ROLES - roles:
        raise ValueError(f"Missing artifact roles: {sorted(REQUIRED_ROLES - roles)}")
    for artifact in artifacts:
        if Path(artifact["license_path"]).as_posix() not in paths:
            raise ValueError("License must itself be inventoried and checksummed")
    return {"inventory_verified": True, "artifact_count": len(paths), "offline_inference_verified": False}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    print(json.dumps(verify_bundle(args.bundle, args.manifest)))
