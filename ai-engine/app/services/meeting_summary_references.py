"""Request-scoped compact references for verified meeting evidence."""

from __future__ import annotations

import re
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Iterable, Mapping


_SHORT_REF = re.compile(r"S[1-9][0-9]*\Z")


class EvidenceReferenceError(ValueError):
    """Raised when trusted evidence and its request-scoped IDs do not agree."""


def _value(item: Any, name: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _original_ref(item: Any) -> str:
    source_type = _value(item, "source_type")
    source_id = _value(item, "source_id")
    if source_type not in {"TRANSCRIPT", "SLIDE_OCR"} or source_id is None:
        raise EvidenceReferenceError("unsupported_evidence_source")
    return f"{source_type}:{source_id}"


@dataclass(frozen=True)
class EvidenceReferenceMap:
    """Trusted map built from the verified evidence in one request."""

    ordered_evidence: tuple[Any, ...]
    short_to_original: Mapping[str, str]

    @property
    def allowed_short_refs(self) -> list[str]:
        return list(self.short_to_original)

    @property
    def allowed_original_refs(self) -> set[str]:
        return set(self.short_to_original.values())


def build_evidence_reference_map(evidence: Iterable[Any]) -> EvidenceReferenceMap:
    """Assign S1... in chronological order without trusting model mappings."""
    items = list(evidence)
    if not items:
        raise EvidenceReferenceError("empty_evidence")

    for item in items:
        _original_ref(item)
        start = _value(item, "start_time_ms")
        end = _value(item, "end_time_ms")
        if not isinstance(start, int) or isinstance(start, bool) or start < 0:
            raise EvidenceReferenceError("invalid_evidence_order")
        if not isinstance(end, int) or isinstance(end, bool) or end < start:
            raise EvidenceReferenceError("invalid_evidence_order")

    # Match ContextPayloadServiceImpl: start time, then source UUID. Python's
    # stable sort retains request order when both keys tie, as does Java's.
    ordered = sorted(
        items,
        key=lambda item: (int(_value(item, "start_time_ms")), str(_value(item, "source_id"))),
    )
    originals = [_original_ref(item) for item in ordered]
    if len(originals) != len(set(originals)):
        raise EvidenceReferenceError("duplicate_source_ref")

    mapping = {f"S{index}": ref for index, ref in enumerate(originals, start=1)}
    return EvidenceReferenceMap(tuple(ordered), MappingProxyType(mapping))


def verify_short_reference_allowlist(
    evidence: Iterable[Any], allowed_refs: list[str]
) -> EvidenceReferenceMap:
    """Require the exact canonical ID sequence derived from trusted evidence."""
    reference_map = build_evidence_reference_map(evidence)
    if (
        not isinstance(allowed_refs, list)
        or any(not isinstance(ref, str) or not _SHORT_REF.fullmatch(ref) for ref in allowed_refs)
        or allowed_refs != reference_map.allowed_short_refs
    ):
        raise EvidenceReferenceError("evidence_reference_mapping_mismatch")
    return reference_map


def expand_summary_references(
    value: Any, reference_map: EvidenceReferenceMap
) -> Any:
    """Expand only citation arrays, rejecting unknown or repeated IDs."""
    if isinstance(value, dict):
        expanded = {}
        for key, child in value.items():
            if key in {"source_refs", "executive_summary_refs"}:
                if not isinstance(child, list):
                    raise EvidenceReferenceError("malformed_reference_array")
                if any(not isinstance(ref, str) for ref in child):
                    raise EvidenceReferenceError("malformed_evidence_reference")
                if len(child) != len(set(child)):
                    raise EvidenceReferenceError("duplicate_evidence_reference")
                refs = []
                for ref in child:
                    if not _SHORT_REF.fullmatch(ref):
                        raise EvidenceReferenceError("malformed_evidence_reference")
                    original = reference_map.short_to_original.get(ref)
                    if original is None:
                        raise EvidenceReferenceError("unknown_evidence_reference")
                    refs.append(original)
                expanded[key] = refs
            else:
                expanded[key] = expand_summary_references(child, reference_map)
        return expanded
    if isinstance(value, list):
        return [expand_summary_references(child, reference_map) for child in value]
    return value
