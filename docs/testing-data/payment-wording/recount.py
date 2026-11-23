"""Recount the payment-wording replication with Python 3.8+ (standard library)."""
import csv
from itertools import product
from math import comb
from pathlib import Path


def recount(path):
    with path.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    if not rows or len({row["book"] for row in rows}) != len(rows):
        raise ValueError("Each matched book needs one row and a unique identifier.")
    unedited = edited = n_unedited = n_edited = 0
    differences = []
    for row in rows:
        u, nu, e, ne = (int(row[column]) for column in
                        ("original_flawed", "original_reviews", "edited_flawed", "edited_reviews"))
        if not (0 <= u <= nu and 0 <= e <= ne and nu == ne and nu > 0):
            raise ValueError(f"Inconsistent matched review counts for {row['book']}")
        unedited += u
        edited += e
        n_unedited += nu
        n_edited += ne
        differences.append(e - u)

    flawed = unedited + edited
    # Fixed margins, one-sided tail for more flawed reviews on the edited side.
    tail = sum(comb(n_edited, k) * comb(n_unedited, flawed - k)
               for k in range(edited, min(n_edited, flawed) + 1))
    fisher = tail / comb(n_unedited + n_edited, flawed)
    # Flip the sign of each nonzero book difference as a unit.
    magnitudes = [abs(d) for d in differences if d]
    observed = sum(differences)
    at_least = sum(sum(s * d for s, d in zip(signs, magnitudes)) >= observed
                   for signs in product((-1, 1), repeat=len(magnitudes)))
    assignments = 2 ** len(magnitudes)
    print(f"Matched books: {len(rows)}")
    print(f"Original flawed reviews: {unedited}/{n_unedited}")
    print(f"Edited flawed reviews: {edited}/{n_edited}")
    print(f"One-sided Fisher exact p: {fisher:.8f}")
    print(f"Paired sign-flip p: {at_least}/{assignments} = {at_least / assignments:.6f}")


if __name__ == "__main__":
    recount(Path(__file__).with_name("book-counts.csv"))
