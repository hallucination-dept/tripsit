"""Synthetic design checks; not product code or live feasibility certification."""
import ast
import hashlib


def affected(reverse, changed, limit=20):
    pending, seen = list(changed), set()
    while pending and len(seen) < limit:
        node = pending.pop()
        if node not in seen:
            seen.add(node)
            pending.extend(reverse.get(node, set()) - seen)
    return seen, bool(pending)


def main():
    source = 'def café():\r\n    return "🧪"\r\n'
    raw = source.encode()
    fragments = [raw[i:i + 1] for i in range(len(raw))]
    assert b''.join(fragments).decode() == source
    assert ''.join(t.decode(errors='replace') for t in fragments) != source
    assert hashlib.sha256(raw).digest() != hashlib.sha256(source.replace('\r\n', '\n').encode()).digest()
    tree = ast.parse('from pricing import discount as price\ndef refund(total):\n return price(total)\n')
    imports = {alias.asname or alias.name: f'{node.module}.{alias.name}'
               for node in tree.body if isinstance(node, ast.ImportFrom)
               for alias in node.names}
    calls = {imports[node.func.id] for node in ast.walk(tree)
             if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
             and node.func.id in imports}
    assert calls == {'pricing.discount'}
    # Deleted symbols remain traversable using the base graph.
    base = {'pricing.discount': {'refund.refund'}, 'refund.refund': {'pricing.discount'}}
    reached, incomplete = affected(base, {'pricing.discount'})
    assert reached == {'pricing.discount', 'refund.refund'} and not incomplete
    reached, incomplete = affected(base, {'pricing.discount'}, limit=1)
    assert reached == {'pricing.discount'} and incomplete
    dynamic = ast.parse('def invoke(fn, x):\n return fn(x)\n')
    assert any(isinstance(n, ast.Call) and n.func.id not in imports for n in ast.walk(dynamic))
    print('PASS: byte reconstruction, line-ending identity, Python import alias, base deletion reachability, cycle termination, traversal limit, unresolved dynamic call')


if __name__ == '__main__':
    main()
