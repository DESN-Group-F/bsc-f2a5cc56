import io, json
from complete_pending35 import NormalizeConstants

class SplitReader(io.BytesIO):
    def read(self, n=-1):
        return super().read(2 if n < 0 else min(n, 2))

source = b'{"quoted":"NaN Infinity -Infinity","escaped":"quote: \\" slash: \\\\","bare":[NaN,Infinity,-Infinity],"exponent":-1.25e-3}'
before = bytes(source)
normalizer = NormalizeConstants(SplitReader(source))
normalized = normalizer.read()
parsed = json.loads(normalized)
assert source == before
assert parsed["quoted"] == "NaN Infinity -Infinity"
assert parsed["escaped"] == 'quote: " slash: \\'
assert parsed["bare"] == [None, None, None]
assert parsed["exponent"] == -1.25e-3
assert normalizer.counts == {"NaN": 1, "Infinity": 1, "-Infinity": 1}
result = {"status":"PASS","source_unchanged":True,"quoted_tokens_preserved":True,"escaped_quote_and_backslash_preserved":True,"scientific_negative_exponent_preserved":True,"bare_constants_normalized_in_parser_view_only":True,"counts":dict(normalizer.counts),"forced_source_chunk_bytes":2}
print(json.dumps(result,ensure_ascii=False,indent=2))
