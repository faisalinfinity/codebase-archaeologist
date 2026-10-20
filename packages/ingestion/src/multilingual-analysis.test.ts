import { expect, it } from 'vitest';
import { analyzeSourceFile } from './multilingual-analysis';

it.each([
  [
    'sample.py',
    'import os\nfrom .helpers import work\nclass Service:\n    def run(self):\n        return 1\n',
    ['Service', 'run'],
  ],
  ['sample.go', 'package main\nimport "fmt"\nfunc Run() { fmt.Println("hello") }\n', ['Run']],
  ['sample.rs', 'pub struct Service {}\npub fn run() -> i32 { 1 }\n', ['Service', 'run']],
  ['Sample.java', 'class Service { public void run() {} }', ['Service', 'run']],
  ['sample.cpp', 'int run() { return 1; }', ['run']],
  ['sample.rb', 'class Service\n  def run\n    1\n  end\nend', ['Service', 'run']],
  ['sample.c', 'int run(void) { return 1; }', ['run']],
  ['Sample.cs', 'class Service { public void Run() {} }', ['Service', 'Run']],
  ['sample.php', '<?php function run() { return 1; }', ['run']],
  ['sample.kt', 'class Service { fun run(): Int { return 1 } }', ['Service', 'run']],
  ['sample.swift', 'class Service { func run() -> Int { return 1 } }', ['Service', 'run']],
])('extracts syntax facts from %s without executing it', async (path, source, names) => {
  const analysis = await analyzeSourceFile(path as string, source as string);
  expect(analysis.symbols.map((symbol) => symbol.name)).toEqual(
    expect.arrayContaining(names as string[]),
  );
  expect(analysis.chunks.map((chunk) => chunk.content).join('')).toBe(source);
  for (const symbol of analysis.symbols)
    expect(symbol.endLine).toBeGreaterThanOrEqual(symbol.startLine);
});
