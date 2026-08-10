#!/usr/bin/env python3
"""Validate CONSTITUTION.md against constitution-rule/v1.


Gate for A.2 applied reflexively: the constitution's own format must fail a
command, not a cited clause. Validates every fenced ```yaml block against
hardcoded schema fields (required_fields, optional_fields, gate_values).

Coverage is checked before schema. A rule the parser never reaches cannot be
validated, and an unterminated fence silently removes every rule after it from
the block — so counting ids in the raw text and comparing against ids parsed
out of blocks is the only way this gate can report on what it did NOT see.
Without that comparison a green run means "no rule I happened to parse was
malformed", which is not the claim the gate is making.
"""
import re
import sys

import yaml

PATH = "CONSTITUTION.md"
ID_RE = re.compile(r"^[A-Z]+\.\d+$")
ID_IN_TEXT_RE = re.compile(r"^\s*- id:\s*(\S+)\s*$", re.M)

HARDCODED_REQUIRED = ["id", "title", "gate", "do", "dont", "harm", "check"]
HARDCODED_OPTIONAL = ["scope", "example", "layers"]
HARDCODED_GATES = {"lint", "type-checker", "mutation", "review"}


def fail(errors):
    for e in errors:
        print(f"FAIL {e}")
    sys.exit(1)


def main():
    text = open(PATH, encoding="utf-8").read()
    errors = []

    blocks = re.findall(r"```yaml\n(.*?)```", text, re.S)
    if not blocks:
        fail(["no fenced yaml rule blocks found"])

    rules = []
    for i, block in enumerate(blocks):
        try:
            doc = yaml.safe_load(block)
        except yaml.YAMLError as e:
            errors.append(f"block {i}: YAML parse error: {e}")
            continue
        rules.extend(doc.get("rules", []))

    parsed_ids = [str(r.get("id")) for r in rules]
    declared_ids = ID_IN_TEXT_RE.findall(text)
    uncovered = [i for i in declared_ids if i not in parsed_ids]
    if uncovered:
        errors.append(
            f"{len(uncovered)} rule(s) declared in the file but never parsed "
            f"into a yaml block: {uncovered} — check for an unterminated ```yaml fence"
        )

    seen = set()
    for r in rules:
        rid = r.get("id", "<no id>")
        for f in HARDCODED_REQUIRED:
            if f not in r:
                errors.append(f"{rid}: missing required field '{f}'")
        unknown = set(r) - set(HARDCODED_REQUIRED) - set(HARDCODED_OPTIONAL)
        if unknown:
            errors.append(f"{rid}: unknown fields {sorted(unknown)}")
        if not ID_RE.match(str(rid)):
            errors.append(f"{rid}: id does not match {ID_RE.pattern}")
        if rid in seen:
            errors.append(f"{rid}: duplicate id")
        seen.add(rid)
        if r.get("gate") not in HARDCODED_GATES:
            errors.append(f"{rid}: gate '{r.get('gate')}' not in {sorted(HARDCODED_GATES)}")
        for f in ("do", "dont"):
            v = r.get(f)
            if not (isinstance(v, str) or (isinstance(v, list) and all(isinstance(x, str) for x in v))):
                errors.append(f"{rid}: '{f}' must be a string or list of strings")
        ex = r.get("example")
        if ex is not None and not (isinstance(ex, dict) and all(isinstance(v, str) for v in ex.values())):
            errors.append(f"{rid}: 'example' must be a map of strings")

    if errors:
        fail(errors)
    print(f"valid: {len(rules)} rules across {len(blocks)} yaml blocks")


if __name__ == "__main__":
    main()
