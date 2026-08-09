#!/usr/bin/env python3
"""Safely bring an official branch into a fork while preserving fork-owned work.

The script intentionally does not auto-resolve overlapping files.  It makes the
comparison reproducible, records the overlap policy, and only starts Git's
three-way merge after a clean dry-run has shown the exact reconciliation set.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path


OFFICIAL_URL = "https://github.com/shinshin86/aituber-onair.git"
OFFICIAL_REF = "refs/remotes/upstream/main"


@dataclass(frozen=True)
class Change:
    status: str
    path: str


def run_git(repo: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and result.returncode:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout


def changed_paths(repo: Path, revision_range: str) -> set[Change]:
    output = run_git(repo, "diff", "--name-status", "-M", revision_range)
    changes: set[Change] = set()
    for line in output.splitlines():
        fields = line.split("\t")
        if not fields:
            continue
        status = fields[0]
        for path in fields[1:]:
            changes.add(Change(status=status, path=path))
    return changes


def status_by_path(changes: Iterable[Change]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for change in changes:
        result.setdefault(change.path, []).append(change.status)
    return result


def policy_for(path: str) -> str:
    if path.startswith("packages/core/examples/react-fbx-app/"):
        return "preserve_fork_extension"
    if path == ".github/workflows/ci.yml":
        return "combine_official_ci_with_fork_fbx_typecheck"
    if path in {"README.md", "README_ja.md", "docs/examples.md", "docs/examples.ja.md"}:
        return "use_official_structure_then_retain_fbx_documentation"
    if path in {"package.json", "package-lock.json", "packages/core/package.json"}:
        return "use_official_dependencies_then_retain_fbx_workspace_metadata"
    return "manual_reconciliation_required"


def require_clean_worktree(repo: Path) -> None:
    status = run_git(repo, "status", "--porcelain")
    ignored_generated_entries = {"?? scripts/__pycache__/"}
    unexpected_entries = [
        line for line in status.splitlines() if line not in ignored_generated_entries
    ]
    if unexpected_entries:
        raise RuntimeError(
            "target worktree is not clean; commit or stash its changes before "
            "an upstream merge"
        )


def fetch_official(repo: Path, source: str) -> None:
    run_git(repo, "fetch", source, f"+refs/heads/main:{OFFICIAL_REF}")


def resolve_revision(repo: Path, revision: str) -> str:
    return run_git(repo, "rev-parse", "--verify", f"{revision}^{{commit}}").strip()


def make_report(repo: Path, target: str, official: str) -> dict[str, object]:
    target_sha = resolve_revision(repo, target)
    official_sha = resolve_revision(repo, official)
    base = run_git(repo, "merge-base", target_sha, official_sha).strip()
    fork_changes = status_by_path(changed_paths(repo, f"{base}..{target_sha}"))
    official_changes = status_by_path(changed_paths(repo, f"{base}..{official_sha}"))
    fork_paths = set(fork_changes)
    official_paths = set(official_changes)
    overlaps = sorted(fork_paths & official_paths)

    return {
        "target": {"revision": target, "sha": target_sha},
        "official": {"revision": official, "sha": official_sha},
        "merge_base": base,
        "fork_only": [
            {"path": path, "status": fork_changes[path]}
            for path in sorted(fork_paths - official_paths)
        ],
        "official_only_count": len(official_paths - fork_paths),
        "overlaps": [
            {
                "path": path,
                "fork_status": fork_changes[path],
                "official_status": official_changes[path],
                "policy": policy_for(path),
            }
            for path in overlaps
        ],
        "safe_to_apply": not overlaps,
        "next_step": (
            "apply a no-commit merge after resolving the listed policies"
            if overlaps
            else "apply a no-commit merge and run the repository checks"
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--target", default="HEAD")
    parser.add_argument("--official", default=OFFICIAL_REF)
    parser.add_argument("--source", default=OFFICIAL_URL)
    parser.add_argument("--fetch", action="store_true", help="refresh official main first")
    parser.add_argument("--apply", action="store_true", help="start a no-commit, no-ff merge")
    parser.add_argument(
        "--allow-policy-overlaps",
        action="store_true",
        help="allow --apply only when every overlap has an explicit policy",
    )
    parser.add_argument("--report", type=Path, help="write the JSON report to this path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo = args.repo.resolve()
    if not (repo / ".git").exists():
        raise RuntimeError(f"{repo} is not a Git worktree")
    require_clean_worktree(repo)
    if args.fetch:
        fetch_official(repo, args.source)
    report = make_report(repo, args.target, args.official)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.write_text(rendered, encoding="utf-8")
    print(rendered, end="")

    if not args.apply:
        return 0
    overlaps = report["overlaps"]
    if overlaps and not args.allow_policy_overlaps:
        raise RuntimeError(
            "refusing to merge while policy-controlled overlaps remain; "
            "rerun with --allow-policy-overlaps after reviewing the report"
        )
    manual_overlaps = [
        overlap
        for overlap in overlaps
        if overlap["policy"] == "manual_reconciliation_required"
    ]
    if manual_overlaps:
        raise RuntimeError("refusing to merge with unresolved manual-overlap policies")
    run_git(repo, "merge", "--no-commit", "--no-ff", args.official)
    print("Merge applied without a commit; run validation before committing.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2)
