"""Differential fixtures against the actual previously validated owned Norm class."""
import ast
import collections
import io
import json
import random
from pathlib import Path
from fast_json_normalizer import FastNormalizer

HERE = Path(__file__).resolve().parent
tree = ast.parse((HERE / "full_stream_container_json_shard.py").read_text(encoding="utf-8-sig"))
definition = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Norm")
namespace = {"collections": collections}
exec(compile(ast.Module(body=[definition], type_ignores=[]), "owned_reference_Norm", "exec"), namespace)
Reference = namespace["Norm"]


class Chunked(io.BytesIO):
    def __init__(self, payload, size):
        super().__init__(payload)
        self.size = size

    def read(self, n=-1):
        return super().read(self.size if n < 0 else min(n, self.size))


def consume(reader, size):
    result = bytearray()
    while True:
        part = reader.read(size)
        if not part:
            break
        result.extend(part)
    return bytes(result), dict(reader.c), reader.n


def main():
    rng = random.Random(93624)
    strings = ['NaN', 'Infinity', '-Infinity', '"NaN"', '\\"NaN', '\\\\"Infinity',
               'alphaNaN', '-NaN', '--Infinity', 'line\n"NaN"', '\\' * 13, 'quote"\\end', '測量NaN']
    fixtures = [json.dumps({"NaN": [float("nan"), float("inf"), -float("inf"), None, 1e-30] + strings}).encode()]
    fixtures += [b'[NaN,Infinity,-Infinity,"NaN","Infinity"]', b'NaN', b'-Infinity',
                 b'alphaNaN Infinitytail --Infinity +Infinity -NaN', b'"unterminated NaN',
                 b'"long string: ' + b'x' * 5000 + b' NaN\\\" Infinity" NaN']
    for _ in range(120):
        values = [rng.choice(strings + [rng.random(), -rng.random(), float("nan"), float("inf"), -float("inf"), None, True]) for _ in range(30)]
        fixtures.append(json.dumps({rng.choice(strings): values, "data": values}, ensure_ascii=bool(rng.randrange(2))).encode())
    total = 0
    failures = []
    for index, payload in enumerate(fixtures):
        for chunk in (1, 2, 3, 7, 9, 16, 17, 31, 257, 65536):
            for output in (1, 17, 65536):
                expected = consume(Reference(Chunked(payload, chunk)), output)
                actual = consume(FastNormalizer(Chunked(payload, chunk)), output)
                total += 1
                if expected != actual:
                    failures.append({"fixture": index, "chunk": chunk, "read_size": output})
    result = {"status": "PASS" if not failures else "FAIL", "differential_cases": total, "failures": failures,
              "compares": ["every emitted byte", "nonfinite counts", "original consumed byte count"],
              "reference": "Actual Norm class from full_stream_container_json_shard.py; only the owned class definition is executed, never source-dataset code.",
              "scope": "Adversarial chunk boundaries, quoting, escapes, token boundaries and generated valid/nonstandard JSON; actual-file differential remains separate."}
    (HERE / "FAST_NORMALIZER_FIXTURE_CHECKS.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "cases": total, "failures": failures[:5]}))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
