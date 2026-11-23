"""Score one response to the short public exercise. Run after the blind review."""
import json
import sys

# These answers are for the public exercise only.
EXPECTED = {"A": ["refuted", 25], "B": ["refuted", 0], "C": ["supported", 30]}


def score(answers):
    if not isinstance(answers, dict) or answers.keys() != EXPECTED.keys():
        raise ValueError("Expected a JSON object with exactly the claim IDs A, B and C")
    correct = 0
    for claim, expected in EXPECTED.items():
        answer = answers[claim]
        valid = isinstance(answer, list) and len(answer) == 2 and type(answer[1]) is int
        right = valid and answer == expected
        correct += int(right)
        print(f"{claim}: {'right' if right else 'miss'}")
    print(f"{correct} of {len(EXPECTED)} verdicts and values right")
    return correct == len(EXPECTED)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 check-case.py answer.json")
    with open(sys.argv[1], encoding="utf-8") as source:
        sys.exit(0 if score(json.load(source)) else 1)
