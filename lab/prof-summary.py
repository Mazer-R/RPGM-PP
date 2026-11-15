#!/usr/bin/env python3
"""Summarise a V8 .cpuprofile: where the game's logic step spends its time.

Only samples taken inside the engine's logic step (any stack that passes
through SceneManager.updateScene) are counted, so start-up is excluded.
Self time is grouped by source file and by function.
"""
import collections
import json
import sys

prof = json.load(open(sys.argv[1]))
nodes = {n['id']: n for n in prof['nodes']}
parent = {}
for n in prof['nodes']:
    for child in n.get('children', []):
        parent[child] = n['id']

inside = {}
def in_logic(node_id):
    if node_id not in inside:
        name = nodes[node_id]['callFrame']['functionName']
        inside[node_id] = name == 'SceneManager.updateScene' or (
            node_id in parent and in_logic(parent[node_id]))
    return inside[node_id]

by_file = collections.Counter()
by_function = collections.Counter()
total = 0
for sample, delta in zip(prof['samples'], prof['timeDeltas']):
    if not in_logic(sample):
        continue
    frame = nodes[sample]['callFrame']
    file_name = (frame['url'] or '(engine internals)').split('/')[-1]
    function = frame['functionName'] or '(anonymous)'
    by_file[file_name] += delta
    by_function[f"{function} [{file_name}:{frame['lineNumber'] + 1}]"] += delta
    total += delta

print(f'logic time sampled: {total / 1000:.0f} ms')
print('by file:')
for name, micros in by_file.most_common(12):
    print(f'  {micros / total * 100:5.1f}%  {name}')
print('by function (self time):')
for name, micros in by_function.most_common(int(sys.argv[2]) if len(sys.argv) > 2 else 16):
    print(f'  {micros / total * 100:5.1f}%  {name}')
