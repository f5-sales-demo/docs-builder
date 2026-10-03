'use strict';

const MAX_DEPTH = 128;
exports.maxDepth = MAX_DEPTH;
exports.assertAst = ast => {
  const active = new Set();
  const stack = [{ node: ast, depth: 0, exit: false }];
  while (stack.length) {
    const frame = stack.pop();
    const node = frame.node;
    if (!node || typeof node !== 'object') continue;
    if (frame.exit) { active.delete(node); continue; }
    if (frame.depth > MAX_DEPTH) throw new SyntaxError('Brace nesting depth exceeds safe limit');
    if (active.has(node)) throw new SyntaxError('Brace AST is cyclic');
    active.add(node);
    stack.push({ node, depth: frame.depth, exit: true });
    if (node.nodes) for (let i = node.nodes.length - 1; i >= 0; i--) {
      stack.push({ node: node.nodes[i], depth: frame.depth + 1, exit: false });
    }
  }
};
