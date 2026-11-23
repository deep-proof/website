"""Recount the paired Astra reviews. Uses Python 3.8+ and its standard library."""
import csv
import itertools
import math
import sys
from pathlib import Path

MODELS = ("gpt-6-astra", "gpt-6.2-astra")


def read_reviews(path):
    reviews = {}
    with path.open(newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            key = row["model"], row["book"], row["report"], int(row["attempt"])
            stage, counted, missed, apart = (
                int(row[field]) for field in ("stage", "counted", "missed", "set_apart")
            )
            if key in reviews or stage not in range(1, 4):
                raise ValueError(f"Duplicate review or invalid stage: {key}")
            if not (0 <= missed <= counted <= 24 and apart == 24 - counted):
                raise ValueError(f"Inconsistent answer counts: {key}")
            reviews[key] = stage, counted, missed, apart
    expected = set(itertools.product(MODELS, "ABCDEF", ("correct", "mixed"), (1, 2)))
    if reviews.keys() != expected:
        raise ValueError("Expected two attempts for each model, book and report")
    return reviews


def fisher_two_sided(groups):
    # Fixed margins: weight for k affected reviews in the first group.
    (affected, first), (other_affected, second) = groups
    total = affected + other_affected
    weights = {
        k: math.comb(first, k) * math.comb(second, total - k)
        for k in range(max(0, total - second), min(first, total) + 1)
    }
    return sum(w for w in weights.values() if w <= weights[affected]) / sum(weights.values())


def main(path):
    reviews = read_reviews(path)
    totals = []
    print("model | stage | missed / counted answers | affected / reviews | set apart")
    for model in MODELS:
        for stage in (1, 2, 3, "all"):
            group = [r for key, r in reviews.items() if key[0] == model and stage in (r[0], "all")]
            affected = sum(r[2] > 0 for r in group)
            missed, counted, apart = (sum(r[i] for r in group) for i in (2, 1, 3))
            print(f"{model} | {stage} | {missed} / {counted} | {affected} / {len(group)} | {apart}")
            if stage == "all":
                totals.append((affected, len(group)))
    print(f"Two-sided Fisher exact p (counted reviews): {fisher_two_sided(totals):.5f}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("reviews.csv"))
